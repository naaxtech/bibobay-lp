-- pgTAP checks for migration 0008: the contact form's messages and their own outbox (rulings
-- R159, R169, R175).
--
-- Runs in one transaction and rolls back, so it leaves nothing behind. Run against a Supabase
-- project with `supabase test db` (Task 11); tests/orders/migration-database.test.ts runs it in an
-- embedded Postgres, after every migration, on every `npm test`. Inside one transaction now() is
-- fixed, so the time rules are tested by moving the rows' own timestamps.
--
-- Covers: both tables have row level security enabled and forced, no policies and no privilege for
-- any API role; the three functions are security definers with an empty search_path, executable by
-- service_role only; one submit stores one message and exactly one staff alert, and refuses every
-- out-of-bounds field with 22023 while storing nothing; lengths count characters (code points), as
-- the form counts them; the claim, the 15-minute lease, the 23-hour parking, the backoff, the final
-- failures and the deferral follow the other outboxes (R169); there is no skipped status (R175);
-- deleting a message removes its alert; and the lead outbox is as migration 0006 left it.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(110);

-- ---------------------------------------------------------------------------
-- Tables: RLS enabled and forced, no policies, no privileges for any API role
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.contact_messages'::regclass),
  'contact_messages: row level security enabled and forced'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.contact_message_deliveries'::regclass),
  'contact_message_deliveries: row level security enabled and forced'
);
select is_empty(
  $$ select tablename::text from pg_catalog.pg_policies
     where schemaname = 'public' and tablename in ('contact_messages', 'contact_message_deliveries') $$,
  'no row policies on either contact table: every API role is denied by default'
);

select table_privs_are('public', 'contact_messages', 'anon', array[]::text[], 'anon has no privilege on contact_messages');
select table_privs_are('public', 'contact_messages', 'authenticated', array[]::text[], 'authenticated has no privilege on contact_messages');
select table_privs_are('public', 'contact_messages', 'service_role', array[]::text[], 'service_role reaches contact_messages only through RPCs');
select table_privs_are('public', 'contact_message_deliveries', 'anon', array[]::text[], 'anon has no privilege on contact_message_deliveries');
select table_privs_are('public', 'contact_message_deliveries', 'authenticated', array[]::text[], 'authenticated has no privilege on contact_message_deliveries');
select table_privs_are('public', 'contact_message_deliveries', 'service_role', array[]::text[], 'service_role reaches contact_message_deliveries only through RPCs');

select columns_are(
  'public', 'contact_messages',
  array['id', 'name', 'email', 'topic', 'message', 'created_at'],
  'a message holds its four fields and its time: no address, no user agent, no child data'
);
select columns_are(
  'public', 'contact_message_deliveries',
  array['id', 'message_id', 'kind', 'status', 'attempts', 'last_attempt_at', 'next_attempt_at', 'provider_message_id', 'last_error_code', 'unconfirmed_since', 'claimed_at', 'created_at', 'updated_at'],
  'the contact outbox has the lead outbox''s columns, keyed by message (R169)'
);

-- ---------------------------------------------------------------------------
-- Functions: security definer, empty search_path, service_role only
-- ---------------------------------------------------------------------------

select is_definer('public', 'submit_contact_message', array['text', 'text', 'text', 'text'], 'submit_contact_message is security definer');
select is_definer('public', 'claim_contact_deliveries', array['integer', 'uuid'], 'claim_contact_deliveries is security definer');
select is_definer('public', 'record_contact_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'record_contact_delivery_attempt is security definer');
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('submit_contact_message', 'claim_contact_deliveries', 'record_contact_delivery_attempt')
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every contact function pins an empty search_path'
);

select function_privs_are('public', 'submit_contact_message', array['text', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot submit a contact message');
select function_privs_are('public', 'claim_contact_deliveries', array['integer', 'uuid'], 'anon', array[]::text[], 'anon cannot claim contact alerts');
select function_privs_are('public', 'record_contact_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot record a contact alert');
select function_privs_are('public', 'submit_contact_message', array['text', 'text', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot submit a contact message');
select function_privs_are('public', 'claim_contact_deliveries', array['integer', 'uuid'], 'authenticated', array[]::text[], 'authenticated cannot claim contact alerts');
select function_privs_are('public', 'record_contact_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot record a contact alert');
select function_privs_are('public', 'submit_contact_message', array['text', 'text', 'text', 'text'], 'service_role', array['EXECUTE'], 'service_role can submit a contact message');
select function_privs_are('public', 'claim_contact_deliveries', array['integer', 'uuid'], 'service_role', array['EXECUTE'], 'service_role can claim contact alerts');
select function_privs_are('public', 'record_contact_delivery_attempt', array['uuid', 'text', 'text', 'text'], 'service_role', array['EXECUTE'], 'service_role can record a contact alert');

set local role anon;
select throws_ok($$ select * from public.submit_contact_message('Ada', 'ada@example.com', 'press', 'Hello from a parent.') $$, '42501', null, 'anon cannot call submit_contact_message');
select throws_ok($$ select public.claim_contact_deliveries(1) $$, '42501', null, 'anon cannot call claim_contact_deliveries');
select throws_ok($$ select public.record_contact_delivery_attempt(gen_random_uuid(), 'sent', 're_1') $$, '42501', null, 'anon cannot call record_contact_delivery_attempt');
reset role;
set local role authenticated;
select throws_ok($$ select * from public.submit_contact_message('Ada', 'ada@example.com', 'press', 'Hello from a parent.') $$, '42501', null, 'authenticated cannot call submit_contact_message');
select throws_ok($$ select public.claim_contact_deliveries(1) $$, '42501', null, 'authenticated cannot call claim_contact_deliveries');
select throws_ok($$ select public.record_contact_delivery_attempt(gen_random_uuid(), 'sent', 're_1') $$, '42501', null, 'authenticated cannot call record_contact_delivery_attempt');
reset role;

-- ---------------------------------------------------------------------------
-- Submitting: one message and exactly one staff alert, in one call
-- ---------------------------------------------------------------------------

reset role;
create temp table counts_before on commit drop as
  select (select count(*) from public.contact_messages)::integer as messages,
         (select count(*) from public.contact_message_deliveries)::integer as deliveries;

set local role service_role;
create temp table sent_a on commit drop as
  select * from public.submit_contact_message('  Ada Lovelace ', ' Ada@Example.COM ', 'press', 'Hello from a parent.');

reset role;
select is((select count(*)::integer from sent_a), 1, 'one call answers one row of ids');
select results_eq(
  $$ select m.name, m.email, m.topic, m.message from public.contact_messages as m where m.id = (select message_id from sent_a) $$,
  $$ values ('Ada Lovelace'::text, 'ada@example.com'::text, 'press'::text, 'Hello from a parent.'::text) $$,
  'the message is stored with the name trimmed and the email trimmed and lower-cased'
);
select results_eq(
  $$ select d.id = (select delivery_id from sent_a), d.kind, d.status, d.attempts, d.next_attempt_at <= now(),
            d.last_attempt_at is null and d.claimed_at is null and d.unconfirmed_since is null
       from public.contact_message_deliveries as d where d.message_id = (select message_id from sent_a) $$,
  $$ values (true, 'contact_staff_alert'::text, 'pending'::text, 0, true, true) $$,
  'with exactly one staff alert, pending, unattempted and due, under the returned delivery id'
);
select is((select count(*)::integer from public.contact_messages) - (select messages from counts_before), 1, 'one call stores exactly one message');
select is((select count(*)::integer from public.contact_message_deliveries) - (select deliveries from counts_before), 1, 'and exactly one delivery');

-- Every refusal names the field, never the value, and stores nothing.
set local role service_role;
select throws_ok($$ select * from public.submit_contact_message('', 'refused@example.com', 'general', 'Hello there, team.') $$, '22023', 'name is invalid', 'an empty name is refused');
select throws_ok($$ select * from public.submit_contact_message(repeat('a', 81), 'refused@example.com', 'general', 'Hello there, team.') $$, '22023', 'name is invalid', 'a name over 80 characters is refused');
select throws_ok($$ select * from public.submit_contact_message('Ada <b>', 'refused@example.com', 'general', 'Hello there, team.') $$, '22023', 'name is invalid', 'a name with markup is refused');
select throws_ok($$ select * from public.submit_contact_message('Ada' || chr(10) || 'Bcc: x', 'refused@example.com', 'general', 'Hello there, team.') $$, '22023', 'name is invalid', 'a name with a line break is refused (nothing can reach a mail header)');
select throws_ok($$ select * from public.submit_contact_message('Ada', 'not-an-email', 'general', 'Hello there, team.') $$, '22023', 'email is invalid', 'a malformed email is refused');
select throws_ok($$ select * from public.submit_contact_message('Ada', 'refused@example.com', 'other', 'Hello there, team.') $$, '22023', 'topic is invalid', 'a topic outside the form''s five is refused');
select throws_ok($$ select * from public.submit_contact_message('Ada', 'refused@example.com', 'general', 'too short') $$, '22023', 'message is invalid', 'a 9-character message is refused');
select throws_ok($$ select * from public.submit_contact_message('Ada', 'refused@example.com', 'general', repeat(chr(128034), 3001)) $$, '22023', 'message is invalid', 'a message of 3001 characters is refused, each emoji counted as one character');
select throws_ok($$ select * from public.submit_contact_message('Ada', 'refused@example.com', 'general', 'hello' || chr(7) || 'there!!') $$, '22023', 'message is invalid', 'a message with a control character is refused');
select throws_ok($$ select * from public.submit_contact_message('Ada', 'refused@example.com', 'general', 'line one' || chr(13) || chr(10) || 'line two') $$, '22023', 'message is invalid', 'a message with CR is refused: the server sends it with CRLF normalised to LF');
reset role;
select is((select count(*)::integer from public.contact_messages) - (select messages from counts_before), 1, 'a refused call stores no message');
select is((select count(*)::integer from public.contact_message_deliveries) - (select deliveries from counts_before), 1, 'and queues no alert');

set local role service_role;
create temp table sent_long on commit drop as
  select * from public.submit_contact_message('Grace', 'grace@example.com', 'general', repeat(chr(128034), 3000));
create temp table sent_lf on commit drop as
  select * from public.submit_contact_message('Lin', 'lin@example.com', 'privacy', 'line one' || chr(10) || 'line two' || chr(9) || 'ok');
create temp table sent_ten on commit drop as
  select * from public.submit_contact_message('Tem', 'tem@example.com', 'partnerships', repeat(chr(128034), 10));
select is((select count(*)::integer from sent_long), 1, 'a message of exactly 3000 characters (3000 emoji, 12,000 bytes) is accepted');
select is((select count(*)::integer from sent_lf), 1, 'line breaks (LF) and tabs are allowed in a message');
select is((select count(*)::integer from sent_ten), 1, 'a message of exactly 10 characters is accepted, each emoji counted as one');

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------

select throws_ok($$ select public.claim_contact_deliveries(0) $$, '22023', 'claim limit is invalid', 'a claim takes at least one row');
select throws_ok($$ select public.claim_contact_deliveries(51) $$, '22023', 'claim limit is invalid', 'and at most fifty');
select throws_ok($$ select public.claim_contact_deliveries(null) $$, '22023', 'claim limit is invalid', 'and always a bound');

create temp table claim_a on commit drop as select public.claim_contact_deliveries(1, (select message_id from sent_a)) as result;
select is((select jsonb_array_length(result -> 'claimed') from claim_a), 1, 'a claim naming the message takes its one alert');
select is(
  (select array_agg(k order by k collate "C") from claim_a, jsonb_array_elements(claim_a.result -> 'claimed') as c, jsonb_object_keys(c) as k),
  array['attempt', 'email', 'id', 'kind', 'message', 'name', 'receivedAt', 'topic'],
  'a claimed alert carries exactly what the staff alert needs'
);
select is(
  (select c - 'id' - 'receivedAt' from claim_a, jsonb_array_elements(claim_a.result -> 'claimed') as c),
  '{"kind": "contact_staff_alert", "attempt": 1, "name": "Ada Lovelace", "email": "ada@example.com", "topic": "press", "message": "Hello from a parent."}'::jsonb,
  'with the stored message and the attempt number'
);
select is((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_a), (select delivery_id from sent_a), 'under the delivery id, which keys its idempotency (contact-delivery/<id>)');
select is((select result -> 'skipped' from claim_a), '0'::jsonb, 'the claim reports skipped 0: a contact message cannot be withdrawn (R175)');
select is((select (result ->> 'expired')::integer from claim_a), 0, 'nothing has expired');

reset role;
select is(
  (select (result -> 'claimed' -> 0 ->> 'receivedAt')::timestamptz from claim_a),
  (select m.created_at from public.contact_messages as m where m.id = (select message_id from sent_a)),
  'receivedAt is the time the message was stored'
);
select results_eq(
  $$ select d.status, d.attempts, d.claimed_at = now(), d.last_attempt_at is null from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_a) $$,
  $$ values ('sending'::text, 1, true, true) $$,
  'claiming marks the row sending, counts the attempt and records when it was claimed'
);

set local role service_role;
select is(jsonb_array_length(public.claim_contact_deliveries(1, (select message_id from sent_a)) -> 'claimed'), 0, 'a claimed row is never handed out twice (no double send)');
create temp table claim_long on commit drop as select public.claim_contact_deliveries(1, (select message_id from sent_long)) as result;
select is((select char_length(result -> 'claimed' -> 0 ->> 'message') from claim_long), 3000, 'the 3000-character message reaches the alert whole');

-- ---------------------------------------------------------------------------
-- Recording outcomes
-- ---------------------------------------------------------------------------

select is(public.record_contact_delivery_attempt((select delivery_id from sent_a), 'sent', 're_contact_1'), true, 'an accepted send is recorded on the claimed row');
select is(public.record_contact_delivery_attempt((select delivery_id from sent_a), 'sent', 're_contact_1'), false, 'a recorded row cannot be recorded again');
reset role;
select results_eq(
  $$ select d.status, d.provider_message_id, d.last_error_code, d.last_attempt_at = now(), d.claimed_at is null
       from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_a) $$,
  $$ values ('sent'::text, 're_contact_1'::text, null::text, true, true) $$,
  'the accepted send keeps the provider''s message id and ends the claim'
);

set local role service_role;
select is(public.record_contact_delivery_attempt((select delivery_id from sent_long), 'failed', null, 'rate_limit_exceeded'), true, 'a refused send is recorded');
reset role;
select ok(
  (select d.status = 'failed' and d.last_error_code = 'rate_limit_exceeded' and d.next_attempt_at = now() + interval '2 minutes' and d.unconfirmed_since is null
     from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_long)),
  'a refused send backs off (2 minutes after attempt 1) and is not unconfirmed: the provider answered'
);
set local role service_role;
select is(jsonb_array_length(public.claim_contact_deliveries(1, (select message_id from sent_long)) -> 'claimed'), 0, 'a failed row waits for its next attempt time');

reset role;
update public.contact_message_deliveries set next_attempt_at = now() - interval '1 second' where id = (select delivery_id from sent_long);
set local role service_role;
create temp table claim_long2 on commit drop as select public.claim_contact_deliveries(1, (select message_id from sent_long)) as result;
select is((select (result -> 'claimed' -> 0 ->> 'attempt')::integer from claim_long2), 2, 'once due, the failed row is claimed again as attempt 2');
select is((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_long2), (select delivery_id from sent_long), 'under the same row id, which is its provider idempotency key (R91)');
select is(public.record_contact_delivery_attempt((select delivery_id from sent_long), 'failed', null, 'send_timeout'), true, 'a timed-out send is recorded as failed');
reset role;
select ok(
  (select d.unconfirmed_since = now() and d.next_attempt_at = now() + interval '4 minutes' from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_long)),
  'a timeout leaves the send unconfirmed from the attempt''s claim, and backs off 4 minutes after attempt 2'
);

update public.contact_message_deliveries
   set unconfirmed_since = now() - interval '23 hours 1 minute', next_attempt_at = now() - interval '1 second'
 where id = (select delivery_id from sent_long);
set local role service_role;
create temp table claim_long3 on commit drop as select public.claim_contact_deliveries(1, (select message_id from sent_long)) as result;
select ok(
  (select jsonb_array_length(result -> 'claimed') = 0 and (result ->> 'expired')::integer = 1 from claim_long3),
  'an unconfirmed failure is never retried after 23 hours, outside the provider''s idempotency window (R91)'
);
reset role;
select ok(
  (select d.status = 'failed' and d.last_error_code = 'stale_unconfirmed' and d.next_attempt_at = 'infinity'::timestamptz
     from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_long)),
  'and is parked as failed with stale_unconfirmed, for a human to check'
);

-- Deferral: the send budget was spent, so the claim is handed back.
set local role service_role;
select is((public.claim_contact_deliveries(1, (select message_id from sent_lf)) -> 'claimed' -> 0 ->> 'attempt')::integer, 1, 'a fresh row is claimed as attempt 1');
select is(public.record_contact_delivery_attempt((select delivery_id from sent_lf), 'deferred'), true, 'a claim can be handed back without an attempt');
select is(public.record_contact_delivery_attempt((select delivery_id from sent_lf), 'deferred'), false, 'only a claimed row can be handed back');
reset role;
select results_eq(
  $$ select d.status, d.attempts, d.next_attempt_at <= now(), d.last_attempt_at is null, d.claimed_at is null
       from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_lf) $$,
  $$ values ('pending'::text, 0, true, true, true) $$,
  'a deferred row is pending again, uncounted, still due, and shows no attempt time'
);

-- The attempt cap, and a key the provider says it has seen with another message.
update public.contact_message_deliveries set attempts = 7, status = 'failed', last_error_code = 'rate_limit_exceeded' where id = (select delivery_id from sent_lf);
set local role service_role;
create temp table claim_lf on commit drop as select public.claim_contact_deliveries(1, (select message_id from sent_lf)) as result;
select is((select (result -> 'claimed' -> 0 ->> 'attempt')::integer from claim_lf), 8, 'the eighth attempt is still claimed');
select is(public.record_contact_delivery_attempt((select delivery_id from sent_lf), 'failed', null, 'rate_limit_exceeded'), true, 'and its failure recorded');
reset role;
select ok(
  (select d.status = 'failed' and d.attempts = 8 and d.next_attempt_at = 'infinity'::timestamptz from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_lf)),
  'after the eighth attempt a failure is final: the row is never due again'
);

set local role service_role;
select is(jsonb_array_length(public.claim_contact_deliveries(1, (select message_id from sent_ten)) -> 'claimed'), 1, 'another alert is claimed');
select is(public.record_contact_delivery_attempt((select delivery_id from sent_ten), 'failed', null, 'invalid_idempotent_request'), true, 'an idempotency conflict is recorded');
reset role;
select ok(
  (select d.next_attempt_at = 'infinity'::timestamptz and d.attempts = 1 and d.unconfirmed_since = now() from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_ten)),
  'and is final at once, and unconfirmed: a retry after the window could repeat a delivered alert'
);

-- ---------------------------------------------------------------------------
-- A row stuck in sending (R91)
-- ---------------------------------------------------------------------------

set local role service_role;
create temp table sent_f on commit drop as select * from public.submit_contact_message('Fay', 'fay@example.com', 'partnerships', 'A partnership idea for the team.');
create temp table sent_g on commit drop as select * from public.submit_contact_message('Gus', 'gus@example.com', 'shop-order', 'A question about my order.');
create temp table sent_h on commit drop as select * from public.submit_contact_message('Hal', 'hal@example.com', 'general', 'A general question for you.');
create temp table claim_all on commit drop as select public.claim_contact_deliveries(50) as result;
select ok(
  (select array_agg((c ->> 'id')::uuid) from claim_all, jsonb_array_elements(claim_all.result -> 'claimed') as c)
    @> array[(select delivery_id from sent_f), (select delivery_id from sent_g), (select delivery_id from sent_h)],
  'a claim naming no message (the worker) takes every due alert'
);

reset role;
update public.contact_message_deliveries set claimed_at = now() - interval '14 minutes' where id = (select delivery_id from sent_f);
set local role service_role;
select is(jsonb_array_length(public.claim_contact_deliveries(1, (select message_id from sent_f)) -> 'claimed'), 0, 'a row sending for under 15 minutes is left alone');

reset role;
update public.contact_message_deliveries set claimed_at = now() - interval '16 minutes' where id = (select delivery_id from sent_f);
set local role service_role;
create temp table claim_f on commit drop as select public.claim_contact_deliveries(1, (select message_id from sent_f)) as result;
select is((select (result -> 'claimed' -> 0 ->> 'id')::uuid from claim_f), (select delivery_id from sent_f), 'a row stuck in sending for over 15 minutes is claimed again, under the same id (R91)');
select is((select (result -> 'claimed' -> 0 ->> 'attempt')::integer from claim_f), 2, 'as its next attempt');
reset role;
select ok(
  (select d.last_attempt_at = now() - interval '16 minutes' and d.unconfirmed_since = now() - interval '16 minutes' and d.claimed_at = now()
     from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_f)),
  'the lost attempt keeps its time, and counts as unconfirmed from when it was claimed'
);

update public.contact_message_deliveries set claimed_at = now() - interval '25 hours' where id = (select delivery_id from sent_g);
set local role service_role;
create temp table claim_g on commit drop as select public.claim_contact_deliveries(1, (select message_id from sent_g)) as result;
select ok(
  (select jsonb_array_length(result -> 'claimed') = 0 and (result ->> 'expired')::integer = 1 from claim_g),
  'a row stuck in sending for 25 hours is never sent again, and the claim reports it as expired (R91)'
);
reset role;
select ok(
  (select d.status = 'failed' and d.last_error_code = 'stale_unconfirmed' and d.next_attempt_at = 'infinity'::timestamptz
          and d.last_attempt_at = now() - interval '25 hours' and d.unconfirmed_since = now() - interval '25 hours' and d.claimed_at is null
     from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_g)),
  'it is parked as failed with stale_unconfirmed, keeping the lost attempt''s time, with no claim left'
);

update public.contact_message_deliveries set attempts = 8, claimed_at = now() - interval '16 minutes' where id = (select delivery_id from sent_h);
set local role service_role;
select is((public.claim_contact_deliveries(1, (select message_id from sent_h)) ->> 'expired')::integer, 1, 'a lost eighth attempt is parked, never sent a ninth time');
reset role;
select ok(
  (select d.status = 'failed' and d.attempts = 8 and d.next_attempt_at = 'infinity'::timestamptz from public.contact_message_deliveries as d where d.id = (select delivery_id from sent_h)),
  'as failed, never due again'
);

-- ---------------------------------------------------------------------------
-- Arguments
-- ---------------------------------------------------------------------------

set local role service_role;
select throws_ok($$ select public.record_contact_delivery_attempt(gen_random_uuid(), 'skipped') $$, '22023', 'delivery status is invalid', 'a contact alert is never recorded as skipped (R175)');
select throws_ok($$ select public.record_contact_delivery_attempt(gen_random_uuid(), 'sent') $$, '22023', 'provider message id is invalid', 'an accepted send needs the provider''s message id');
select throws_ok($$ select public.record_contact_delivery_attempt(gen_random_uuid(), 'failed', null, 'reason with spaces and ada@example.com') $$, '22023', 'error code is invalid', 'only short error codes are stored, never provider messages');
select is(public.record_contact_delivery_attempt(gen_random_uuid(), 'sent', 're_unknown'), false, 'an unknown row records nothing');

-- ---------------------------------------------------------------------------
-- The table's own rules, as the owner
-- ---------------------------------------------------------------------------

reset role;
select throws_ok(
  format($$ insert into public.contact_message_deliveries (message_id, kind) values (%L, 'staff_alert') $$, (select message_id from sent_h)),
  '23514', null, 'the contact outbox refuses a lead outbox kind: its one kind is a positive list'
);
select throws_ok(
  format($$ insert into public.contact_message_deliveries (message_id, kind) values (%L, 'contact_staff_alert') $$, (select message_id from sent_h)),
  '23505', null, 'a second staff alert for one message is refused: one alert per message'
);
select throws_ok(
  format($$ update public.contact_message_deliveries set status = 'skipped' where id = %L $$, (select delivery_id from sent_h)),
  '23514', null, 'skipped is not a status of the contact outbox (R175)'
);
select throws_ok(
  $$ insert into public.contact_messages (name, email, topic, message) values ('Ada', 'Ada@Example.com', 'press', 'Hello from a parent.') $$,
  '23514', null, 'a stored email is always trimmed and lower-cased'
);
select throws_ok(
  $$ insert into public.contact_messages (name, email, topic, message) values ('Ada', 'ada@example.com', 'other', 'Hello from a parent.') $$,
  '23514', null, 'a stored topic is one of the form''s five'
);
select throws_ok(
  $$ insert into public.contact_messages (name, email, topic, message) values ('<b>Ada</b>', 'ada@example.com', 'press', 'Hello from a parent.') $$,
  '23514', null, 'a stored name holds no markup'
);
select throws_ok(
  $$ insert into public.contact_messages (name, email, topic, message) values ('Ada', 'ada@example.com', 'press', 'line one' || chr(13) || 'line two') $$,
  '23514', null, 'a stored message holds no control character but LF and TAB'
);

delete from public.contact_messages where id = (select message_id from sent_h);
select is((select count(*)::integer from public.contact_message_deliveries where id = (select delivery_id from sent_h)), 0, 'deleting a message removes its alert');

-- ---------------------------------------------------------------------------
-- The lead outbox is as migration 0006 left it (R169)
-- ---------------------------------------------------------------------------

select col_not_null('public', 'lead_delivery_events', 'lead_id', 'every lead outbox row still names its lead');
select hasnt_column('public', 'lead_delivery_events', 'message_id', 'the lead outbox has no message column');
select hasnt_column('public', 'lead_delivery_events', 'contact_message_id', 'nor a contact message column');
select is(
  (select pg_catalog.pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint as c
    where c.conrelid = 'public.lead_delivery_events'::regclass and c.conname = 'lead_delivery_events_kind_values'),
  $$CHECK ((kind = ANY (ARRAY['acknowledgement'::text, 'staff_alert'::text])))$$,
  'and its kinds are still the two signup messages'
);

select * from finish();
rollback;
