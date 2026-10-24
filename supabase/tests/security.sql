\set ON_ERROR_STOP 0
-- Run: psql -d <empty db> -f supabase-stub.sql, then every file in ../migrations in order, then this file.
-- Lines marked "expect ... error" must fail; every query result must read t or the counts shown.
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo -- normal save works and is change-logged
select revision from public.save_finscope_user_data('companies', 'c1', '{"name":"A"}', 0);
select revision from public.save_finscope_user_data('companies', 'c1', '{"name":"B"}', 1);
\echo -- direct REST-style insert of plan (expect RLS error)
insert into public.finscope_user_data (user_id, namespace, record_id, payload) values ('11111111-1111-1111-1111-111111111111', 'plan', 'subscription', '{"extraCompanies":500}');
\echo -- plan via RPC (expect Invalid)
select * from public.save_finscope_user_data('plan', 'subscription', '{"extraCompanies":500}', 0);
\echo -- forge activity directly (expect RLS error)
insert into public.finscope_user_data (user_id, namespace, record_id, payload) values ('11111111-1111-1111-1111-111111111111', 'activity', 'x', '{"at":"2020-01-01"}');
\echo -- activity via RPC: server time overrides "at"
select public.log_finscope_activity('account:0000000001:abcdef12', '{"summary":"hi","at":"2020-01-01T00:00:00Z"}') > now() - interval '1 minute' as stamped_now;
select payload->>'at' > '2025' as not_backdated from public.finscope_user_data where namespace = 'activity';
\echo -- delete activity: a silent no-op under RLS (expect activity_rows 1)
delete from public.finscope_user_data where namespace = 'activity';
select count(*) as activity_rows from public.finscope_user_data where namespace = 'activity';
\echo -- direct REST update bypassing RPC is still change-logged
update public.finscope_user_data set payload = '{"name":"sneaky"}', revision = 9 where record_id = 'c1';
delete from public.finscope_user_data where record_id = 'c1';
select operation, namespace, record_id, old_revision, new_revision, actor_id is not null as actor from public.finscope_change_log order by id;
\echo -- user cannot touch the change log (expect permission errors)
delete from public.finscope_change_log;
insert into public.finscope_change_log (user_id, namespace, record_id, operation) values ('11111111-1111-1111-1111-111111111111', 'x', 'x', 'insert');
update public.finscope_change_log set record_id = 'y';
\echo -- other user sees nothing of user 1
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as other_user_sees from public.finscope_change_log;
\echo -- AI allowance: document allowance is 60
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select count(*) filter (where ok) as allowed, count(*) filter (where not ok) as refused from (select public.use_finscope_ai_call('document') as ok from generate_series(1, 65)) s;
\echo -- user cannot reset usage (expect permission error)
delete from public.finscope_ai_usage;
\echo -- anon cannot call
reset role; set role anon;
select public.use_finscope_ai_call('bill');
\echo -- account deletion (no signed-in user) cascades cleanly: expect 0 0 0
reset role;
reset request.jwt.claim.sub;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select (select count(*) from public.finscope_user_data) as data_left, (select count(*) from public.finscope_change_log) as log_left, (select count(*) from public.finscope_ai_usage) as usage_left;
