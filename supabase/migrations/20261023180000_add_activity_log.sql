-- Bayani activity log ("activity"): one row per change saved, only ever added.
-- Rows in this namespace cannot be edited, and signed-in users cannot delete them.
alter table public.finscope_user_data
  drop constraint finscope_user_data_namespace_check,
  add constraint finscope_user_data_namespace_check
    check (namespace in ('companies', 'financial-records', 'bank-sessions', 'audit-requests', 'plan', 'company-logos', 'books', 'bill-documents', 'asp-requests', 'activity'));

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

  if p_namespace not in ('companies', 'financial-records', 'bank-sessions', 'audit-requests', 'plan', 'company-logos', 'books', 'bill-documents', 'asp-requests', 'activity')
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

create or replace function public.protect_finscope_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.namespace = 'activity' then
    raise exception 'Activity log entries cannot be changed' using errcode = '42501';
  end if;
  -- Removing the account (no signed-in user) still removes its log.
  if tg_op = 'DELETE' and old.namespace = 'activity' and auth.uid() is not null then
    raise exception 'Activity log entries cannot be deleted' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists finscope_activity_append_only on public.finscope_user_data;
create trigger finscope_activity_append_only
  before update or delete on public.finscope_user_data
  for each row execute function public.protect_finscope_activity();
