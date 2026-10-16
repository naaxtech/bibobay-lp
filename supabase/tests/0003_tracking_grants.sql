-- pgTAP checks for migrations 0003-0005 (order tracking, the locked payload, token rotation; Task 7a).
--
-- Runs in one transaction and rolls back, so it leaves nothing behind. Run against a Supabase
-- project with `supabase test db` (Task 11); tests/orders/migration-database.test.ts runs it in an
-- embedded Postgres, after every migration, on every `npm test`.
--
-- Covers: the two lookups and token rotation are security definers with an empty search_path,
-- executable by service_role only; the payload builder is executable by nobody and runs with its
-- caller's rights; the payload holds the locked keys only (no address, email, notes, phone, SKU or
-- price); every miss is the same null; reference plus matching email; token expiry and rotation;
-- and order rate limits reuse the shared limiter from migration 0001 (R79).

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(58);

-- ---------------------------------------------------------------------------
-- Functions and grants
-- ---------------------------------------------------------------------------

select is_definer('public', 'lookup_order_by_token', array['text'], 'lookup_order_by_token is security definer');
select is_definer('public', 'lookup_order_by_reference_email', array['text', 'text'], 'lookup_order_by_reference_email is security definer');
select is_definer('public', 'rotate_order_tracking_token', array['uuid'], 'rotate_order_tracking_token is security definer');
select isnt_definer('public', 'order_tracking_payload', array['uuid'], 'the payload builder runs with its caller''s rights, so a stray grant reaches no table');
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('lookup_order_by_token', 'lookup_order_by_reference_email', 'rotate_order_tracking_token', 'order_tracking_payload')
       and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every tracking function pins an empty search_path'
);
select is_empty(
  $$ select p.proname::text from pg_catalog.pg_proc p
     cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as acl
     where p.pronamespace = 'public'::regnamespace and acl.grantee = 0 and acl.privilege_type = 'EXECUTE' $$,
  'no function in public is executable by PUBLIC'
);

select function_privs_are('public', 'lookup_order_by_token', array['text'], 'anon', array[]::text[], 'anon cannot look up an order by token');
select function_privs_are('public', 'lookup_order_by_token', array['text'], 'authenticated', array[]::text[], 'authenticated cannot look up an order by token');
select function_privs_are('public', 'lookup_order_by_token', array['text'], 'service_role', array['EXECUTE'], 'service_role can look up an order by token');
select function_privs_are('public', 'lookup_order_by_reference_email', array['text', 'text'], 'anon', array[]::text[], 'anon cannot look up an order by reference');
select function_privs_are('public', 'lookup_order_by_reference_email', array['text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot look up an order by reference');
select function_privs_are('public', 'lookup_order_by_reference_email', array['text', 'text'], 'service_role', array['EXECUTE'], 'service_role can look up an order by reference and email');
select function_privs_are('public', 'rotate_order_tracking_token', array['uuid'], 'anon', array[]::text[], 'anon cannot rotate a tracking token');
select function_privs_are('public', 'rotate_order_tracking_token', array['uuid'], 'authenticated', array[]::text[], 'authenticated cannot rotate a tracking token');
select function_privs_are('public', 'rotate_order_tracking_token', array['uuid'], 'service_role', array['EXECUTE'], 'service_role can rotate a tracking token');
select function_privs_are('public', 'order_tracking_payload', array['uuid'], 'anon', array[]::text[], 'anon cannot build a payload without a check');
select function_privs_are('public', 'order_tracking_payload', array['uuid'], 'authenticated', array[]::text[], 'authenticated cannot build a payload without a check');
select function_privs_are('public', 'order_tracking_payload', array['uuid'], 'service_role', array[]::text[], 'service_role cannot build a payload without a check');

-- ---------------------------------------------------------------------------
-- Behaviour as anon and authenticated: nothing works
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok($$ select public.lookup_order_by_token(repeat('0', 64)) $$, '42501', null, 'anon cannot call lookup_order_by_token');
select throws_ok($$ select public.lookup_order_by_reference_email('BB-0000-0000', 'parent@example.com') $$, '42501', null, 'anon cannot call lookup_order_by_reference_email');
select throws_ok($$ select public.order_tracking_payload(gen_random_uuid()) $$, '42501', null, 'anon cannot call the payload builder');
select throws_ok($$ select * from public.rotate_order_tracking_token(gen_random_uuid()) $$, '42501', null, 'anon cannot rotate a token');

reset role;
set local role authenticated;

select throws_ok($$ select public.lookup_order_by_token(repeat('0', 64)) $$, '42501', null, 'authenticated cannot call lookup_order_by_token');
select throws_ok($$ select public.lookup_order_by_reference_email('BB-0000-0000', 'parent@example.com') $$, '42501', null, 'authenticated cannot call lookup_order_by_reference_email');
select throws_ok($$ select public.order_tracking_payload(gen_random_uuid()) $$, '42501', null, 'authenticated cannot call the payload builder');
select throws_ok($$ select * from public.rotate_order_tracking_token(gen_random_uuid()) $$, '42501', null, 'authenticated cannot rotate a token');

-- ---------------------------------------------------------------------------
-- Behaviour as service_role
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;

create temp table fixture on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Sam Rivers', p_email => 'parent@example.com', p_address_line1 => '12 Harbour Road',
    p_city => 'Seaside', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-tula", "title": "Tula plush", "sku": "BB-TULA-01", "variant": "Large", "pack": "Single", "quantity": 2},
                 {"sanity_id": "product-bob", "title": "Bob book", "sku": null, "variant": null, "pack": null, "quantity": 1}]'::jsonb,
    p_phone => '+61 2 5550 1234', p_postal_code => '2000', p_notes => 'Leave at the door',
    p_submission_key => gen_random_uuid()
  );
create temp table other on commit drop as
  select * from public.submit_order(
    p_contact_name => 'Alex Shore', p_email => 'other@example.com', p_address_line1 => '3 Reef Street',
    p_city => 'Bayview', p_country => 'AU', p_consent => true, p_consent_version => 'consent-v1',
    p_lines => '[{"sanity_id": "product-lumi", "title": "Lumi puzzle", "quantity": 1}]'::jsonb,
    p_submission_key => gen_random_uuid()
  );

-- The private token
select is(
  public.lookup_order_by_token((select tracking_token from fixture)) ->> 'reference',
  (select reference from fixture),
  'the private token finds its own order'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.lookup_order_by_token((select tracking_token from fixture))) as k),
  array['lines', 'reference', 'status', 'statusChangedAt', 'submittedAt'],
  'the payload holds the locked keys only'
);
select is(
  public.lookup_order_by_token((select tracking_token from fixture)) -> 'lines',
  '[{"title": "Tula plush", "variant": "Large", "pack": "Single", "quantity": 2}, {"title": "Bob book", "variant": null, "pack": null, "quantity": 1}]'::jsonb,
  'each line shows its title, variant, pack and quantity, in order'
);
select is(
  public.lookup_order_by_token((select tracking_token from fixture)) ->> 'status',
  'new',
  'the payload shows the order status'
);
select ok(
  public.lookup_order_by_token((select tracking_token from fixture))::text !~* 'example\.com|harbour|seaside|5550|door|sam rivers|BB-TULA|product-',
  'the payload holds no email, name, address, phone, notes, SKU or product id'
);
select is(public.lookup_order_by_token(repeat('0', 64)), null, 'an unknown token finds nothing');
select is(public.lookup_order_by_token(upper((select tracking_token from fixture))), null, 'an upper-cased token finds nothing');
select is(public.lookup_order_by_token('not-a-token'), null, 'a malformed token finds nothing');
select is(public.lookup_order_by_token(null), null, 'a missing token finds nothing');

-- Reference plus the matching email
select is(
  public.lookup_order_by_reference_email((select reference from fixture), 'parent@example.com'),
  public.lookup_order_by_token((select tracking_token from fixture)),
  'the reference with its email returns the same payload as the token'
);
select is(
  public.lookup_order_by_reference_email(' ' || lower((select reference from fixture)) || ' ', ' PARENT@Example.com ') ->> 'reference',
  (select reference from fixture),
  'the reference and email match regardless of case and surrounding spaces'
);
select is(public.lookup_order_by_reference_email((select reference from fixture), 'other@example.com'), null, 'a reference with another order''s email finds nothing');
select is(public.lookup_order_by_reference_email((select reference from fixture), 'nobody@example.com'), null, 'a reference with an unknown email finds nothing');
select is(public.lookup_order_by_reference_email('BB-0000-0000', 'parent@example.com'), null, 'an unknown reference finds nothing');
select is(public.lookup_order_by_reference_email((select reference from fixture), null), null, 'a reference alone finds nothing');
select is(public.lookup_order_by_reference_email((select reference from fixture), ''), null, 'a reference with a blank email finds nothing');
select is(public.lookup_order_by_reference_email(null, 'parent@example.com'), null, 'an email alone finds nothing');

-- Expiry: the token stops working; reference plus email still does
reset role;
update public.orders
   set tracking_token_expires_at = now() - interval '1 second', status_changed_at = '2026-01-01 00:00:00+00'
 where reference = (select reference from fixture);
set local role service_role;

select is(public.lookup_order_by_token((select tracking_token from fixture)), null, 'an expired token finds nothing');
select is(
  public.lookup_order_by_reference_email((select reference from fixture), 'parent@example.com') ->> 'reference',
  (select reference from fixture),
  'the reference with its email still works after the token expires'
);

-- Rotation (0005)
create temp table rotated on commit drop as
  select * from public.rotate_order_tracking_token((select order_id from fixture));

select ok(
  (select r.tracking_token ~ '^[0-9a-f]{64}$' and r.tracking_token <> (select tracking_token from fixture) from rotated as r),
  'rotation issues a new token'
);
select ok(
  (select r.tracking_token_expires_at > now() + interval '179 days' from rotated as r),
  'with a fresh expiry'
);
select is(public.lookup_order_by_token((select tracking_token from fixture)), null, 'the old token stays dead after rotation');
select is(
  public.lookup_order_by_token((select tracking_token from rotated)) ->> 'reference',
  (select reference from fixture),
  'the new token finds the order'
);
select is(public.lookup_order_by_token((select tracking_token from other)) ->> 'reference', (select reference from other), 'rotating one order leaves the others alone');
select throws_ok(
  $$ select * from public.rotate_order_tracking_token(gen_random_uuid()) $$,
  'P0002', 'order not found', 'rotating an unknown order fails'
);

reset role;

select is(
  (select count(*)::integer from public.order_events as e
     where e.order_id = (select order_id from fixture) and e.event_type = 'tracking_token_rotated' and e.actor = 'system'),
  1,
  'rotation is recorded in the audit trail'
);
select ok(
  (select o.tracking_token_rotated_at = now() and o.status_changed_at = '2026-01-01 00:00:00+00'::timestamptz
     from public.orders as o where o.id = (select order_id from fixture)),
  'rotation records when it happened and leaves the status time alone'
);
select ok(
  (select pg_catalog.strpos(to_jsonb(o)::text, r.tracking_token) = 0 from public.orders as o, rotated as r where o.id = (select order_id from fixture)),
  'the rotated token is stored only as a hash'
);

-- ---------------------------------------------------------------------------
-- Shared rate limits (R79): order buckets reuse consume_rate_limit from migration 0001
-- ---------------------------------------------------------------------------

set local role service_role;

select is((select allowed from public.consume_rate_limit('order:' || repeat('a', 64), 1, 3600)), true, 'an order bucket allows its first hit');
select is((select allowed from public.consume_rate_limit('order:' || repeat('a', 64), 1, 3600)), false, 'and refuses the hit past its limit');
select is((select allowed from public.consume_rate_limit('order-track:' || repeat('a', 64), 1, 600)), true, 'tracking lookups count in their own bucket');

reset role;

select is(
  (select count(*)::integer from pg_catalog.pg_tables where schemaname = 'public' and tablename ~ 'rate'),
  1,
  'one shared rate-limit table serves leads and orders'
);

select * from finish();
rollback;
