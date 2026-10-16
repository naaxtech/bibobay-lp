-- pgTAP checks for migration 0006: the email outbox worker (Task 8a; rulings R88-R92).
--
-- Runs in one transaction and rolls back, so it leaves nothing behind. Run against a Supabase
-- project with `supabase test db` (Task 11); tests/orders/migration-database.test.ts runs it in an
-- embedded Postgres, after every migration, on every `npm test`. Inside one transaction now() is
-- fixed, so the time rules are tested by moving the rows' own timestamps.
--
-- Covers: the claim and record functions are security definers with an empty search_path,
-- executable by service_role only, and the failure helper is executable by nobody; claiming takes
-- due rows only, counts the attempt and never hands one row out twice; every delivery kind of a
-- withdrawn lead is skipped (R92); a row stuck in `sending` is claimed again after 15 minutes and
-- parked after 23 hours, and an unconfirmed failure is never retried outside that window (R91);
-- failures back off exponentially and are final after the eighth attempt; a deferred claim hands the
-- row back uncounted; the order outbox's idempotency keys (R90), the quote kind, and quote_sent_at
-- set in the statement that records an accepted quote.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(146);

-- ---------------------------------------------------------------------------
-- Functions and grants
-- ---------------------------------------------------------------------------

select is_definer('public', 'claim_lead_deliveries', array['integer', 'uuid', 'text[]'], 'claim_lead_deliveries is security definer');
select is_definer('public', 'claim_order_emails', array['integer', 'uuid', 'text[]'], 'claim_order_emails is security definer');
select is_definer('public', 'record_order_email_attempt', array['uuid', 'text', 'text', 'text'], 'record_order_email_attempt is security definer');
select is_definer('public', 'record_lead_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'record_lead_delivery_attempt stays a security definer');
select is_definer('public', 'enqueue_lead_delivery', array['uuid', 'text', 'boolean'], 'enqueue_lead_delivery stays a security definer');
select isnt_definer('public', 'outbox_failure_unconfirmed', array['text'], 'the failure helper runs with its caller''s rights');
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('claim_lead_deliveries', 'claim_order_emails', 'record_order_email_attempt', 'record_lead_delivery_attempt', 'enqueue_lead_delivery', 'outbox_failure_unconfirmed')
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every outbox function pins an empty search_path'
);
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as acl
     where p.pronamespace = 'public'::regnamespace and acl.grantee = 0 and acl.privilege_type = 'EXECUTE' $$,
  'no function in public is executable by PUBLIC'
);

select function_privs_are('public', 'claim_lead_deliveries', array['integer', 'uuid', 'text[]'], 'anon', array[]::text[], 'anon cannot claim lead deliveries');
select function_privs_are('public', 'claim_lead_deliveries', array['integer', 'uuid', 'text[]'], 'authenticated', array[]::text[], 'authenticated cannot claim lead deliveries');
select function_privs_are('public', 'claim_lead_deliveries', array['integer', 'uuid', 'text[]'], 'service_role', array['EXECUTE'], 'service_role can claim lead deliveries');
select function_privs_are('public', 'claim_order_emails', array['integer', 'uuid', 'text[]'], 'anon', array[]::text[], 'anon cannot claim order emails');
select function_privs_are('public', 'claim_order_emails', array['integer', 'uuid', 'text[]'], 'authenticated', array[]::text[], 'authenticated cannot claim order emails');
select function_privs_are('public', 'claim_order_emails', array['integer', 'uuid', 'text[]'], 'service_role', array['EXECUTE'], 'service_role can claim order emails');
select function_privs_are('public', 'record_order_email_attempt', array['uuid', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot record an order email');
select function_privs_are('public', 'record_order_email_attempt', array['uuid', 'text', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot record an order email');
select function_privs_are('public', 'record_order_email_attempt', array['uuid', 'text', 'text', 'text'], 'service_role', array['EXECUTE'], 'service_role can record an order email');
select function_privs_are('public', 'outbox_failure_unconfirmed', array['text'], 'anon', array[]::text[], 'anon cannot run the failure helper');
select function_privs_are('public', 'outbox_failure_unconfirmed', array['text'], 'authenticated', array[]::text[], 'authenticated cannot run the failure helper');
select function_privs_are('public', 'outbox_failure_unconfirmed', array['text'], 'service_role', array[]::text[], 'service_role cannot run the failure helper');

set local role anon;
select throws_ok($$ select public.claim_lead_deliveries(1) $$, '42501', null, 'anon cannot call claim_lead_deliveries');
select throws_ok($$ select public.claim_order_emails(1) $$, '42501', null, 'anon cannot call claim_order_emails');
select throws_ok($$ select public.record_order_email_attempt(gen_random_uuid(), 'sent', 're_1') $$, '42501', null, 'anon cannot call record_order_email_attempt');
reset role;
set local role authenticated;
select throws_ok($$ select public.claim_lead_deliveries(1) $$, '42501', null, 'authenticated cannot call claim_lead_deliveries');
select throws_ok($$ select public.claim_order_emails(1) $$, '42501', null, 'authenticated cannot call claim_order_emails');
select throws_ok($$ select public.record_order_email_attempt(gen_random_uuid(), 'sent', 're_1') $$, '42501', null, 'authenticated cannot call record_order_email_attempt');
reset role;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

select has_column('public', 'order_email_outbox', 'idempotency_key', 'order emails carry an idempotency key (R90)');
select col_not_null('public', 'order_email_outbox', 'idempotency_key', 'every order email has one');
select col_is_unique('public', 'order_email_outbox', 'idempotency_key', 'and it is unique');
select has_column('public', 'order_email_outbox', 'quote_revision', 'a quote email names the quote revision it was queued for');
select has_column('public', 'orders', 'quote_revision', 'orders count their quote revisions');
select col_not_null('public', 'orders', 'quote_revision', 'the quote revision is never null');
select col_default_is('public', 'orders', 'quote_revision', '0', 'and starts at 0');
select has_column('public', 'lead_delivery_events', 'unconfirmed_since', 'lead deliveries record when a send became unconfirmed');
select has_column('public', 'order_email_outbox', 'unconfirmed_since', 'order emails record when a send became unconfirmed');
select has_column('public', 'lead_delivery_events', 'claimed_at', 'lead deliveries record when the current holder claimed them (review M5)');
select has_column('public', 'order_email_outbox', 'claimed_at', 'order emails record when the current holder claimed them (review M5)');

-- ---------------------------------------------------------------------------
-- Lead deliveries
-- ---------------------------------------------------------------------------

reset role;
insert into public.lead_submissions (email, first_name, consent_state, consent_version, consent_withdrawn_at, source)
values ('gone@example.com', 'Alex', 'withdrawn', 'consent-v1', now() - interval '1 day', 'landing');

set local role service_role;
create temp table lead_a on commit drop as select * from public.submit_lead('parent-a@example.com', true, 'consent-v1', 'Ana', '3-5', 'landing');
create temp table lead_gone on commit drop as select * from public.submit_lead('gone@example.com', true, 'consent-v9', 'Mallory');
create temp table queued_a on commit drop as
  select * from public.enqueue_lead_delivery((select lead_id from lead_a), 'acknowledgement')
  union all
  select * from public.enqueue_lead_delivery((select lead_id from lead_a), 'staff_alert');
create temp table queued_gone on commit drop as
  select * from public.enqueue_lead_delivery((select lead_id from lead_gone), 'acknowledgement', true)
  union all
  select * from public.enqueue_lead_delivery((select lead_id from lead_gone), 'staff_alert', true);

select is(
  (select array_agg(q.status order by q.status) from queued_gone as q),
  array['pending', 'pending'],
  'enqueueing never claims any delivery kind of a withdrawn lead (R92)'
);

create temp table claim_1 on commit drop as select public.claim_lead_deliveries(10) as result;
create temp table ids on commit drop as
  select c ->> 'kind' as kind, (c ->> 'id')::uuid as id from claim_1, jsonb_array_elements(claim_1.result -> 'claimed') as c;

select is((select (result ->> 'skipped')::integer from claim_1), 2, 'claiming skips both rows of the withdrawn lead (R92)');
select is((select (result ->> 'expired')::integer from claim_1), 0, 'nothing has expired');
select is((select jsonb_array_length(result -> 'claimed') from claim_1), 2, 'and claims both rows of the other lead');
select is((select array_agg(kind order by kind) from ids), array['acknowledgement', 'staff_alert'], 'one acknowledgement and one staff alert');
select is(
  (select array_agg(distinct k order by k) from claim_1, jsonb_array_elements(claim_1.result -> 'claimed') as c, jsonb_object_keys(c) as k),
  array['ageBand', 'attempt', 'email', 'firstName', 'id', 'kind', 'source'],
  'a claimed delivery carries only what its email needs'
);
select is(
  (select c - 'id' from claim_1, jsonb_array_elements(claim_1.result -> 'claimed') as c where c ->> 'kind' = 'acknowledgement'),
  '{"kind": "acknowledgement", "attempt": 1, "email": "parent-a@example.com", "firstName": "Ana", "ageBand": "3-5", "source": "landing"}'::jsonb,
  'with the stored adult details and the attempt number'
);
select is((select count(*)::integer from ids where id in (select event_id from queued_a)), 2, 'the claimed ids are the lead''s outbox rows');
select ok((select result::text !~ 'gone@example|Mallory|Alex' from claim_1), 'nothing about the withdrawn adult is returned');
select is(jsonb_array_length(public.claim_lead_deliveries(10) -> 'claimed'), 0, 'a claimed row is never handed out twice (no double send)');

reset role;
select results_eq(
  $$ select e.kind, e.status, e.attempts from public.lead_delivery_events as e where e.lead_id = (select lead_id from lead_a) order by e.kind $$,
  $$ values ('acknowledgement'::text, 'sending'::text, 1), ('staff_alert', 'sending', 1) $$,
  'claiming marks each row sending and counts the attempt (R91)'
);
select is((select acknowledgement_status from public.lead_submissions where email = 'parent-a@example.com'), 'sending', 'the lead mirrors its acknowledgement''s status');
select results_eq(
  $$ select e.kind, e.status, e.last_error_code from public.lead_delivery_events as e where e.lead_id = (select lead_id from lead_gone) order by e.kind $$,
  $$ values ('acknowledgement'::text, 'skipped'::text, 'lead_withdrawn'::text), ('staff_alert', 'skipped', 'lead_withdrawn') $$,
  'every delivery kind of a withdrawn lead is marked skipped, with the reason (R92)'
);
select is((select acknowledgement_status from public.lead_submissions where email = 'gone@example.com'), 'skipped', 'and its acknowledgement mirror says skipped');
select is((select attempts from public.lead_delivery_events where lead_id = (select lead_id from lead_gone) and kind = 'acknowledgement'), 0, 'a skipped row counts no attempt');

-- Recording outcomes
set local role service_role;
select is(public.record_lead_delivery_attempt((select id from ids where kind = 'acknowledgement'), 'sent', 're_ack_1'), true, 'an accepted send is recorded on the claimed row');
select is(public.record_lead_delivery_attempt((select id from ids where kind = 'staff_alert'), 'failed', null, 'rate_limit_exceeded'), true, 'a refused send is recorded too');
select is(public.record_lead_delivery_attempt((select id from ids where kind = 'acknowledgement'), 'failed', null, 'send_timeout'), false, 'a recorded row cannot be recorded again');

reset role;
select ok(
  (select e.status = 'sent' and e.provider_message_id = 're_ack_1' and e.last_error_code is null from public.lead_delivery_events as e where e.id = (select id from ids where kind = 'acknowledgement')),
  'the accepted send keeps the provider''s message id'
);
select is((select acknowledgement_status from public.lead_submissions where email = 'parent-a@example.com'), 'sent', 'the lead mirrors the sent acknowledgement');
select ok(
  (select e.status = 'failed' and e.last_error_code = 'rate_limit_exceeded' and e.next_attempt_at = now() + interval '2 minutes' and e.unconfirmed_since is null
     from public.lead_delivery_events as e where e.id = (select id from ids where kind = 'staff_alert')),
  'a refused send backs off (2 minutes after attempt 1) and is not unconfirmed: the provider answered'
);

set local role service_role;
select is(jsonb_array_length(public.claim_lead_deliveries(10, (select lead_id from lead_a)) -> 'claimed'), 0, 'a failed row waits for its next attempt time, and a sent row is never claimed');

reset role;
update public.lead_delivery_events set next_attempt_at = now() - interval '1 second' where id = (select id from ids where kind = 'staff_alert');
set local role service_role;
create temp table claim_2 on commit drop as select public.claim_lead_deliveries(10, (select lead_id from lead_a)) as result;
select is((select jsonb_array_length(result -> 'claimed') from claim_2), 1, 'once due, the failed row is claimed again');
select is((select (result -> 'claimed' -> 0 ->> 'attempt')::integer from claim_2), 2, 'as attempt 2');
select is((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_2), (select id from ids where kind = 'staff_alert'), 'under the same row id, which is its provider idempotency key (R91)');
select is(public.record_lead_delivery_attempt((select id from ids where kind = 'staff_alert'), 'failed', null, 'send_timeout'), true, 'a timed-out send is recorded as failed');

reset role;
select ok(
  (select e.unconfirmed_since = now() and e.next_attempt_at = now() + interval '4 minutes' from public.lead_delivery_events as e where e.id = (select id from ids where kind = 'staff_alert')),
  'a timeout leaves the send unconfirmed from the attempt''s claim, and backs off 4 minutes after attempt 2'
);
update public.lead_delivery_events
   set unconfirmed_since = now() - interval '23 hours 1 minute', next_attempt_at = now() - interval '1 second'
 where id = (select id from ids where kind = 'staff_alert');
set local role service_role;
create temp table claim_3 on commit drop as select public.claim_lead_deliveries(10, (select lead_id from lead_a)) as result;
select is((select jsonb_array_length(result -> 'claimed') from claim_3), 0, 'an unconfirmed send is never retried after 23 hours, outside the provider''s idempotency window (R91)');
select is((select (result ->> 'expired')::integer from claim_3), 1, 'the claim reports it as expired');
reset role;
select ok(
  (select e.status = 'failed' and e.last_error_code = 'stale_unconfirmed' and e.next_attempt_at = 'infinity'::timestamptz
     from public.lead_delivery_events as e where e.id = (select id from ids where kind = 'staff_alert')),
  'and parks it as failed with stale_unconfirmed, for a human to check'
);

-- A row stuck in sending (R91)
set local role service_role;
create temp table lead_c on commit drop as select * from public.submit_lead('parent-c@example.com', true, 'consent-v1');
create temp table queued_c on commit drop as select * from public.enqueue_lead_delivery((select lead_id from lead_c), 'acknowledgement');
create temp table claim_c1 on commit drop as select public.claim_lead_deliveries(1, (select lead_id from lead_c), array['acknowledgement']) as result;
select is((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_c1), (select event_id from queued_c), 'a claim can name one lead and kind (the immediate send after the answer, R88)');

reset role;
update public.lead_delivery_events set claimed_at = now() - interval '14 minutes' where id = (select event_id from queued_c);
set local role service_role;
select is(jsonb_array_length(public.claim_lead_deliveries(10, (select lead_id from lead_c)) -> 'claimed'), 0, 'a row sending for under 15 minutes is left alone');

reset role;
update public.lead_delivery_events set claimed_at = now() - interval '16 minutes' where id = (select event_id from queued_c);
set local role service_role;
create temp table claim_c2 on commit drop as select public.claim_lead_deliveries(10, (select lead_id from lead_c)) as result;
select is((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_c2), (select event_id from queued_c), 'a row stuck in sending for over 15 minutes is claimed again, under the same id (R91)');
select is((select (result -> 'claimed' -> 0 ->> 'attempt')::integer from claim_c2), 2, 'as its next attempt');

reset role;
select is((select unconfirmed_since from public.lead_delivery_events where id = (select event_id from queued_c)), now() - interval '16 minutes', 'the stuck attempt counts as unconfirmed from when it was claimed');
update public.lead_delivery_events
   set claimed_at = now() - interval '16 minutes', unconfirmed_since = now() - interval '23 hours 1 minute'
 where id = (select event_id from queued_c);
set local role service_role;
create temp table claim_c3 on commit drop as select public.claim_lead_deliveries(10, (select lead_id from lead_c)) as result;
select ok((select jsonb_array_length(result -> 'claimed') = 0 and (result ->> 'expired')::integer = 1 from claim_c3), 'a row stuck in sending past 23 hours is never sent again (R91)');
reset role;
select ok(
  (select e.status = 'failed' and e.last_error_code = 'stale_unconfirmed' and e.next_attempt_at = 'infinity'::timestamptz from public.lead_delivery_events as e where e.id = (select event_id from queued_c)),
  'it is parked as failed with stale_unconfirmed'
);
select is((select acknowledgement_status from public.lead_submissions where email = 'parent-c@example.com'), 'failed', 'and the lead mirrors the failure');

-- A row claimed once and stuck for a day, with no earlier failure
set local role service_role;
create temp table lead_d on commit drop as select * from public.submit_lead('parent-d@example.com', true, 'consent-v1');
create temp table queued_d on commit drop as select * from public.enqueue_lead_delivery((select lead_id from lead_d), 'acknowledgement', true);
reset role;
update public.lead_delivery_events set claimed_at = now() - interval '25 hours' where id = (select event_id from queued_d);
set local role service_role;
select is((public.claim_lead_deliveries(10, (select lead_id from lead_d)) ->> 'expired')::integer, 1, 'a sending row claimed over 23 hours ago is parked, never re-sent');

-- The attempt cap
set local role service_role;
create temp table lead_e on commit drop as select * from public.submit_lead('parent-e@example.com', true, 'consent-v1');
create temp table queued_e on commit drop as
  select * from public.enqueue_lead_delivery((select lead_id from lead_e), 'acknowledgement')
  union all
  select * from public.enqueue_lead_delivery((select lead_id from lead_e), 'staff_alert');
reset role;
update public.lead_delivery_events set attempts = 7, status = 'failed', last_error_code = 'rate_limit_exceeded' where lead_id = (select lead_id from lead_e) and kind = 'acknowledgement';
set local role service_role;
create temp table claim_e on commit drop as select public.claim_lead_deliveries(10, (select lead_id from lead_e), array['acknowledgement']) as result;
select is((select (result -> 'claimed' -> 0 ->> 'attempt')::integer from claim_e), 8, 'the eighth attempt is still claimed');
select is(public.record_lead_delivery_attempt((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_e), 'failed', null, 'rate_limit_exceeded'), true, 'and its failure recorded');
reset role;
select ok(
  (select e.status = 'failed' and e.next_attempt_at = 'infinity'::timestamptz from public.lead_delivery_events as e where e.lead_id = (select lead_id from lead_e) and e.kind = 'acknowledgement'),
  'after the eighth attempt a failure is final: the row is never due again'
);

-- A key the provider says it has seen with another payload: the first may have been delivered
set local role service_role;
create temp table claim_e2 on commit drop as select public.claim_lead_deliveries(10, (select lead_id from lead_e), array['staff_alert']) as result;
select is(public.record_lead_delivery_attempt((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_e2), 'failed', null, 'invalid_idempotent_request'), true, 'an idempotency conflict is recorded');
reset role;
select ok(
  (select e.next_attempt_at = 'infinity'::timestamptz and e.attempts = 1 from public.lead_delivery_events as e where e.lead_id = (select lead_id from lead_e) and e.kind = 'staff_alert'),
  'and is final at once: a retry after the window could repeat a delivered email'
);

-- Deferral: the send budget was spent, so the claim is handed back
set local role service_role;
create temp table lead_g on commit drop as select * from public.submit_lead('parent-g@example.com', true, 'consent-v1');
create temp table queued_g on commit drop as select * from public.enqueue_lead_delivery((select lead_id from lead_g), 'acknowledgement');
select is((public.claim_lead_deliveries(1, (select lead_id from lead_g)) -> 'claimed' -> 0 ->> 'attempt')::integer, 1, 'a fresh row is claimed as attempt 1');
select is(public.record_lead_delivery_attempt((select event_id from queued_g), 'deferred'), true, 'a claim can be handed back without an attempt');
select is(public.record_lead_delivery_attempt((select event_id from queued_g), 'deferred'), false, 'only a claimed row can be handed back');
reset role;
select results_eq(
  $$ select e.status, e.attempts, e.next_attempt_at <= now(), e.last_attempt_at is null, e.claimed_at is null from public.lead_delivery_events as e where e.id = (select event_id from queued_g) $$,
  $$ values ('pending'::text, 0, true, true, true) $$,
  'a deferred row is pending again, uncounted, still due, and shows no attempt time (review M5)'
);
select is((select acknowledgement_status from public.lead_submissions where email = 'parent-g@example.com'), 'pending', 'and the lead mirrors it');
set local role service_role;
select is((public.claim_lead_deliveries(1, (select lead_id from lead_g)) -> 'claimed' -> 0 ->> 'attempt')::integer, 1, 'the next claim is attempt 1 again');
select is(public.record_lead_delivery_attempt((select event_id from queued_g), 'failed', null, 'rate_limit_exceeded'), true, 'it fails');
reset role;
update public.lead_delivery_events set next_attempt_at = now() - interval '1 second' where id = (select event_id from queued_g);
set local role service_role;
select is((public.claim_lead_deliveries(1, (select lead_id from lead_g)) -> 'claimed' -> 0 ->> 'attempt')::integer, 2, 'is claimed again as attempt 2');
select is(public.record_lead_delivery_attempt((select event_id from queued_g), 'deferred'), true, 'and handed back');
reset role;
select results_eq(
  $$ select e.status, e.attempts, e.last_error_code from public.lead_delivery_events as e where e.id = (select event_id from queued_g) $$,
  $$ values ('failed'::text, 1, 'rate_limit_exceeded'::text) $$,
  'a deferred retry returns to failed with its earlier attempt count and reason'
);

-- Review M3: an error the code does not know may have reached the provider, so it is unconfirmed;
-- only a known refusal counts as an answer.
set local role service_role;
create temp table lead_m3 on commit drop as select * from public.submit_lead('parent-m3@example.com', true, 'consent-v1');
create temp table queued_m3 on commit drop as select * from public.enqueue_lead_delivery((select lead_id from lead_m3), 'acknowledgement');
create temp table queued_m3b on commit drop as select * from public.enqueue_lead_delivery((select lead_id from lead_m3), 'staff_alert');
select is(jsonb_array_length(public.claim_lead_deliveries(2, (select lead_id from lead_m3)) -> 'claimed'), 2, 'both rows are claimed');
select is(public.record_lead_delivery_attempt((select event_id from queued_m3), 'failed', null, 'brand_new_provider_error'), true, 'an unknown error is recorded');
select is(public.record_lead_delivery_attempt((select event_id from queued_m3b), 'failed', null, 'validation_error'), true, 'a known refusal is recorded');
reset role;
select results_eq(
  $$ select e.kind, e.unconfirmed_since is not null from public.lead_delivery_events as e where e.lead_id = (select lead_id from lead_m3) order by e.kind $$,
  $$ values ('acknowledgement'::text, true), ('staff_alert'::text, false) $$,
  'an unknown error leaves the send unconfirmed; a known refusal does not'
);

-- Arguments
set local role service_role;
select throws_ok($$ select public.claim_lead_deliveries(0) $$, '22023', 'claim limit is invalid', 'a claim takes at least one row');
select throws_ok($$ select public.claim_lead_deliveries(51) $$, '22023', 'claim limit is invalid', 'and at most fifty');
select throws_ok($$ select public.claim_lead_deliveries(null) $$, '22023', 'claim limit is invalid', 'and always a bound');
select throws_ok($$ select public.claim_lead_deliveries(1, null, array['newsletter']) $$, '22023', 'delivery kind is invalid', 'only the lead message kinds can be claimed');
select throws_ok($$ select public.claim_lead_deliveries(1, null, array[]::text[]) $$, '22023', 'delivery kind is invalid', 'an empty kind list is refused');
select throws_ok($$ select public.record_lead_delivery_attempt(gen_random_uuid(), 'skipped') $$, '22023', 'delivery status is invalid', 'skipping is the claim''s decision, never the caller''s');

-- ---------------------------------------------------------------------------
-- Order emails
-- ---------------------------------------------------------------------------

set local role service_role;
create temp table order_a on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Sam Rivers', p_email => 'buyer@example.com', p_address_line1 => '12 Harbour Road',
    p_city => 'Seaside', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-tula", "title": "Tula plush", "sku": "BB-TULA-01", "variant": "Large", "pack": "Single", "quantity": 2},
                 {"sanity_id": "product-bob", "title": "Bob book", "sku": null, "variant": null, "pack": null, "quantity": 1}]'::jsonb,
    p_phone => '+61 2 5550 1234', p_notes => 'Leave at the door', p_submission_key => gen_random_uuid()
  );
create temp table order_b on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Alex Shore', p_email => 'other@example.com', p_address_line1 => '3 Reef Street',
    p_city => 'Bayview', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-lumi", "title": "Lumi puzzle", "quantity": 1}]'::jsonb,
    p_submission_key => gen_random_uuid()
  );
create temp table order_c on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Jo Tide', p_email => 'third@example.com', p_address_line1 => '9 Kelp Lane',
    p_city => 'Bayview', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-lumi", "title": "Lumi puzzle", "quantity": 3}]'::jsonb,
    p_submission_key => gen_random_uuid()
  );

reset role;
select results_eq(
  $$ select x.kind, x.idempotency_key, x.quote_revision from public.order_email_outbox as x where x.order_id = (select order_id from order_a) order by x.kind $$,
  $$ values ('acknowledgement'::text, (select order_id from order_a)::text || ':acknowledgement', null::integer),
            ('staff_alert', (select order_id from order_a)::text || ':staff_alert', null) $$,
  'submit_order''s rows carry the keys <order id>:acknowledgement and <order id>:staff_alert (R90)'
);
select throws_ok(
  format($$ insert into public.order_email_outbox (order_id, kind) values (%L, 'acknowledgement') $$, (select order_id from order_a)),
  '23505', null, 'a second acknowledgement for one order is refused by its idempotency key'
);
select throws_ok(
  format($$ insert into public.order_email_outbox (order_id, kind, idempotency_key) values (%L, 'acknowledgement', 'chosen') $$, (select order_id from order_b)),
  '428C9', null, 'nobody can write an idempotency key by hand: it is derived from the row'
);

update public.orders
   set currency = 'AUD', subtotal_minor = 12345, freight_minor = 1500, payment_url = 'https://pay.example.com/checkout/abc', quote_revision = 1
 where id = (select order_id from order_a);
insert into public.order_email_outbox (order_id, kind, quote_revision) values ((select order_id from order_a), 'quote', 1);

select is(
  (select x.idempotency_key from public.order_email_outbox as x where x.order_id = (select order_id from order_a) and x.kind = 'quote'),
  (select order_id from order_a)::text || ':quote:1',
  'a quote row''s key is <order id>:quote:<revision> (R90)'
);
select throws_ok(
  format($$ insert into public.order_email_outbox (order_id, kind, quote_revision) values (%L, 'quote', 1) $$, (select order_id from order_a)),
  '23505', null, 'one quote revision is queued at most once'
);
select lives_ok(
  format($$ insert into public.order_email_outbox (order_id, kind, quote_revision, status) values (%L, 'quote', 9, 'skipped') $$, (select order_id from order_a)),
  'another revision of the same order''s quote is its own row, and skipped is a status'
);
select throws_ok(
  format($$ insert into public.order_email_outbox (order_id, kind) values (%L, 'quote') $$, (select order_id from order_b)),
  '23514', null, 'a quote row must name its revision'
);
select throws_ok(
  format($$ insert into public.order_email_outbox (order_id, kind, quote_revision) values (%L, 'quote', 0) $$, (select order_id from order_b)),
  '23514', null, 'a quote revision starts at 1'
);
select throws_ok(
  format($$ insert into public.order_email_outbox (order_id, kind, quote_revision) values (%L, 'staff_alert', 1) $$, (select order_id from order_b)),
  '23514', null, 'only a quote row names a revision'
);
select throws_ok(
  format($$ update public.orders set quote_revision = -1 where id = %L $$, (select order_id from order_b)),
  '23514', null, 'an order''s quote revision is never negative'
);

-- Claiming the two submission emails
set local role service_role;
create temp table oclaim_1 on commit drop as
  select public.claim_order_emails(10, (select order_id from order_a), array['acknowledgement', 'staff_alert']) as result;
create temp table oids on commit drop as
  select c ->> 'kind' as kind, (c ->> 'id')::uuid as id from oclaim_1, jsonb_array_elements(oclaim_1.result -> 'claimed') as c;

select is((select array_agg(kind order by kind) from oids), array['acknowledgement', 'staff_alert'], 'the order''s acknowledgement and staff alert are claimed, and the queued quote is not (kinds named)');
select is(
  (select array_agg(distinct k order by k) from oclaim_1, jsonb_array_elements(oclaim_1.result -> 'claimed') as c, jsonb_object_keys(c) as k),
  array['attempt', 'contactName', 'email', 'id', 'kind', 'lines', 'quote', 'reference'],
  'a claimed order email carries only what the email needs'
);
select is(
  (select c - 'id' from oclaim_1, jsonb_array_elements(oclaim_1.result -> 'claimed') as c where c ->> 'kind' = 'acknowledgement'),
  jsonb_build_object(
    'kind', 'acknowledgement', 'attempt', 1, 'reference', (select reference from order_a), 'contactName', 'Sam Rivers', 'email', 'buyer@example.com',
    'lines', '[{"title": "Tula plush", "variant": "Large", "pack": "Single", "quantity": 2}, {"title": "Bob book", "variant": null, "pack": null, "quantity": 1}]'::jsonb,
    'quote', null
  ),
  'the reference, the contact name and email, and each line''s title, variant, pack and quantity in order'
);
select ok(
  (select result::text !~* 'harbour|seaside|5550|door|BB-TULA|product-|[0-9a-f]{64}' from oclaim_1),
  'never the address, phone, notes, SKU, product id or the tracking token hash'
);
select is(jsonb_array_length(public.claim_order_emails(10, (select order_id from order_a), array['acknowledgement', 'staff_alert']) -> 'claimed'), 0, 'a claimed order email is never handed out twice');
select is(public.record_order_email_attempt((select id from oids where kind = 'acknowledgement'), 'sent', 're_order_ack'), true, 'an accepted order email is recorded');
select is(public.record_order_email_attempt((select id from oids where kind = 'acknowledgement'), 'sent', 're_order_ack'), false, 'once');

reset role;
select ok(
  (select o.quote_sent_at is null from public.orders as o where o.id = (select order_id from order_a)),
  'an acknowledgement leaves quote_sent_at alone'
);

-- The quote
set local role service_role;
create temp table oclaim_q on commit drop as select public.claim_order_emails(10, (select order_id from order_a), array['quote']) as result;
select is((select jsonb_array_length(result -> 'claimed') from oclaim_q), 1, 'the queued quote revision is claimed');
select is(
  (select result -> 'claimed' -> 0 -> 'quote' from oclaim_q),
  '{"currency": "AUD", "subtotalMinor": 12345, "freightMinor": 1500, "paymentUrl": "https://pay.example.com/checkout/abc", "revision": 1}'::jsonb,
  'with the quote it was queued for'
);
select is(public.record_order_email_attempt((select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_q), 'failed', null, 'rate_limit_exceeded'), true, 'a refused quote is recorded');
reset role;
select ok((select o.quote_sent_at is null from public.orders as o where o.id = (select order_id from order_a)), 'a failed quote never sets quote_sent_at');
update public.order_email_outbox set next_attempt_at = now() - interval '1 second' where id = (select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_q);
set local role service_role;
select is(
  (public.claim_order_emails(10, (select order_id from order_a), array['quote']) -> 'claimed' -> 0 ->> 'attempt')::integer,
  2,
  'the quote is retried as attempt 2'
);
select is(public.record_order_email_attempt((select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_q), 'sent', 're_quote_1'), true, 'and accepted');
reset role;
select is((select o.quote_sent_at from public.orders as o where o.id = (select order_id from order_a)), now(), 'quote_sent_at is set when the provider accepts the quote, in the same statement (R90)');

-- Quotes that must not go out
update public.orders set quote_revision = 3 where id = (select order_id from order_a);
insert into public.order_email_outbox (order_id, kind, quote_revision) values ((select order_id from order_a), 'quote', 2);
update public.orders set quote_revision = 1 where id = (select order_id from order_b);
insert into public.order_email_outbox (order_id, kind, quote_revision) values ((select order_id from order_b), 'quote', 1);
update public.orders
   set currency = 'AUD', subtotal_minor = 900, freight_minor = 0, payment_url = 'https://pay.example.com/checkout/c', quote_revision = 1, status = 'cancelled'
 where id = (select order_id from order_c);
insert into public.order_email_outbox (order_id, kind, quote_revision) values ((select order_id from order_c), 'quote', 1);
set local role service_role;
create temp table order_p on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Pat Reef', p_email => 'paid@example.com', p_address_line1 => '2 Coral Way',
    p_city => 'Bayview', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-lumi", "title": "Lumi puzzle", "quantity": 1}]'::jsonb,
    p_submission_key => gen_random_uuid()
  );
reset role;
update public.orders
   set currency = 'AUD', subtotal_minor = 900, freight_minor = 0, payment_url = 'https://pay.example.com/checkout/p', quote_revision = 1, status = 'paid'
 where id = (select order_id from order_p);
insert into public.order_email_outbox (order_id, kind, quote_revision) values ((select order_id from order_p), 'quote', 1);

set local role service_role;
select is((public.claim_order_emails(10, (select order_id from order_a), array['quote']) ->> 'skipped')::integer, 1, 'a quote revision older than the order''s current quote is skipped');
select is((public.claim_order_emails(10, (select order_id from order_b), array['quote']) ->> 'skipped')::integer, 1, 'a quote without a full quote on the order is skipped');
select is((public.claim_order_emails(10, (select order_id from order_c), array['quote']) ->> 'skipped')::integer, 1, 'a quote for a cancelled order is skipped');
select is((public.claim_order_emails(10, (select order_id from order_p), array['quote']) ->> 'skipped')::integer, 1, 'a quote for an order already paid (or later) is skipped (review M7)');
reset role;
select results_eq(
  $$ select o.reference = (select reference from order_a), x.status, x.last_error_code
       from public.order_email_outbox as x join public.orders as o on o.id = x.order_id
      where x.kind = 'quote' and x.status = 'skipped' and x.last_error_code is not null
      order by x.last_error_code $$,
  $$ values (false, 'skipped'::text, 'order_cancelled'::text), (false, 'skipped', 'order_past_quote'), (false, 'skipped', 'quote_incomplete'), (true, 'skipped', 'quote_superseded') $$,
  'each skipped quote says why'
);

-- Stuck and failing order emails follow the same rules as lead deliveries
set local role service_role;
create temp table oclaim_b on commit drop as select public.claim_order_emails(10, (select order_id from order_b), array['acknowledgement']) as result;
reset role;
update public.order_email_outbox set claimed_at = now() - interval '16 minutes' where id = (select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_b);
set local role service_role;
select is(
  (public.claim_order_emails(10, (select order_id from order_b), array['acknowledgement']) -> 'claimed' -> 0 ->> 'attempt')::integer,
  2,
  'an order email stuck in sending for over 15 minutes is claimed again (R91)'
);
reset role;
update public.order_email_outbox
   set claimed_at = now() - interval '16 minutes', unconfirmed_since = now() - interval '23 hours 1 minute'
 where id = (select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_b);
set local role service_role;
select is((public.claim_order_emails(10, (select order_id from order_b), array['acknowledgement']) ->> 'expired')::integer, 1, 'and parked once it is past 23 hours');
reset role;
select ok(
  (select x.status = 'failed' and x.last_error_code = 'stale_unconfirmed' and x.next_attempt_at = 'infinity'::timestamptz
     from public.order_email_outbox as x where x.id = (select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_b)),
  'as failed with stale_unconfirmed'
);
update public.order_email_outbox set attempts = 7, status = 'failed', last_error_code = 'rate_limit_exceeded'
 where order_id = (select order_id from order_b) and kind = 'staff_alert';
set local role service_role;
create temp table oclaim_b2 on commit drop as select public.claim_order_emails(10, (select order_id from order_b), array['staff_alert']) as result;
select is(public.record_order_email_attempt((select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_b2), 'failed', null, 'send_timeout'), true, 'an eighth failed order email is recorded');
reset role;
select ok(
  (select x.status = 'failed' and x.attempts = 8 and x.next_attempt_at = 'infinity'::timestamptz and x.unconfirmed_since = now()
     from public.order_email_outbox as x where x.order_id = (select order_id from order_b) and x.kind = 'staff_alert'),
  'and is final, and unconfirmed'
);

set local role service_role;
create temp table oclaim_c on commit drop as select public.claim_order_emails(10, (select order_id from order_c), array['acknowledgement']) as result;
select is(public.record_order_email_attempt((select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_c), 'deferred'), true, 'an order email claim can be handed back');
reset role;
select results_eq(
  $$ select x.status, x.attempts from public.order_email_outbox as x where x.id = (select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_c) $$,
  $$ values ('pending'::text, 0) $$,
  'pending again and uncounted'
);
select is(
  (select count(*)::integer from public.order_email_outbox as x where x.order_id = (select order_id from order_c) and x.kind = 'staff_alert' and x.status = 'pending' and x.attempts = 0),
  1,
  'a claim that names a kind leaves the order''s other emails untouched'
);

-- Arguments
set local role service_role;
select throws_ok($$ select public.claim_order_emails(0) $$, '22023', 'claim limit is invalid', 'an order email claim takes at least one row');
select throws_ok($$ select public.claim_order_emails(51) $$, '22023', 'claim limit is invalid', 'and at most fifty');
select throws_ok($$ select public.claim_order_emails(1, null, array['newsletter']) $$, '22023', 'email kind is invalid', 'only the order email kinds can be claimed');
select throws_ok($$ select public.record_order_email_attempt(gen_random_uuid(), 'skipped') $$, '22023', 'delivery status is invalid', 'a caller cannot record skipped');
select throws_ok($$ select public.record_order_email_attempt(gen_random_uuid(), 'sent') $$, '22023', 'provider message id is invalid', 'an accepted send needs the provider''s message id');
select throws_ok($$ select public.record_order_email_attempt(gen_random_uuid(), 'failed', null, 'reason with spaces and buyer@example.com') $$, '22023', 'error code is invalid', 'only short error codes are stored, never provider messages');
select is(public.record_order_email_attempt(gen_random_uuid(), 'sent', 're_unknown'), false, 'an unknown row records nothing');

select * from finish();
rollback;
