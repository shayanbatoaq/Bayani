create table public.finscope_user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  namespace text not null check (
    namespace in ('companies', 'financial-records', 'bank-sessions', 'audit-requests', 'plan')
  ),
  record_id text not null check (length(record_id) between 1 and 200),
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, namespace, record_id),
  check (jsonb_typeof(payload) = 'object')
);

create index finscope_user_data_namespace_updated_idx
  on public.finscope_user_data (user_id, namespace, updated_at desc);

alter table public.finscope_user_data enable row level security;

create policy finscope_user_data_select_own
  on public.finscope_user_data for select to authenticated
  using ((select auth.uid()) = user_id);

create policy finscope_user_data_insert_own
  on public.finscope_user_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy finscope_user_data_update_own
  on public.finscope_user_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy finscope_user_data_delete_own
  on public.finscope_user_data for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.finscope_user_data from anon;
grant select, insert, update, delete on public.finscope_user_data to authenticated;

create function public.save_finscope_user_data(
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

  if p_namespace not in ('companies', 'financial-records', 'bank-sessions', 'audit-requests', 'plan')
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

revoke all on function public.save_finscope_user_data(text, text, jsonb, bigint) from public, anon;
grant execute on function public.save_finscope_user_data(text, text, jsonb, bigint) to authenticated;
