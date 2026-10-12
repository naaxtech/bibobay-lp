-- pgTAP checks for migration 0001 (Task 5, ruling R29).
--
-- Runs in one transaction and rolls back, so it leaves nothing behind. Run against a Supabase
-- project with `supabase test db` (Task 11); tests/leads/migration-database.test.ts runs it in an
-- embedded Postgres on every `npm test`.
--
-- Covers: RLS enabled AND forced with no policies; no table privilege for anon, authenticated or
-- service_role; every RPC a security definer with an empty search_path, executable by service_role
-- only (never PUBLIC, anon or authenticated); the retention helper executable by nobody but its
-- owner; and real behaviour under each API role.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(68);

-- ---------------------------------------------------------------------------
-- Tables: RLS enabled and forced, no policies, no privileges for any API role
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.lead_submissions'::regclass),
  'lead_submissions: row level security enabled and forced'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.lead_delivery_events'::regclass),
  'lead_delivery_events: row level security enabled and forced'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.rate_limit_buckets'::regclass),
  'rate_limit_buckets: row level security enabled and forced'
);
select is_empty(
  $$ select tablename::text from pg_catalog.pg_policies
     where schemaname = 'public' and tablename in ('lead_submissions', 'lead_delivery_events', 'rate_limit_buckets') $$,
  'no row policies: every API role is denied by default'
);

select table_privs_are('public', 'lead_submissions', 'anon', array[]::text[], 'anon has no privilege on lead_submissions');
select table_privs_are('public', 'lead_submissions', 'authenticated', array[]::text[], 'authenticated has no privilege on lead_submissions');
select table_privs_are('public', 'lead_submissions', 'service_role', array[]::text[], 'service_role reaches lead_submissions only through RPCs');
select table_privs_are('public', 'lead_delivery_events', 'anon', array[]::text[], 'anon has no privilege on lead_delivery_events');
select table_privs_are('public', 'lead_delivery_events', 'authenticated', array[]::text[], 'authenticated has no privilege on lead_delivery_events');
select table_privs_are('public', 'lead_delivery_events', 'service_role', array[]::text[], 'service_role reaches lead_delivery_events only through RPCs');
select table_privs_are('public', 'rate_limit_buckets', 'anon', array[]::text[], 'anon has no privilege on rate_limit_buckets');
select table_privs_are('public', 'rate_limit_buckets', 'authenticated', array[]::text[], 'authenticated has no privilege on rate_limit_buckets');
select table_privs_are('public', 'rate_limit_buckets', 'service_role', array[]::text[], 'service_role reaches rate_limit_buckets only through RPCs');

-- ---------------------------------------------------------------------------
-- Functions: security definer, empty search_path, service_role only
-- ---------------------------------------------------------------------------

select is_definer('public', 'submit_lead', array['text', 'boolean', 'text', 'text', 'text', 'text', 'text', 'jsonb'], 'submit_lead is security definer');
select is_definer('public', 'enqueue_lead_delivery', array['uuid', 'text', 'boolean'], 'enqueue_lead_delivery is security definer');
select is_definer('public', 'record_lead_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'record_lead_delivery_attempt is security definer');
select is_definer('public', 'consume_rate_limit', array['text', 'integer', 'integer'], 'consume_rate_limit is security definer');
select is_definer('public', 'purge_expired_rate_limit_buckets', array[]::text[], 'purge_expired_rate_limit_buckets is security definer');

select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prosecdef
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every security definer function in public pins an empty search_path'
);
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as acl
     where p.pronamespace = 'public'::regnamespace and acl.grantee = 0 and acl.privilege_type = 'EXECUTE' $$,
  'no function in public is executable by PUBLIC'
);

select function_privs_are('public', 'submit_lead', array['text', 'boolean', 'text', 'text', 'text', 'text', 'text', 'jsonb'], 'anon', array[]::text[], 'anon cannot execute submit_lead');
select function_privs_are('public', 'submit_lead', array['text', 'boolean', 'text', 'text', 'text', 'text', 'text', 'jsonb'], 'authenticated', array[]::text[], 'authenticated cannot execute submit_lead');
select function_privs_are('public', 'submit_lead', array['text', 'boolean', 'text', 'text', 'text', 'text', 'text', 'jsonb'], 'service_role', array['EXECUTE'], 'service_role can execute submit_lead');
select function_privs_are('public', 'enqueue_lead_delivery', array['uuid', 'text', 'boolean'], 'anon', array[]::text[], 'anon cannot execute enqueue_lead_delivery');
select function_privs_are('public', 'enqueue_lead_delivery', array['uuid', 'text', 'boolean'], 'authenticated', array[]::text[], 'authenticated cannot execute enqueue_lead_delivery');
select function_privs_are('public', 'enqueue_lead_delivery', array['uuid', 'text', 'boolean'], 'service_role', array['EXECUTE'], 'service_role can execute enqueue_lead_delivery');
select function_privs_are('public', 'record_lead_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot execute record_lead_delivery_attempt');
select function_privs_are('public', 'record_lead_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot execute record_lead_delivery_attempt');
select function_privs_are('public', 'record_lead_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'service_role', array['EXECUTE'], 'service_role can execute record_lead_delivery_attempt');
select function_privs_are('public', 'consume_rate_limit', array['text', 'integer', 'integer'], 'anon', array[]::text[], 'anon cannot execute consume_rate_limit');
select function_privs_are('public', 'consume_rate_limit', array['text', 'integer', 'integer'], 'authenticated', array[]::text[], 'authenticated cannot execute consume_rate_limit');
select function_privs_are('public', 'consume_rate_limit', array['text', 'integer', 'integer'], 'service_role', array['EXECUTE'], 'service_role can execute consume_rate_limit');
select function_privs_are('public', 'purge_expired_rate_limit_buckets', array[]::text[], 'anon', array[]::text[], 'anon cannot execute the retention helper');
select function_privs_are('public', 'purge_expired_rate_limit_buckets', array[]::text[], 'authenticated', array[]::text[], 'authenticated cannot execute the retention helper');
select function_privs_are('public', 'purge_expired_rate_limit_buckets', array[]::text[], 'service_role', array[]::text[], 'service_role cannot execute the retention helper');

-- ---------------------------------------------------------------------------
-- Behaviour as anon: nothing works
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok($$ select * from public.lead_submissions $$, '42501', null, 'anon cannot read leads');
select throws_ok(
  $$ insert into public.lead_submissions (email, consent_version) values ('anon@example.com', 'v1') $$,
  '42501', null, 'anon cannot insert leads directly'
);
select throws_ok($$ select * from public.submit_lead('anon@example.com', true, 'v1') $$, '42501', null, 'anon cannot call submit_lead');
select throws_ok($$ select * from public.consume_rate_limit('lead:anon', 5, 60) $$, '42501', null, 'anon cannot call consume_rate_limit');

-- ---------------------------------------------------------------------------
-- Behaviour as authenticated: nothing works either (no staff access in this task)
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;

select throws_ok($$ select * from public.lead_submissions $$, '42501', null, 'authenticated cannot read leads');
select throws_ok($$ select * from public.lead_delivery_events $$, '42501', null, 'authenticated cannot read the outbox');
select throws_ok($$ select * from public.submit_lead('user@example.com', true, 'v1') $$, '42501', null, 'authenticated cannot call submit_lead');

-- ---------------------------------------------------------------------------
-- Behaviour as service_role: RPCs only
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

select throws_ok($$ select * from public.lead_submissions $$, '42501', null, 'service_role cannot read leads directly');
select throws_ok($$ select * from public.rate_limit_buckets $$, '42501', null, 'service_role cannot read rate-limit buckets directly');
select throws_ok($$ select public.purge_expired_rate_limit_buckets() $$, '42501', null, 'service_role cannot run the retention helper');

select is(
  (select created from public.submit_lead('  Parent@Example.COM ', true, 'consent-v1', 'Sam', '3-5', 'landing', 'en-GB', '{"source":"newsletter"}'::jsonb)),
  true,
  'a first signup creates a lead'
);
select is(
  (select created from public.submit_lead('parent@example.com', true, 'consent-v2')),
  false,
  'the same normalised email updates the existing lead instead of adding one'
);
select throws_ok(
  $$ select * from public.submit_lead('someone@example.com', false, 'consent-v1') $$,
  '22023', 'consent is required', 'submit_lead refuses a signup without consent'
);
select throws_ok(
  $$ select * from public.submit_lead('someone@example.com', true, 'consent-v1', null, 'teenager') $$,
  '22023', 'age band is invalid', 'submit_lead refuses an age band outside the list'
);
select throws_ok(
  $$ select * from public.submit_lead('not-an-email', true, 'consent-v1') $$,
  '22023', 'email is invalid', 'submit_lead refuses an invalid email'
);
select throws_ok(
  $$ select * from public.submit_lead(null, true, 'consent-v1') $$,
  '22023', 'email is invalid', 'submit_lead refuses a missing email'
);
select throws_ok(
  $$ select * from public.submit_lead('someone@example.com', true, 'consent-v1', null, null, 'landing', null, '{"school":"x"}'::jsonb) $$,
  '22023', 'campaign tags are invalid', 'submit_lead accepts only the five campaign tags'
);

select is(
  (select status from public.enqueue_lead_delivery((select lead_id from public.submit_lead('parent@example.com', true, 'consent-v2')), 'acknowledgement', true)),
  'sending',
  'a claimed acknowledgement starts as sending'
);
select is(
  (select created from public.enqueue_lead_delivery((select lead_id from public.submit_lead('parent@example.com', true, 'consent-v2')), 'acknowledgement', true)),
  false,
  'a repeat signup never queues a second acknowledgement'
);
select is(
  public.record_lead_delivery_attempt(
    (select event_id from public.enqueue_lead_delivery((select lead_id from public.submit_lead('parent@example.com', true, 'consent-v2')), 'acknowledgement')),
    'failed', null, 'send_timeout'
  ),
  true,
  'a failed attempt is recorded on the claimed event'
);
select is(
  public.record_lead_delivery_attempt(
    (select event_id from public.enqueue_lead_delivery((select lead_id from public.submit_lead('parent@example.com', true, 'consent-v2')), 'acknowledgement')),
    'sent', 'provider-123', null
  ),
  false,
  'an event that is no longer claimed cannot be recorded again'
);
select throws_ok(
  $$ select public.record_lead_delivery_attempt(gen_random_uuid(), 'failed', null, 'reason with spaces and parent@example.com') $$,
  '22023', 'error code is invalid', 'only short error codes are stored, never provider messages'
);
select throws_ok(
  $$ select * from public.enqueue_lead_delivery(gen_random_uuid(), 'newsletter') $$,
  '22023', 'delivery kind is invalid', 'the outbox accepts only the two lead message kinds'
);

select is((select allowed from public.consume_rate_limit('lead:test-key', 2, 60)), true, 'first hit in a window is allowed');
select is((select allowed from public.consume_rate_limit('lead:test-key', 2, 60)), true, 'second hit in a window is allowed');
select is((select allowed from public.consume_rate_limit('lead:test-key', 2, 60)), false, 'the hit past the limit is refused');
select ok(
  (select retry_after_seconds between 1 and 60 from public.consume_rate_limit('lead:test-key', 2, 60)),
  'a refused hit reports when the window resets'
);
select is((select allowed from public.consume_rate_limit('lead:other-key', 2, 60)), true, 'buckets are independent');
select throws_ok(
  $$ select * from public.consume_rate_limit('lead:test-key', 0, 60) $$,
  '22023', 'max hits is invalid', 'consume_rate_limit refuses a zero limit'
);

-- ---------------------------------------------------------------------------
-- What was stored (read as the owner)
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select count(*)::integer from public.lead_submissions where email = 'parent@example.com'),
  1,
  'one row per normalised email'
);
select is(
  (select concat_ws('|', first_name, age_band, consent_version, consent_state, locale)
     from public.lead_submissions where email = 'parent@example.com'),
  'Sam|3-5|consent-v2|granted|en-GB',
  'a repeat signup keeps earlier details and records the current consent version'
);
select is(
  (select acknowledgement_status from public.lead_submissions where email = 'parent@example.com'),
  'failed',
  'the lead mirrors its acknowledgement status'
);
select ok(
  (select e.attempts = 1 and e.last_error_code = 'send_timeout' and e.next_attempt_at > now() and e.provider_message_id is null
     from public.lead_delivery_events e
     join public.lead_submissions l on l.id = e.lead_id
    where l.email = 'parent@example.com' and e.kind = 'acknowledgement'),
  'a failed acknowledgement keeps its error code and is scheduled for retry'
);

select * from finish();
rollback;
