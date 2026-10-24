-- 1. Billing ("plan") is read-only for signed-in users: it is written only with the service role.
-- 2. The activity log can only be added to through log_finscope_activity, which stamps the server's
--    time, so entries cannot be back-dated, edited or deleted by the user.
-- 3. finscope_change_log: every insert, update and delete on finscope_user_data is recorded by a
--    trigger, whichever way the change was made (app, REST or SQL). Users can read their own rows
--    but cannot write, change or delete them.
-- 4. finscope_ai_usage: a daily allowance of AI reading calls per user.

/* ------------------------------------------------ 1. write policies */

drop policy finscope_user_data_insert_own on public.finscope_user_data;
create policy finscope_user_data_insert_own
  on public.finscope_user_data for insert to authenticated
  with check ((select auth.uid()) = user_id and namespace not in ('plan', 'activity'));

drop policy finscope_user_data_update_own on public.finscope_user_data;
create policy finscope_user_data_update_own
  on public.finscope_user_data for update to authenticated
  using ((select auth.uid()) = user_id and namespace not in ('plan', 'activity'))
  with check ((select auth.uid()) = user_id and namespace not in ('plan', 'activity'));

drop policy finscope_user_data_delete_own on public.finscope_user_data;
create policy finscope_user_data_delete_own
  on public.finscope_user_data for delete to authenticated
  using ((select auth.uid()) = user_id and namespace not in ('plan', 'activity'));

create or replace function public.save_finscope_user_data(
  p_namespace text,
  p_record_id text,
  p_payload jsonb,
  p_expected_revision bigint
)
returns table (
  record_id text,
  payload jsonb,
  revision bigint,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_namespace not in ('companies', 'financial-records', 'bank-sessions', 'audit-requests', 'company-logos', 'books', 'bill-documents', 'asp-requests')
     or p_record_id is null
     or length(p_record_id) not between 1 and 200
     or jsonb_typeof(p_payload) <> 'object'
     or p_expected_revision is null
     or p_expected_revision < 0 then
    raise exception 'Invalid FinScope data' using errcode = '22023';
  end if;

  if p_expected_revision = 0 then
    insert into public.finscope_user_data as existing (
      user_id, namespace, record_id, payload, revision
    )
    values (
      current_user_id, p_namespace, p_record_id, p_payload, 1
    )
    on conflict on constraint finscope_user_data_pkey do nothing
    returning existing.record_id, existing.payload, existing.revision, existing.updated_at
      into record_id, payload, revision, updated_at;
  else
    update public.finscope_user_data as existing
      set payload = p_payload,
          revision = existing.revision + 1,
          updated_at = now()
      where existing.user_id = current_user_id
        and existing.namespace = p_namespace
        and existing.record_id = p_record_id
        and existing.revision = p_expected_revision
      returning existing.record_id, existing.payload, existing.revision, existing.updated_at
        into record_id, payload, revision, updated_at;
  end if;

  if not found then
    raise exception 'Financial data revision conflict' using errcode = '40001';
  end if;

  return next;
end;
$$;

/* ------------------------------------------------ 2. activity entries */

create or replace function public.log_finscope_activity(p_record_id text, p_entry jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  stamped timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_record_id is null
     or p_record_id !~ '^[a-z0-9-]{1,36}:[0-9a-z]{10}:[0-9a-f]{8}$'
     or jsonb_typeof(p_entry) <> 'object'
     or pg_column_size(p_entry) > 65536 then
    raise exception 'Invalid activity entry' using errcode = '22023';
  end if;

  insert into public.finscope_user_data (user_id, namespace, record_id, payload, revision)
  values (
    current_user_id,
    'activity',
    p_record_id,
    p_entry || jsonb_build_object('id', p_record_id, 'at', to_jsonb(stamped)),
    1
  );
  return stamped;
end;
$$;

revoke all on function public.log_finscope_activity(text, jsonb) from public, anon;
grant execute on function public.log_finscope_activity(text, jsonb) to authenticated;

/* ------------------------------------------------ 3. change log */

create table public.finscope_change_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid,
  namespace text not null,
  record_id text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  old_revision bigint,
  new_revision bigint,
  payload_md5 text,
  changed_at timestamptz not null default now()
);

create index finscope_change_log_user_idx
  on public.finscope_change_log (user_id, changed_at desc);

alter table public.finscope_change_log enable row level security;

create policy finscope_change_log_select_own
  on public.finscope_change_log for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.finscope_change_log from public, anon, authenticated;
grant select on public.finscope_change_log to authenticated;

create or replace function public.record_finscope_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Removing the account removes its data and its log together.
    if old.namespace = 'activity'
       or not exists (select 1 from auth.users where id = old.user_id) then
      return old;
    end if;
    insert into public.finscope_change_log (user_id, actor_id, namespace, record_id, operation, old_revision)
    values (old.user_id, auth.uid(), old.namespace, old.record_id, 'delete', old.revision);
    return old;
  end if;

  if new.namespace = 'activity' then
    return new;
  end if;
  insert into public.finscope_change_log (
    user_id, actor_id, namespace, record_id, operation, old_revision, new_revision, payload_md5
  )
  values (
    new.user_id,
    auth.uid(),
    new.namespace,
    new.record_id,
    lower(tg_op),
    case when tg_op = 'UPDATE' then old.revision end,
    new.revision,
    md5(new.payload::text)
  );
  return new;
end;
$$;

revoke all on function public.record_finscope_change() from public, anon, authenticated;

drop trigger if exists finscope_change_log_record on public.finscope_user_data;
create trigger finscope_change_log_record
  after insert or update or delete on public.finscope_user_data
  for each row execute function public.record_finscope_change();

/* ------------------------------------------------ 4. AI allowance */

create table public.finscope_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('bill', 'statement', 'document')),
  calls integer not null default 0,
  primary key (user_id, day, kind)
);

alter table public.finscope_ai_usage enable row level security;

create policy finscope_ai_usage_select_own
  on public.finscope_ai_usage for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.finscope_ai_usage from public, anon, authenticated;
grant select on public.finscope_ai_usage to authenticated;

/** Counts one AI call of a kind for today (UAE date); false once the day's allowance is used. */
create or replace function public.use_finscope_ai_call(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  allowance integer := case p_kind when 'bill' then 300 when 'statement' then 300 when 'document' then 60 end;
  used integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if allowance is null then
    raise exception 'Invalid AI call kind' using errcode = '22023';
  end if;

  insert into public.finscope_ai_usage as usage (user_id, day, kind, calls)
  values (current_user_id, (now() at time zone 'Asia/Dubai')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update
    set calls = usage.calls + 1
    where usage.calls < allowance
  returning calls into used;

  return used is not null;
end;
$$;

revoke all on function public.use_finscope_ai_call(text) from public, anon;
grant execute on function public.use_finscope_ai_call(text) to authenticated;
