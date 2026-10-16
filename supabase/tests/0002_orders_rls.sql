-- pgTAP checks for migration 0002 (orders; Task 7a).
--
-- Runs in one transaction and rolls back, so it leaves nothing behind. Run against a Supabase
-- project with `supabase test db` (Task 11); tests/orders/migration-database.test.ts runs it in an
-- embedded Postgres, after every migration, on every `npm test`.
--
-- Covers: RLS enabled AND forced with no policies on the four order tables; no table privilege for
-- anon, authenticated or service_role; submit_order a security definer with an empty search_path,
-- executable by service_role only; the token helpers executable by nobody but their owner; real
-- behaviour under each API role; bounded, validated arguments; an atomic write of the order, its
-- lines, its audit event and its outbox rows; the tracking token stored only as a hash; and one
-- order per submission key (R81): a repeat answers with the first order and writes nothing.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(110);

-- ---------------------------------------------------------------------------
-- Tables: RLS enabled and forced, no policies, no privileges for any API role
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.orders'::regclass),
  'orders: row level security enabled and forced'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.order_items'::regclass),
  'order_items: row level security enabled and forced'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.order_events'::regclass),
  'order_events: row level security enabled and forced'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.order_email_outbox'::regclass),
  'order_email_outbox: row level security enabled and forced'
);
select is_empty(
  $$ select tablename::text from pg_catalog.pg_policies
     where schemaname = 'public' and tablename in ('orders', 'order_items', 'order_events', 'order_email_outbox')
       -- Migration 0007 (Task 8b) adds one staff read policy per table, for signed-in users; it
       -- passes for active staff only (supabase/tests/0005_staff_access.sql). Nothing else.
       and not (cmd = 'SELECT' and roles = array['authenticated']::name[] and policyname like '%\_staff\_read') $$,
  'no row policies on the order tables beyond the staff reads of 0007: every API role is denied by default'
);

select table_privs_are('public', 'orders', 'anon', array[]::text[], 'anon has no privilege on orders');
select table_privs_are('public', 'orders', 'authenticated', array[]::text[], 'authenticated has no privilege on orders');
select table_privs_are('public', 'orders', 'service_role', array[]::text[], 'service_role reaches orders only through RPCs');
select table_privs_are('public', 'order_items', 'anon', array[]::text[], 'anon has no privilege on order_items');
select table_privs_are('public', 'order_items', 'authenticated', array[]::text[], 'authenticated has no privilege on order_items');
select table_privs_are('public', 'order_items', 'service_role', array[]::text[], 'service_role reaches order_items only through RPCs');
select table_privs_are('public', 'order_events', 'anon', array[]::text[], 'anon has no privilege on order_events');
select table_privs_are('public', 'order_events', 'authenticated', array[]::text[], 'authenticated has no privilege on order_events');
select table_privs_are('public', 'order_events', 'service_role', array[]::text[], 'service_role reaches order_events only through RPCs');
select table_privs_are('public', 'order_email_outbox', 'anon', array[]::text[], 'anon has no privilege on order_email_outbox');
select table_privs_are('public', 'order_email_outbox', 'authenticated', array[]::text[], 'authenticated has no privilege on order_email_outbox');
select table_privs_are('public', 'order_email_outbox', 'service_role', array[]::text[], 'service_role reaches order_email_outbox only through RPCs');

select has_column('public', 'orders', 'tracking_token_hash', 'orders keeps a hash of the private tracking token');
select hasnt_column('public', 'orders', 'tracking_token', 'orders never stores the raw tracking token');
select has_column('public', 'orders', 'tracking_token_expires_at', 'orders records when the tracking token expires');
select has_column('public', 'orders', 'retain_until', 'orders keeps retention metadata (spec 11)');
select col_not_null('public', 'orders', 'submission_key', 'every order records the key of the request that made it (R81)');
select col_is_unique('public', 'orders', 'submission_key', 'one order per submission key (R81)');
select columns_are(
  'public', 'order_items',
  array['id', 'order_id', 'line_number', 'sanity_id', 'title', 'sku', 'variant', 'pack', 'quantity', 'created_at'],
  'order_items snapshots the canonical product and a quantity, nothing else'
);

-- ---------------------------------------------------------------------------
-- Functions: definer RPC, invoker helpers, empty search_path, service_role only
-- ---------------------------------------------------------------------------

select is_definer(
  'public', 'submit_order',
  array['text', 'text', 'text', 'text', 'text', 'boolean', 'text', 'jsonb', 'uuid', 'text', 'text', 'text', 'text', 'text'],
  'submit_order is security definer'
);
select isnt_definer('public', 'order_tracking_token_hash', array['text'], 'the token hash helper runs with its caller''s rights');
select isnt_definer('public', 'issue_order_tracking_token', array[]::text[], 'the token issuer runs with its caller''s rights');
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('submit_order', 'order_tracking_token_hash', 'issue_order_tracking_token')
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every order function pins an empty search_path'
);
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as acl
     where p.pronamespace = 'public'::regnamespace and acl.grantee = 0 and acl.privilege_type = 'EXECUTE' $$,
  'no function in public is executable by PUBLIC'
);

select function_privs_are('public', 'submit_order', array['text', 'text', 'text', 'text', 'text', 'boolean', 'text', 'jsonb', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot execute submit_order');
select function_privs_are('public', 'submit_order', array['text', 'text', 'text', 'text', 'text', 'boolean', 'text', 'jsonb', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot execute submit_order');
select function_privs_are('public', 'submit_order', array['text', 'text', 'text', 'text', 'text', 'boolean', 'text', 'jsonb', 'uuid', 'text', 'text', 'text', 'text', 'text'], 'service_role', array['EXECUTE'], 'service_role can execute submit_order');
select function_privs_are('public', 'order_tracking_token_hash', array['text'], 'anon', array[]::text[], 'anon cannot execute the token hash helper');
select function_privs_are('public', 'order_tracking_token_hash', array['text'], 'authenticated', array[]::text[], 'authenticated cannot execute the token hash helper');
select function_privs_are('public', 'order_tracking_token_hash', array['text'], 'service_role', array[]::text[], 'service_role cannot execute the token hash helper');
select function_privs_are('public', 'issue_order_tracking_token', array[]::text[], 'anon', array[]::text[], 'anon cannot issue a tracking token');
select function_privs_are('public', 'issue_order_tracking_token', array[]::text[], 'authenticated', array[]::text[], 'authenticated cannot issue a tracking token');
select function_privs_are('public', 'issue_order_tracking_token', array[]::text[], 'service_role', array[]::text[], 'service_role cannot issue a tracking token outside an RPC');

-- A caller for submit_order with valid defaults; each check overrides one argument. It runs with
-- the rights of whoever calls it, so `set local role` decides which role is being tested.
create function pg_temp.try_order(
  p_lines            jsonb   default '[{"sanity_id": "product-tula", "title": "Tula plush", "sku": "BB-TULA-01", "variant": "Large", "pack": "Single", "quantity": 2}]',
  p_contact_name     text    default 'Sam Rivers',
  p_email            text    default 'parent@example.com',
  p_address_line1    text    default '12 Harbour Road',
  p_city             text    default 'Seaside',
  p_country          text    default 'AU',
  p_consent          boolean default true,
  p_consent_version  text    default 'consent-v1',
  p_phone            text    default null,
  p_address_line2    text    default null,
  p_region           text    default null,
  p_postal_code      text    default null,
  p_notes            text    default null,
  p_submission_key   uuid    default gen_random_uuid()
)
returns text
language sql
as $fn$
  select o.reference from public.submit_order(
    p_contact_name => p_contact_name, p_email => p_email, p_address_line1 => p_address_line1, p_city => p_city,
    p_country => p_country, p_consent => p_consent, p_consent_version => p_consent_version, p_lines => p_lines,
    p_phone => p_phone, p_address_line2 => p_address_line2, p_region => p_region, p_postal_code => p_postal_code,
    p_notes => p_notes, p_submission_key => p_submission_key
  ) as o;
$fn$;

-- ---------------------------------------------------------------------------
-- Behaviour as anon and authenticated: nothing works
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok($$ select * from public.orders $$, '42501', null, 'anon cannot read orders');
select throws_ok($$ select * from public.order_items $$, '42501', null, 'anon cannot read order lines');
select throws_ok(
  $$ insert into public.orders (reference, contact_name, email, address_line1, city, country, consent_version, tracking_token_hash, tracking_token_expires_at)
     values ('BB-0000-0000', 'Anon', 'anon@example.com', 'x', 'x', 'AU', 'v1', repeat('0', 64), now()) $$,
  '42501', null, 'anon cannot insert an order directly'
);
select throws_ok($$ select pg_temp.try_order() $$, '42501', null, 'anon cannot call submit_order');

reset role;
set local role authenticated;

select throws_ok($$ select * from public.orders $$, '42501', null, 'authenticated cannot read orders');
-- Since migration 0007 staff may read the audit trail's columns, under a policy that passes for
-- active staff only: a signed-in user who is not staff (here: no user at all) reads no row.
select is_empty($$ select * from public.order_events $$, 'authenticated reads nothing of the order audit trail without an active staff row');
select throws_ok($$ select * from public.order_email_outbox $$, '42501', null, 'authenticated cannot read the order outbox');
select throws_ok($$ select pg_temp.try_order() $$, '42501', null, 'authenticated cannot call submit_order');

-- ---------------------------------------------------------------------------
-- Behaviour as service_role: the RPC only
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

select throws_ok($$ select * from public.orders $$, '42501', null, 'service_role cannot read orders directly');
select throws_ok($$ select * from public.order_items $$, '42501', null, 'service_role cannot read order lines directly');
select throws_ok(
  $$ insert into public.order_events (order_id, actor, event_type) values (gen_random_uuid(), 'staff', 'forged') $$,
  '42501', null, 'service_role cannot write the audit trail directly'
);
select throws_ok($$ select * from public.issue_order_tracking_token() $$, '42501', null, 'service_role cannot mint a tracking token outside an order');

create temp table fixture on commit drop as
  select * from public.submit_order(
    p_contact_name => '  Sam Rivers ', p_email => ' Parent@Example.COM ', p_address_line1 => '12 Harbour Road',
    p_city => 'Seaside', p_country => 'au', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-tula", "title": "Tula plush", "sku": "BB-TULA-01", "variant": "Large", "pack": "Single", "quantity": 2},
                 {"sanity_id": "product-bob", "title": "Bob book", "sku": null, "variant": null, "pack": null, "quantity": 1}]'::jsonb,
    p_phone => '+61 2 5550 1234', p_postal_code => '2000', p_notes => 'Leave at the door',
    p_submission_key => '0f5b6c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f'
  );

select ok((select reference ~ '^BB-[0-9A-F]{4}-[0-9A-F]{4}$' from fixture), 'an order gets a human-readable reference');
select ok((select tracking_token ~ '^[0-9a-f]{64}$' from fixture), 'and a private 64-hex tracking token, returned once');
select ok(
  (select tracking_token_expires_at > now() + interval '179 days' and tracking_token_expires_at <= now() + interval '180 days' from fixture),
  'the tracking token expires 180 days after it is issued'
);
select is((select acknowledgement_queued from fixture), true, 'the buyer acknowledgement is queued in the same transaction');
select isnt(
  (select reference from fixture),
  pg_temp.try_order(p_email => 'second@example.com'),
  'every order gets its own reference'
);

-- R81: one order per submission key. The form keeps its key across retries, so a request whose
-- answer was lost and is sent again finds the first order instead of making a second one.
select is((select duplicate from fixture), false, 'a first submission is not a duplicate');

reset role;
create temp table counts_before_repeat on commit drop as
  select (select count(*) from public.orders) as orders, (select count(*) from public.order_items) as items,
         (select count(*) from public.order_events) as events, (select count(*) from public.order_email_outbox) as outbox;
set local role service_role;

create temp table repeat on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Sam Rivers', p_email => 'PARENT@example.com ', p_address_line1 => '12 Harbour Road',
    p_city => 'Seaside', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-tula", "title": "Tula plush", "sku": "BB-TULA-01", "variant": "Large", "pack": "Single", "quantity": 2}]'::jsonb,
    p_submission_key => '0f5b6c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f'
  );

select is((select order_id from repeat), (select order_id from fixture), 'a repeated submission key answers with the first order');
select is((select reference from repeat), (select reference from fixture), 'and its reference');
select ok((select tracking_token is null and tracking_token_expires_at is null from repeat), 'a repeat issues no tracking token: the first one exists only as a hash');
select is((select acknowledgement_queued from repeat), false, 'a repeat queues no second acknowledgement');
select is((select duplicate from repeat), true, 'and says it is a duplicate');
select throws_ok(
  $$ select pg_temp.try_order(p_email => 'someone-else@example.com', p_submission_key => '0f5b6c1e-2d3a-4b5c-8d9e-0a1b2c3d4e5f') $$,
  '23505', 'submission key already used', 'a repeated key with another email is refused, without saying whose order it is'
);
select throws_ok($$ select pg_temp.try_order(p_submission_key => null) $$, '22023', 'submission key is required', 'submit_order needs a submission key');

reset role;
select ok(
  (select c.orders = (select count(*) from public.orders) and c.items = (select count(*) from public.order_items)
          and c.events = (select count(*) from public.order_events) and c.outbox = (select count(*) from public.order_email_outbox)
     from counts_before_repeat as c),
  'a repeat writes no order, line, audit event or outbox row'
);
set local role service_role;

-- Arguments: consent, bounds and shapes. Error messages never repeat the submitted values.
select throws_ok($$ select pg_temp.try_order(p_consent => false) $$, '22023', 'consent is required', 'submit_order refuses an order without consent');
select throws_ok($$ select pg_temp.try_order(p_consent => null) $$, '22023', 'consent is required', 'submit_order treats missing consent as no consent');
select throws_ok($$ select pg_temp.try_order(p_consent_version => ' ') $$, '22023', 'consent version is invalid', 'submit_order needs a consent version');
select throws_ok($$ select pg_temp.try_order(p_contact_name => ' ') $$, '22023', 'contact name is invalid', 'submit_order needs a contact name');
select throws_ok($$ select pg_temp.try_order(p_contact_name => repeat('n', 121)) $$, '22023', 'contact name is invalid', 'submit_order bounds the contact name');
select throws_ok($$ select pg_temp.try_order(p_email => 'not-an-email') $$, '22023', 'email is invalid', 'submit_order refuses an invalid email');
select throws_ok($$ select pg_temp.try_order(p_phone => 'call me maybe') $$, '22023', 'phone is invalid', 'submit_order refuses letters in a phone number');
select throws_ok($$ select pg_temp.try_order(p_address_line1 => repeat('a', 201)) $$, '22023', 'address is invalid', 'submit_order bounds the address');
select throws_ok($$ select pg_temp.try_order(p_address_line1 => 'line' || chr(10) || 'break') $$, '22023', 'address is invalid', 'submit_order refuses a line break in a one-line field');
select throws_ok($$ select pg_temp.try_order(p_address_line2 => repeat('a', 201)) $$, '22023', 'address is invalid', 'submit_order bounds the second address line');
select throws_ok($$ select pg_temp.try_order(p_city => repeat('c', 101)) $$, '22023', 'address is invalid', 'submit_order bounds the city');
select throws_ok($$ select pg_temp.try_order(p_region => repeat('r', 101)) $$, '22023', 'address is invalid', 'submit_order bounds the region');
select throws_ok($$ select pg_temp.try_order(p_postal_code => repeat('1', 17)) $$, '22023', 'address is invalid', 'submit_order bounds the postal code');
select throws_ok($$ select pg_temp.try_order(p_country => 'AUS') $$, '22023', 'address is invalid', 'submit_order accepts a two-letter country code only');
select throws_ok($$ select pg_temp.try_order(p_notes => repeat('n', 1001)) $$, '22023', 'notes are invalid', 'submit_order bounds the notes');
select throws_ok($$ select pg_temp.try_order(p_notes => 'ring' || chr(7)) $$, '22023', 'notes are invalid', 'submit_order refuses control characters in the notes');

-- Lines: 1 to 40, whole quantities from 1 to 999, published ids, canonical snapshot keys only.
select throws_ok($$ select pg_temp.try_order(p_lines => '[]') $$, '22023', 'order lines are invalid', 'submit_order needs at least one line');
select throws_ok($$ select pg_temp.try_order(p_lines => null) $$, '22023', 'order lines are invalid', 'submit_order needs the lines');
select throws_ok(
  $$ select pg_temp.try_order(p_lines => (select jsonb_agg(jsonb_build_object('sanity_id', 'product-' || n, 'title', 'P' || n, 'quantity', 1)) from generate_series(1, 41) as n)) $$,
  '22023', 'order lines are invalid', 'submit_order holds at most 40 lines'
);
select lives_ok(
  $$ select pg_temp.try_order(p_lines => (select jsonb_agg(jsonb_build_object('sanity_id', 'product-' || n, 'title', 'P' || n, 'quantity', 999)) from generate_series(1, 40) as n)) $$,
  'submit_order accepts 40 lines of 999'
);
select throws_ok($$ select pg_temp.try_order(p_lines => '[{"sanity_id": "product-tula", "title": "Tula", "quantity": 0}]') $$, '22023', 'order lines are invalid', 'a quantity of 0 is refused');
select throws_ok($$ select pg_temp.try_order(p_lines => '[{"sanity_id": "product-tula", "title": "Tula", "quantity": 1000}]') $$, '22023', 'order lines are invalid', 'a quantity over 999 is refused');
select throws_ok($$ select pg_temp.try_order(p_lines => '[{"sanity_id": "product-tula", "title": "Tula", "quantity": 1.5}]') $$, '22023', 'order lines are invalid', 'a fractional quantity is refused');
select throws_ok($$ select pg_temp.try_order(p_lines => '[{"sanity_id": "product-tula", "title": "Tula", "quantity": "2"}]') $$, '22023', 'order lines are invalid', 'a quantity must be a number');
select throws_ok(
  $$ select pg_temp.try_order(p_lines => '[{"sanity_id": "product-tula", "title": "Tula", "quantity": 1}, {"sanity_id": "product-tula", "title": "Tula", "quantity": 1}]') $$,
  '22023', 'order lines are invalid', 'one product appears on one line only'
);
select throws_ok($$ select pg_temp.try_order(p_lines => '[{"sanity_id": "drafts.product-tula", "title": "Tula", "quantity": 1}]') $$, '22023', 'order lines are invalid', 'a draft id is refused');
select throws_ok($$ select pg_temp.try_order(p_lines => '[{"sanity_id": "product-tula", "title": "Tula", "quantity": 1, "price": 0}]') $$, '22023', 'order lines are invalid', 'a line carries no price or any other extra key');
select throws_ok($$ select pg_temp.try_order(p_lines => '[{"sanity_id": "product-tula", "title": " ", "quantity": 1}]'::jsonb || '[]'::jsonb) $$, '22023', 'order lines are invalid', 'a line needs a title');
select throws_ok(
  $$ select pg_temp.try_order(p_lines => jsonb_build_array(jsonb_build_object('sanity_id', 'product-tula', 'title', repeat('t', 201), 'quantity', 1))) $$,
  '22023', 'order lines are invalid', 'a title is bounded'
);
select throws_ok(
  $$ select pg_temp.try_order(p_lines => jsonb_build_array(jsonb_build_object('sanity_id', 'product-tula', 'title', 'Tula', 'sku', repeat('S', 65), 'quantity', 1))) $$,
  '22023', 'order lines are invalid', 'a SKU is bounded'
);
select throws_ok(
  $$ select pg_temp.try_order(p_lines => jsonb_build_array(jsonb_build_object('sanity_id', 'product-tula', 'title', 'Tula', 'pack', 3, 'quantity', 1))) $$,
  '22023', 'order lines are invalid', 'a pack is text or null'
);

-- ---------------------------------------------------------------------------
-- What was stored (read as the owner)
-- ---------------------------------------------------------------------------

reset role;

select is(
  (select concat_ws('|', o.contact_name, o.email, o.phone, o.address_line1, o.city, o.postal_code, o.country, o.notes, o.consent_version, o.status)
     from public.orders as o where o.reference = (select reference from fixture)),
  'Sam Rivers|parent@example.com|+61 2 5550 1234|12 Harbour Road|Seaside|2000|AU|Leave at the door|consent-v1|new',
  'the order stores trimmed adult details, the normalised email, the consent version and status new'
);
select ok(
  (select o.consent_granted_at = now() and o.status_changed_at = now() from public.orders as o where o.reference = (select reference from fixture)),
  'consent is recorded with the server''s timestamp'
);
select ok(
  (select o.currency is null and o.subtotal_minor is null and o.freight_minor is null and o.payment_url is null and o.quote_sent_at is null
     from public.orders as o where o.reference = (select reference from fixture)),
  'a new order carries no price, total or payment link: staff quote later'
);
select ok(
  (select o.tracking_token_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.tracking_token, 'UTF8')), 'hex')
     from public.orders as o join fixture as f on f.order_id = o.id),
  'the tracking token is stored as its SHA-256 hash'
);
select ok(
  (select pg_catalog.strpos(to_jsonb(o)::text, f.tracking_token) = 0 from public.orders as o join fixture as f on f.order_id = o.id),
  'the raw tracking token appears nowhere in the order row'
);
select results_eq(
  $$ select i.line_number::integer, i.sanity_id, i.title, i.sku, i.variant, i.pack, i.quantity
       from public.order_items as i where i.order_id = (select order_id from fixture) order by i.line_number $$,
  $$ values (1, 'product-tula'::text, 'Tula plush'::text, 'BB-TULA-01'::text, 'Large'::text, 'Single'::text, 2),
            (2, 'product-bob', 'Bob book', null, null, null, 1) $$,
  'the lines snapshot the canonical title, SKU, variant and pack, in order; missing codes are null'
);
select results_eq(
  $$ select e.actor, e.event_type, e.old_status, e.new_status, e.metadata
       from public.order_events as e where e.order_id = (select order_id from fixture) $$,
  $$ values ('customer'::text, 'order_submitted'::text, null::text, 'new'::text, '{"lines": 2}'::jsonb) $$,
  'the submission is recorded in the audit trail'
);
select results_eq(
  $$ select x.kind, x.status, x.attempts from public.order_email_outbox as x where x.order_id = (select order_id from fixture) order by x.kind $$,
  $$ values ('acknowledgement'::text, 'pending'::text, 0), ('staff_alert', 'pending', 0) $$,
  'the buyer acknowledgement and the staff alert wait in the outbox for the Task 8 worker'
);

select throws_ok(
  $$ update public.orders set status = 'shipped' where reference = (select reference from fixture) $$,
  '23514', null, 'the status column refuses a status outside the six'
);
select lives_ok(
  $$ do $do$
     declare
       v_status text;
     begin
       foreach v_status in array array['new', 'confirmed', 'paid', 'dispatched', 'closed', 'cancelled'] loop
         update public.orders set status = v_status where reference = (select reference from fixture);
       end loop;
     end;
     $do$ $$,
  'the status column accepts each of the six Task 6 statuses'
);
select throws_ok(
  $$ insert into public.order_items (order_id, line_number, sanity_id, title, quantity) values ((select order_id from fixture), 3, 'product-x', 'X', 1000) $$,
  '23514', null, 'the table itself bounds a line quantity'
);
select throws_ok(
  $$ insert into public.order_items (order_id, line_number, sanity_id, title, quantity) values ((select order_id from fixture), 41, 'product-x', 'X', 1) $$,
  '23514', null, 'the table itself bounds the number of lines'
);

-- ---------------------------------------------------------------------------
-- Atomicity: a failure anywhere in submit_order leaves nothing behind
-- ---------------------------------------------------------------------------
-- A trigger refuses the outbox insert, which submit_order makes after writing the order, its lines
-- and its audit event. The whole call must roll back.

create temp table counts_before on commit drop as
  select (select count(*) from public.orders) as orders, (select count(*) from public.order_items) as items,
         (select count(*) from public.order_events) as events, (select count(*) from public.order_email_outbox) as outbox;

create function public.test_refuse_order_outbox() returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  raise exception 'outbox unavailable' using errcode = 'P0001';
end;
$fn$;
create trigger test_refuse_order_outbox before insert on public.order_email_outbox
  for each row execute function public.test_refuse_order_outbox();

set local role service_role;
select throws_ok(
  $$ select pg_temp.try_order(p_email => 'atomic@example.com') $$,
  'P0001', 'outbox unavailable', 'a failure after the order row is written fails the whole call'
);
reset role;

drop trigger test_refuse_order_outbox on public.order_email_outbox;
drop function public.test_refuse_order_outbox();

select is((select count(*)::integer from public.orders where email = 'atomic@example.com'), 0, 'no order survives the failed call');
select ok(
  (select c.orders = (select count(*) from public.orders) and c.items = (select count(*) from public.order_items)
          and c.events = (select count(*) from public.order_events) and c.outbox = (select count(*) from public.order_email_outbox)
     from counts_before as c),
  'and neither do its lines, its audit event or its outbox rows'
);

select * from finish();
rollback;
