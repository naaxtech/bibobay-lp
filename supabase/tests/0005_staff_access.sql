-- pgTAP checks for migration 0007: staff access (Task 8b; spec §10 steps 8-10, §11; rulings R95-R98).
--
-- Runs in one transaction and rolls back, so it leaves nothing behind. Run against a Supabase
-- project with `supabase test db` (Task 11); tests/orders/migration-database.test.ts runs it in an
-- embedded Postgres, after every migration, on every `npm test`. The embedded Postgres has a
-- test-only stand-in for Supabase Auth (auth.users and auth.uid(), tests/support/supabase-db.ts);
-- a request's user is set the way PostgREST sets it, as the JWT subject of the transaction.
--
-- Covers, for anon, a signed-in user with no staff row, inactive staff, active staff and
-- service_role: staff_users and is_active_staff(); the staff read policies and column grants on the
-- order tables (never the token hash or the submission key, R95); the staff RPCs (security
-- definers with an empty search_path, executable by authenticated only, refusing anyone who is not
-- active staff); quotes (R96: saving bumps the revision and never notifies, sending queues one
-- outbox row per revision and a repeat is a no-op, neither changes the status); one-way optimistic
-- status changes (R98) and the audit trail (actor staff, the staff member's user id); and a staff
-- rotation of the private tracking link.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(174);

-- ---------------------------------------------------------------------------
-- Fixtures: three signed-in people and two orders
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'staff@example.com'),
  ('00000000-0000-4000-8000-0000000000a2', 'former-staff@example.com'),
  ('00000000-0000-4000-8000-0000000000a3', 'visitor@example.com');
insert into public.staff_users (user_id, display_name) values ('00000000-0000-4000-8000-0000000000a1', 'Jo');
insert into public.staff_users (user_id, display_name, active, disabled_at) values ('00000000-0000-4000-8000-0000000000a2', 'Former', false, now());

set local role service_role;
create temp table order_a on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Sam Rivers', p_email => 'buyer@example.com', p_address_line1 => '12 Harbour Road',
    p_city => 'Seaside', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-tula", "title": "Tula plush", "sku": "BB-TULA-01", "variant": "Large", "pack": "Single", "quantity": 2}]'::jsonb,
    p_submission_key => gen_random_uuid()
  );
create temp table order_b on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Alex Shore', p_email => 'other@example.com', p_address_line1 => '3 Reef Street',
    p_city => 'Bayview', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-lumi", "title": "Lumi puzzle", "quantity": 1}]'::jsonb,
    p_submission_key => gen_random_uuid()
  );
reset role;
grant select on order_a, order_b to anon, authenticated;

-- ---------------------------------------------------------------------------
-- staff_users
-- ---------------------------------------------------------------------------

select has_table('public', 'staff_users', 'staff_users exists');
select columns_are('public', 'staff_users', array['user_id', 'display_name', 'active', 'created_at', 'disabled_at'], 'staff_users holds a user id, a display name, the active flag and two times: no password, no email');
select col_is_pk('public', 'staff_users', 'user_id', 'one staff row per auth user');
select fk_ok('public', 'staff_users', 'user_id', 'auth', 'users', 'id', 'every staff row belongs to a Supabase Auth user');
select ok((select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.staff_users'::regclass), 'staff_users: row level security enabled and forced');
select table_privs_are('public', 'staff_users', 'anon', array[]::text[], 'anon has no privilege on staff_users');
select table_privs_are('public', 'staff_users', 'authenticated', array[]::text[], 'authenticated has no table privilege on staff_users (three columns only)');
select table_privs_are('public', 'staff_users', 'service_role', array[]::text[], 'service_role has no privilege on staff_users');
select throws_ok($$ insert into public.staff_users (user_id, active, disabled_at) values ('00000000-0000-4000-8000-0000000000a3', true, now()) $$, '23514', null, 'an active row has no disabled time');
select throws_ok($$ insert into public.staff_users (user_id, active) values ('00000000-0000-4000-8000-0000000000a3', false) $$, '23514', null, 'an inactive row records when it was disabled');
select throws_ok($$ insert into public.staff_users (user_id, display_name) values ('00000000-0000-4000-8000-0000000000a3', repeat('x', 81)) $$, '23514', null, 'a display name is short');
select throws_ok($$ insert into public.staff_users (user_id) values (gen_random_uuid()) $$, '23503', null, 'a staff row needs an existing auth user');

-- ---------------------------------------------------------------------------
-- Policies and column grants on the order tables
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select tablename::text collate "default", cmd::text, roles::text collate "default" from pg_catalog.pg_policies
      where schemaname = 'public' and tablename in ('orders', 'order_items', 'order_events', 'order_email_outbox', 'staff_users')
      order by tablename::text collate "C" $$,
  $$ values ('order_email_outbox'::text, 'SELECT'::text, '{authenticated}'::text), ('order_events', 'SELECT', '{authenticated}'),
            ('order_items', 'SELECT', '{authenticated}'), ('orders', 'SELECT', '{authenticated}'), ('staff_users', 'SELECT', '{authenticated}') $$,
  'the only row policies are reads for signed-in users: nothing anon can use, no write policy'
);
select is(
  (select array_agg(c.column_name::text collate "default" order by c.column_name::text collate "C") from information_schema.column_privileges as c
    where c.table_schema = 'public' and c.table_name = 'orders' and c.grantee = 'authenticated' and c.privilege_type = 'SELECT'),
  array['address_line1', 'address_line2', 'city', 'consent_granted_at', 'consent_version', 'contact_name', 'country', 'created_at', 'currency', 'email', 'freight_minor', 'id', 'notes', 'payment_url', 'phone', 'postal_code', 'quote_revision', 'quote_sent_at', 'reference', 'region', 'retain_until', 'status', 'status_changed_at', 'subtotal_minor', 'tracking_token_expires_at', 'tracking_token_rotated_at', 'updated_at'],
  'staff may read every order column except the tracking token hash and the submission key (R95)'
);
select is(
  (select array_agg(c.column_name::text collate "default" order by c.column_name::text collate "C") from information_schema.column_privileges as c
    where c.table_schema = 'public' and c.table_name = 'order_email_outbox' and c.grantee = 'authenticated' and c.privilege_type = 'SELECT'),
  array['attempts', 'created_at', 'id', 'kind', 'last_attempt_at', 'last_error_code', 'next_attempt_at', 'order_id', 'quote_revision', 'status', 'updated_at'],
  'staff may read the order outbox''s status columns only'
);
select is(
  (select count(*)::integer from information_schema.column_privileges as c
    where c.table_schema = 'public' and c.grantee = 'authenticated' and c.privilege_type <> 'SELECT'
      and c.table_name in ('orders', 'order_items', 'order_events', 'order_email_outbox', 'staff_users')),
  0,
  'no column of these tables may be written by a signed-in user'
);
select is(
  (select count(*)::integer from information_schema.column_privileges as c
    where c.table_schema = 'public' and c.grantee in ('anon', 'service_role')
      and c.table_name in ('orders', 'order_items', 'order_events', 'order_email_outbox', 'staff_users')),
  0,
  'anon and service_role hold no column privilege on these tables'
);

-- ---------------------------------------------------------------------------
-- Functions and grants
-- ---------------------------------------------------------------------------

select is_definer('public', 'is_active_staff', array[]::text[], 'is_active_staff is security definer (it reads staff_users for the policies)');
select is_definer('public', 'staff_save_order_quote', array['text', 'integer', 'text', 'integer', 'integer', 'text'], 'staff_save_order_quote is security definer');
select is_definer('public', 'staff_queue_order_quote', array['text', 'integer'], 'staff_queue_order_quote is security definer');
select is_definer('public', 'staff_advance_order_status', array['text', 'text', 'text'], 'staff_advance_order_status is security definer');
select is_definer('public', 'staff_rotate_order_tracking_token', array['text'], 'staff_rotate_order_tracking_token is security definer');
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('is_active_staff', 'staff_save_order_quote', 'staff_queue_order_quote', 'staff_advance_order_status', 'staff_rotate_order_tracking_token')
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every staff function pins an empty search_path'
);
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as acl
     where p.pronamespace = 'public'::regnamespace and acl.grantee = 0 and acl.privilege_type = 'EXECUTE' $$,
  'no function in public is executable by PUBLIC'
);

select function_privs_are('public', 'is_active_staff', array[]::text[], 'anon', array[]::text[], 'anon cannot run is_active_staff');
select function_privs_are('public', 'is_active_staff', array[]::text[], 'authenticated', array['EXECUTE'], 'authenticated can run is_active_staff (the policies need it)');
select function_privs_are('public', 'is_active_staff', array[]::text[], 'service_role', array[]::text[], 'service_role cannot run is_active_staff');
select function_privs_are('public', 'staff_save_order_quote', array['text', 'integer', 'text', 'integer', 'integer', 'text'], 'anon', array[]::text[], 'anon cannot save a quote');
select function_privs_are('public', 'staff_save_order_quote', array['text', 'integer', 'text', 'integer', 'integer', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call staff_save_order_quote (it checks for staff itself)');
select function_privs_are('public', 'staff_save_order_quote', array['text', 'integer', 'text', 'integer', 'integer', 'text'], 'service_role', array[]::text[], 'service_role cannot save a quote');
select function_privs_are('public', 'staff_queue_order_quote', array['text', 'integer'], 'anon', array[]::text[], 'anon cannot queue a quote');
select function_privs_are('public', 'staff_queue_order_quote', array['text', 'integer'], 'authenticated', array['EXECUTE'], 'authenticated may call staff_queue_order_quote');
select function_privs_are('public', 'staff_queue_order_quote', array['text', 'integer'], 'service_role', array[]::text[], 'service_role cannot queue a quote');
select function_privs_are('public', 'staff_advance_order_status', array['text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot change a status');
select function_privs_are('public', 'staff_advance_order_status', array['text', 'text', 'text'], 'authenticated', array['EXECUTE'], 'authenticated may call staff_advance_order_status');
select function_privs_are('public', 'staff_advance_order_status', array['text', 'text', 'text'], 'service_role', array[]::text[], 'service_role cannot change a status');
select function_privs_are('public', 'staff_rotate_order_tracking_token', array['text'], 'anon', array[]::text[], 'anon cannot rotate a tracking link');
select function_privs_are('public', 'staff_rotate_order_tracking_token', array['text'], 'authenticated', array['EXECUTE'], 'authenticated may call staff_rotate_order_tracking_token');
select function_privs_are('public', 'staff_rotate_order_tracking_token', array['text'], 'service_role', array[]::text[], 'service_role cannot rotate as staff');
select function_privs_are('public', 'rotate_order_tracking_token', array['uuid'], 'authenticated', array[]::text[], 'the system rotation of migration 0005 stays service_role only');

-- ---------------------------------------------------------------------------
-- anon: nothing
-- ---------------------------------------------------------------------------

set local role anon;
select throws_ok($$ select id from public.orders $$, '42501', null, 'anon cannot read orders');
select throws_ok($$ select title from public.order_items $$, '42501', null, 'anon cannot read order lines');
select throws_ok($$ select event_type from public.order_events $$, '42501', null, 'anon cannot read the audit trail');
select throws_ok($$ select status from public.order_email_outbox $$, '42501', null, 'anon cannot read the order outbox');
select throws_ok($$ select user_id from public.staff_users $$, '42501', null, 'anon cannot read staff_users');
select throws_ok($$ select public.is_active_staff() $$, '42501', null, 'anon cannot call is_active_staff');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 0, 'AUD', 100, 0, 'https://pay.example.com/x') $$, '42501', null, 'anon cannot save a quote');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_a), 1) $$, '42501', null, 'anon cannot queue a quote');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'new', 'confirmed') $$, '42501', null, 'anon cannot change a status');
select throws_ok($$ select * from public.staff_rotate_order_tracking_token((select reference from order_a)) $$, '42501', null, 'anon cannot rotate a tracking link');
reset role;

-- ---------------------------------------------------------------------------
-- service_role: no table access, no staff action
-- ---------------------------------------------------------------------------

set local role service_role;
select throws_ok($$ select id from public.orders $$, '42501', null, 'service_role cannot read orders directly');
select throws_ok($$ select user_id from public.staff_users $$, '42501', null, 'service_role cannot read staff_users');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 0, 'AUD', 100, 0, 'https://pay.example.com/x') $$, '42501', null, 'service_role cannot save a quote');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_a), 1) $$, '42501', null, 'service_role cannot queue a quote');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'new', 'confirmed') $$, '42501', null, 'service_role cannot change a status');
select throws_ok($$ select * from public.staff_rotate_order_tracking_token((select reference from order_a)) $$, '42501', null, 'service_role cannot rotate as staff');
reset role;

-- ---------------------------------------------------------------------------
-- Signed in without a staff row, signed in as inactive staff, signed in with no subject: nothing
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a3', true);
set local role authenticated;
select is(public.is_active_staff(), false, 'a signed-in user without a staff row is not staff');
select is_empty($$ select id from public.orders $$, 'and reads no order');
select is_empty($$ select title from public.order_items $$, 'no order line');
select is_empty($$ select event_type from public.order_events $$, 'no audit event');
select is_empty($$ select status from public.order_email_outbox $$, 'no outbox row');
select is_empty($$ select user_id from public.staff_users $$, 'and no staff row');
select throws_ok($$ select tracking_token_hash from public.orders $$, '42501', null, 'the token hash is never readable');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 0, 'AUD', 100, 0, 'https://pay.example.com/x') $$, '42501', 'staff only', 'a non-staff user cannot save a quote');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_a), 1) $$, '42501', 'staff only', 'or queue one');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'new', 'confirmed') $$, '42501', 'staff only', 'or change a status');
select throws_ok($$ select * from public.staff_rotate_order_tracking_token((select reference from order_a)) $$, '42501', 'staff only', 'or rotate a tracking link');
select throws_ok($$ update public.orders set status = 'confirmed' $$, '42501', null, 'and cannot write an order directly');
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
set local role authenticated;
select is(public.is_active_staff(), false, 'inactive staff are not staff');
select is_empty($$ select id from public.orders $$, 'and read no order');
select is_empty($$ select event_type from public.order_events $$, 'no audit event');
select results_eq($$ select user_id::text, active from public.staff_users $$, $$ values ('00000000-0000-4000-8000-0000000000a2'::text, false) $$, 'they see only their own staff row, marked inactive');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 0, 'AUD', 100, 0, 'https://pay.example.com/x') $$, '42501', 'staff only', 'inactive staff cannot save a quote');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_a), 1) $$, '42501', 'staff only', 'or queue one');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'new', 'confirmed') $$, '42501', 'staff only', 'or change a status');
select throws_ok($$ select * from public.staff_rotate_order_tracking_token((select reference from order_a)) $$, '42501', 'staff only', 'or rotate a tracking link');
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select is(public.is_active_staff(), false, 'a request with no user is not staff');
select is_empty($$ select id from public.orders $$, 'and reads no order');
reset role;

-- The newer PostgREST form: the whole claim set as JSON.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-0000000000a1", "role": "authenticated"}', true);
set local role authenticated;
select is(public.is_active_staff(), true, 'the staff check reads the user from the JWT claims as PostgREST sets them');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------
-- Active staff: reads
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
select is(public.is_active_staff(), true, 'active staff are staff');
select is((select count(*)::integer from public.orders where id in ((select order_id from order_a), (select order_id from order_b))), 2, 'staff read every order');
select is((select contact_name || ' / ' || email || ' / ' || address_line1 from public.orders where id = (select order_id from order_a)), 'Sam Rivers / buyer@example.com / 12 Harbour Road', 'with its contact and delivery details');
select is((select title from public.order_items where order_id = (select order_id from order_a)), 'Tula plush', 'its lines');
select is((select event_type from public.order_events where order_id = (select order_id from order_a)), 'order_submitted', 'its audit trail');
select is((select array_agg(kind::text order by kind) from public.order_email_outbox where order_id = (select order_id from order_a)), array['acknowledgement', 'staff_alert'], 'and the status of its emails');
select throws_ok($$ select tracking_token_hash from public.orders $$, '42501', null, 'never the tracking token hash (R95)');
select throws_ok($$ select submission_key from public.orders $$, '42501', null, 'never the submission key');
select throws_ok($$ select * from public.orders $$, '42501', null, 'so a select-all is refused too');
select throws_ok($$ select idempotency_key from public.order_email_outbox $$, '42501', null, 'nor the outbox''s delivery internals');
select throws_ok($$ select provider_message_id from public.order_email_outbox $$, '42501', null, 'nor the provider''s message id');
select results_eq($$ select user_id::text, display_name, active from public.staff_users $$, $$ values ('00000000-0000-4000-8000-0000000000a1'::text, 'Jo'::text, true) $$, 'staff see their own staff row only');
select throws_ok($$ update public.orders set status = 'confirmed' $$, '42501', null, 'staff cannot write an order directly: only the RPCs can');
select throws_ok($$ delete from public.order_events $$, '42501', null, 'nor delete the audit trail');
select throws_ok(format($$ insert into public.order_email_outbox (order_id, kind, quote_revision) values (%L, 'quote', 1) $$, (select order_id from order_a)), '42501', null, 'nor queue an email directly');
select throws_ok($$ update public.staff_users set active = true $$, '42501', null, 'nor change a staff row');

-- ---------------------------------------------------------------------------
-- Quotes (R96)
-- ---------------------------------------------------------------------------

create temp table save_1 on commit drop as
  select * from public.staff_save_order_quote((select reference from order_a), 0, 'AUD', 12345, 1500, 'https://pay.example.com/checkout/abc');
select is((select quote_revision from save_1), 1, 'saving the first quote makes revision 1');
select is((select order_id from save_1), (select order_id from order_a), 'of that order');
select results_eq(
  $$ select currency, subtotal_minor, freight_minor, payment_url, quote_revision, quote_sent_at is null, status from public.orders where id = (select order_id from order_a) $$,
  $$ values ('AUD'::text, 12345, 1500, 'https://pay.example.com/checkout/abc'::text, 1, true, 'new'::text) $$,
  'the order holds the quote, still unsent, and its status is unchanged'
);
select is((select count(*)::integer from public.order_email_outbox where order_id = (select order_id from order_a) and kind = 'quote'), 0, 'saving never notifies: no quote email is queued');
select results_eq(
  $$ select actor, actor_user_id::text, event_type, old_status, new_status, metadata from public.order_events where order_id = (select order_id from order_a) and event_type = 'quote_saved' $$,
  $$ values ('staff'::text, '00000000-0000-4000-8000-0000000000a1'::text, 'quote_saved'::text, null::text, null::text, '{"revision": 1, "currency": "AUD", "subtotal_minor": 12345, "freight_minor": 1500}'::jsonb) $$,
  'the save is in the audit trail, by this staff member, with the figures but not the link'
);
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 0, 'AUD', 999, 0, 'https://pay.example.com/x') $$, '40001', 'stale', 'a save based on an older revision is refused: two staff never overwrite each other silently');
select is((select subtotal_minor from public.orders where id = (select order_id from order_a)), 12345, 'and changes nothing');

select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'aud', 100, 0, 'https://pay.example.com/x') $$, '22023', 'quote is invalid', 'a currency is three upper-case letters');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUDD', 100, 0, 'https://pay.example.com/x') $$, '22023', 'quote is invalid', 'exactly three');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', -1, 0, 'https://pay.example.com/x') $$, '22023', 'quote is invalid', 'a subtotal is never negative');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100000001, 0, 'https://pay.example.com/x') $$, '22023', 'quote is invalid', 'and at most 100,000,000 minor units');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 100000001, 'https://pay.example.com/x') $$, '22023', 'quote is invalid', 'nor is freight above it');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', null, 0, 'https://pay.example.com/x') $$, '22023', 'quote is invalid', 'every figure is required');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 0, 'http://pay.example.com/x') $$, '22023', 'quote is invalid', 'a payment link is https');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 0, 'https://user@pay.example.com/x') $$, '22023', 'quote is invalid', 'with no user info');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 0, 'https://pay.example.com:8443/x') $$, '22023', 'quote is invalid', 'no port');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 0, 'https://203.0.113.9/x') $$, '22023', 'quote is invalid', 'no IP address');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 0, 'https://pay.example.com/a b') $$, '22023', 'quote is invalid', 'no whitespace');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 0, 'https://pay.example.com/' || repeat('a', 2030)) $$, '22023', 'quote is invalid', 'and at most 2,048 characters');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 100, 0, null) $$, '22023', 'quote is invalid', 'a payment link is required');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), null, 'AUD', 100, 0, 'https://pay.example.com/x') $$, '22023', 'quote is invalid', 'the revision the staff member saw is required');
select throws_ok($$ select * from public.staff_save_order_quote('BB-0000-0000', 0, 'AUD', 100, 0, 'https://pay.example.com/x') $$, 'P0002', 'order not found', 'an unknown reference is not found');
select throws_ok($$ select * from public.staff_save_order_quote('not a reference', 0, 'AUD', 100, 0, 'https://pay.example.com/x') $$, 'P0002', 'order not found', 'and so is a malformed one');

-- Sending (queueing) a revision
create temp table queue_1 on commit drop as select * from public.staff_queue_order_quote((select reference from order_a), 1);
select results_eq(
  $$ select order_id, quote_revision, already_queued from queue_1 $$,
  $$ values ((select order_id from order_a), 1, false) $$,
  'sending revision 1 queues it'
);
select results_eq(
  $$ select kind, quote_revision, status, attempts from public.order_email_outbox where order_id = (select order_id from order_a) and kind = 'quote' $$,
  $$ values ('quote'::text, 1, 'pending'::text, 0) $$,
  'as one pending quote email in the outbox, for the worker or the send after the answer'
);
create temp table queue_1_again on commit drop as select * from public.staff_queue_order_quote((select reference from order_a), 1);
select is((select already_queued from queue_1_again), true, 'sending the same revision again is answered as already queued');
select is((select count(*)::integer from public.order_email_outbox where order_id = (select order_id from order_a) and kind = 'quote'), 1, 'and queues nothing more (the idempotency key <order id>:quote:<revision>)');
select is(
  (select count(*)::integer from public.order_events where order_id = (select order_id from order_a) and event_type = 'quote_queued' and actor = 'staff' and actor_user_id = '00000000-0000-4000-8000-0000000000a1' and metadata = '{"revision": 1}'::jsonb),
  1,
  'the send is in the audit trail once'
);
select is((select status from public.orders where id = (select order_id from order_a)), 'new', 'sending a quote never changes the order''s status (staff move it themselves)');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_a), 2) $$, '40001', 'stale', 'a revision that is not the current one cannot be sent');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_b), 1) $$, '55000', 'no quote to send', 'an order with no saved quote has nothing to send');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_a), null) $$, '22023', 'quote is invalid', 'a send names its revision');
select throws_ok($$ select * from public.staff_queue_order_quote('BB-0000-0000', 1) $$, 'P0002', 'order not found', 'an unknown reference is not found');

-- A newer save supersedes the queued revision
create temp table save_2 on commit drop as
  select * from public.staff_save_order_quote((select reference from order_a), 1, 'AUD', 13000, 1500, 'https://pay.example.com/checkout/def');
select is((select quote_revision from save_2), 2, 'a second save makes revision 2');
select is((select count(*)::integer from public.order_email_outbox where order_id = (select order_id from order_a) and kind = 'quote' and quote_revision = 1 and status = 'pending'), 1, 'revision 1 stays queued: the claim skips it as superseded (migration 0006)');
create temp table queue_2 on commit drop as select * from public.staff_queue_order_quote((select reference from order_a), 2);
select is((select already_queued from queue_2), false, 'revision 2 is queued as its own email');

-- ---------------------------------------------------------------------------
-- Status changes (R98)
-- ---------------------------------------------------------------------------

create temp table move_1 on commit drop as select * from public.staff_advance_order_status((select reference from order_a), 'new', 'confirmed');
select is((select status from move_1), 'confirmed', 'staff move an order from new to confirmed');
reset role;
select results_eq(
  $$ select status, status_changed_at = now() from public.orders where id = (select order_id from order_a) $$,
  $$ values ('confirmed'::text, true) $$,
  'the order records its new status and when it changed'
);
select results_eq(
  $$ select actor, actor_user_id::text, old_status, new_status from public.order_events where order_id = (select order_id from order_a) and event_type = 'status_changed' $$,
  $$ values ('staff'::text, '00000000-0000-4000-8000-0000000000a1'::text, 'new'::text, 'confirmed'::text) $$,
  'the change is in the audit trail: who, from and to'
);
set local role authenticated;

select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'new', 'confirmed') $$, '40001', 'stale', 'a change from a status the order no longer has is refused (another staff member moved it)');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'new', 'cancelled') $$, '40001', 'stale', 'cancelling from a stale status too');
select is((select count(*)::integer from public.order_email_outbox where order_id = (select order_id from order_a) and kind = 'quote' and status = 'pending'), 2, 'a refused status change never loses a queued quote');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'confirmed', 'closed') $$, '22023', 'transition not allowed', 'no step can be skipped');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'confirmed', 'new') $$, '22023', 'transition not allowed', 'nothing moves back');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'confirmed', 'confirmed') $$, '22023', 'transition not allowed', 'nor stays put');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'confirmed', 'refunded') $$, '22023', 'transition not allowed', 'and no unknown status exists');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), null, 'paid') $$, '22023', 'transition not allowed', 'a change names the status the staff member saw');
select throws_ok($$ select * from public.staff_advance_order_status('BB-0000-0000', 'new', 'confirmed') $$, 'P0002', 'order not found', 'an unknown reference is not found');

-- Quotes are only for new and confirmed orders
create temp table save_3 on commit drop as
  select * from public.staff_save_order_quote((select reference from order_a), 2, 'AUD', 13500, 1500, 'https://pay.example.com/checkout/ghi');
select is((select quote_revision from save_3), 3, 'a confirmed order can still be quoted');
reset role;
set local role service_role;
create temp table oclaim on commit drop as select public.claim_order_emails(10, (select order_id from order_a), array['quote']) as result;
reset role;
select results_eq(
  $$ select (result ->> 'skipped')::integer, jsonb_array_length(result -> 'claimed') from oclaim $$,
  $$ values (2, 0) $$,
  'the worker sends neither queued revision: the later save superseded both'
);
select results_eq(
  $$ select quote_revision, status, last_error_code from public.order_email_outbox where order_id = (select order_id from order_a) and kind = 'quote' order by quote_revision $$,
  $$ values (1, 'skipped'::text, 'quote_superseded'::text), (2, 'skipped', 'quote_superseded') $$,
  'each superseded revision is skipped, never sent with figures it was not queued for'
);
set local role authenticated;
select is((select status from public.staff_advance_order_status((select reference from order_a), 'confirmed', 'paid')), 'paid', 'then it is paid');
select throws_ok($$ select * from public.staff_save_order_quote((select reference from order_a), 3, 'AUD', 1, 0, 'https://pay.example.com/x') $$, '55000', 'order cannot be quoted', 'a paid order cannot be quoted again');
select throws_ok($$ select * from public.staff_queue_order_quote((select reference from order_a), 3) $$, '55000', 'order cannot be quoted', 'nor its quote sent');

-- Through to the end, then nothing more
select is((select status from public.staff_advance_order_status((select reference from order_a), 'paid', 'dispatched')), 'dispatched', 'paid moves to dispatched');
select is((select status from public.staff_advance_order_status((select reference from order_a), 'dispatched', 'closed')), 'closed', 'dispatched moves to closed');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'closed', 'cancelled') $$, '22023', 'transition not allowed', 'a closed order is final: it cannot be cancelled');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_a), 'closed', 'dispatched') $$, '22023', 'transition not allowed', 'nor reopened');
select is((select status from public.staff_advance_order_status((select reference from order_b), 'new', 'cancelled')), 'cancelled', 'an order can be cancelled before it is closed');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_b), 'cancelled', 'confirmed') $$, '22023', 'transition not allowed', 'a cancelled order is final');
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_b), 'cancelled', 'cancelled') $$, '22023', 'transition not allowed', 'and cannot be cancelled twice');
select is(
  (select array_agg(new_status order by created_at, new_status) from public.order_events where order_id = (select order_id from order_a) and event_type = 'status_changed'),
  array['closed', 'confirmed', 'dispatched', 'paid']::text[],
  'every change is recorded once (one transaction has one timestamp, so they sort by name)'
);

-- ---------------------------------------------------------------------------
-- Sending a quote never changes the status, whatever the provider says
-- ---------------------------------------------------------------------------

-- order_c: quoted, queued, then sent successfully while staff change its status
set local role service_role;
create temp table order_c on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Jo Tide', p_email => 'third@example.com', p_address_line1 => '9 Kelp Lane',
    p_city => 'Bayview', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-lumi", "title": "Lumi puzzle", "quantity": 3}]'::jsonb,
    p_submission_key => gen_random_uuid()
  );
reset role;
grant select on order_c to authenticated;
set local role authenticated;
select is((select quote_revision from public.staff_save_order_quote((select reference from order_c), 0, 'NZD', 900, 0, 'https://pay.example.com/c')), 1, 'order_c is quoted');
select is((select already_queued from public.staff_queue_order_quote((select reference from order_c), 1)), false, 'and its quote queued');
reset role;
set local role service_role;
create temp table oclaim_c on commit drop as select public.claim_order_emails(10, (select order_id from order_c), array['quote']) as result;
select is(public.record_order_email_attempt((select (result -> 'claimed' -> 0 ->> 'id')::uuid from oclaim_c), 'sent', 're_quote_c'), true, 'the provider accepts the quote email');
reset role;
select results_eq(
  $$ select status, quote_sent_at = now() from public.orders where id = (select order_id from order_c) $$,
  $$ values ('new'::text, true) $$,
  'the quote is marked sent and the order''s status is unchanged: sending never moves an order'
);
set local role authenticated;
select throws_ok($$ select * from public.staff_advance_order_status((select reference from order_c), 'confirmed', 'paid') $$, '40001', 'stale', 'a status change that fails after a sent quote');
reset role;
select results_eq(
  $$ select status, provider_message_id from public.order_email_outbox where order_id = (select order_id from order_c) and kind = 'quote' $$,
  $$ values ('sent'::text, 're_quote_c'::text) $$,
  'leaves the sent quote recorded as sent'
);
set local role authenticated;
select is((select already_queued from public.staff_queue_order_quote((select reference from order_c), 1)), true, 'and sending it again after delivery is a no-op: the email is never repeated');
reset role;
select is((select count(*)::integer from public.order_email_outbox where order_id = (select order_id from order_c) and kind = 'quote'), 1, 'still one quote email');

-- ---------------------------------------------------------------------------
-- Tracking link rotation by staff
-- ---------------------------------------------------------------------------

set local role service_role;
create temp table issued_b on commit drop as select tracking_token from order_b;
reset role;
set local role authenticated;
create temp table rotated on commit drop as select * from public.staff_rotate_order_tracking_token((select reference from order_b));
select ok((select tracking_token ~ '^[0-9a-f]{64}$' and tracking_token_expires_at > now() + interval '179 days' from rotated), 'staff get a new private link, once, with a fresh expiry');
select throws_ok($$ select * from public.staff_rotate_order_tracking_token('BB-0000-0000') $$, 'P0002', 'order not found', 'an unknown reference is not found');
reset role;
select is(public.lookup_order_by_token((select tracking_token from issued_b)), null, 'the old link stops working at once');
select is(public.lookup_order_by_token((select tracking_token from rotated)) ->> 'reference', (select reference from order_b), 'the new one works');
select results_eq(
  $$ select actor, actor_user_id::text from public.order_events where order_id = (select order_id from order_b) and event_type = 'tracking_token_rotated' $$,
  $$ values ('staff'::text, '00000000-0000-4000-8000-0000000000a1'::text) $$,
  'the rotation is recorded with the team as the actor and the staff member''s id'
);
select ok((select pg_catalog.strpos(to_jsonb(o)::text, r.tracking_token) = 0 from public.orders as o, rotated as r where o.id = (select order_id from order_b)), 'the new token is stored only as a hash');

-- ---------------------------------------------------------------------------
-- Deactivation takes effect on the next request
-- ---------------------------------------------------------------------------

update public.staff_users set active = false, disabled_at = now() where user_id = '00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select is(public.is_active_staff(), false, 'a deactivated staff member is no longer staff');
select is_empty($$ select id from public.orders $$, 'reads nothing');
select throws_ok($$ select * from public.staff_rotate_order_tracking_token((select reference from order_b)) $$, '42501', 'staff only', 'and can do nothing');
reset role;

select * from finish();
rollback;
