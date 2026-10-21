-- pgTAP checks over the whole public schema (fix wave T-I4): every table and function that exists
-- after the last migration, including the ones a later migration adds.
--
-- The other files name each table and function they prove. Supabase grants every new public table,
-- function and sequence to anon, authenticated and service_role directly, not through PUBLIC
-- (tests/support/supabase-db.ts models it), so a migration that revokes from PUBLIC only leaves a
-- new object open to the API roles while every per-object check stays green. This file asks the
-- catalogue instead: a table without forced row level security, or a grant to an API role that is
-- not on the lists below, fails here until the lists (and the reasoning behind them) are updated.
--
-- Objects that belong to an extension (pgTAP itself, if a project installs it into public) are not
-- written by the migrations and are left out. Runs in one transaction and rolls back. Run against a
-- Supabase project with `supabase test db` (Task 11); tests/orders/migration-database.test.ts runs
-- it in an embedded Postgres, after every migration, on every `npm test`.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

-- Relations and functions written by the migrations (not by an extension). Names are compared in the
-- database's default collation (pg_class and pg_proc names are collated "C").
create temp view own_relations as
  select c.oid, c.relname::text collate "default" as name, c.relkind
    from pg_catalog.pg_class as c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
     and not exists (select 1 from pg_catalog.pg_depend as d where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');
create temp view own_functions as
  select p.oid, (p.proname::text || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')') collate "default" as signature
    from pg_catalog.pg_proc as p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_catalog.pg_depend as d where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

select isnt_empty($$ select name from own_relations where relkind in ('r', 'p') $$, 'the sweep sees the migrated tables');
select is_empty(
  $$ select c.relname::text from pg_catalog.pg_class as c join own_relations as r on r.oid = c.oid
      where c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity) $$,
  'every table in public has row level security enabled AND forced'
);

-- ---------------------------------------------------------------------------
-- Tables, views and sequences: what each API role holds
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select r.name || ' ' || privilege from own_relations as r
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
      where r.relkind <> 'S' and pg_catalog.has_table_privilege('anon', r.oid, privilege) $$,
  'anon holds no privilege on any table or view in public'
);
select is_empty(
  $$ select r.name from own_relations as r
      where r.relkind <> 'S' and pg_catalog.has_any_column_privilege('anon', r.oid, 'SELECT, INSERT, UPDATE, REFERENCES') $$,
  'anon holds no column privilege in public'
);
select is_empty(
  $$ select r.name || ' ' || privilege from own_relations as r
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
      where r.relkind <> 'S' and pg_catalog.has_table_privilege('authenticated', r.oid, privilege) $$,
  'authenticated holds no table-wide privilege in public (staff read named columns only, under row level security)'
);
select results_eq(
  $$ select r.name from own_relations as r
      where r.relkind <> 'S' and pg_catalog.has_any_column_privilege('authenticated', r.oid, 'SELECT')
      order by r.name collate "C" $$,
  $$ values ('order_email_outbox'::text), ('order_events'), ('order_items'), ('orders'), ('staff_users') $$,
  'authenticated may read columns of exactly the four order tables and staff_users (migration 0007)'
);
select is_empty(
  $$ select r.name from own_relations as r
      where r.relkind <> 'S' and pg_catalog.has_any_column_privilege('authenticated', r.oid, 'INSERT, UPDATE, REFERENCES') $$,
  'authenticated may write no column in public'
);
select is_empty(
  $$ select r.name || ' ' || privilege from own_relations as r
       cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
      where r.relkind <> 'S'
        and (pg_catalog.has_table_privilege('service_role', r.oid, privilege)
             or pg_catalog.has_any_column_privilege('service_role', r.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) $$,
  'service_role holds no table or column privilege in public: it reaches the data through the functions below only'
);
select is_empty(
  $$ select r.name || ' ' || role from own_relations as r
       cross join unnest(array['anon', 'authenticated', 'service_role']) as role
      -- CASE: the planner may call the function before the relkind test, and it refuses a non-sequence.
      where case when r.relkind = 'S' then pg_catalog.has_sequence_privilege(role, r.oid, 'USAGE, SELECT, UPDATE') else false end $$,
  'no API role may use a sequence in public'
);
select is_empty(
  $$ select role from unnest(array['anon', 'authenticated', 'service_role']) as role where pg_catalog.has_schema_privilege(role, 'public', 'CREATE') $$,
  'no API role may create objects in public'
);

-- ---------------------------------------------------------------------------
-- Functions: an explicit list per API role; every other function is executable by none of them
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select f.signature from own_functions as f where pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE') $$,
  'anon can execute no function in public'
);
select results_eq(
  $$ select f.signature from own_functions as f where pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE') order by f.signature collate "C" $$,
  $$ values ('is_active_staff()'::text),
            ('staff_advance_order_status(text, text, text)'),
            ('staff_queue_order_quote(text, integer)'),
            ('staff_rotate_order_tracking_token(text)'),
            ('staff_save_order_quote(text, integer, text, integer, integer, text)') $$,
  'authenticated can execute exactly is_active_staff and the four staff functions (migration 0007), each of which checks for active staff itself'
);
select results_eq(
  $$ select f.signature from own_functions as f where pg_catalog.has_function_privilege('service_role', f.oid, 'EXECUTE') order by f.signature collate "C" $$,
  $$ values ('claim_contact_deliveries(integer, uuid)'::text),
            ('claim_lead_deliveries(integer, uuid, text[])'),
            ('claim_order_emails(integer, uuid, text[])'),
            ('consume_rate_limit(text, integer, integer)'),
            ('enqueue_lead_delivery(uuid, text, boolean)'),
            ('lookup_order_by_reference_email(text, text)'),
            ('lookup_order_by_token(text)'),
            ('record_contact_delivery_attempt(uuid, text, text, text)'),
            ('record_lead_delivery_attempt(uuid, text, text, text)'),
            ('record_order_email_attempt(uuid, text, text, text)'),
            ('rotate_order_tracking_token(uuid)'),
            ('submit_contact_message(text, text, text, text)'),
            ('submit_lead(text, boolean, text, text, text, text, text, jsonb)'),
            ('submit_order(text, text, text, text, text, boolean, text, jsonb, uuid, text, text, text, text, text)') $$,
  'service_role can execute exactly the server''s functions (migrations 0001-0008)'
);
select is_empty(
  $$ select f.signature from own_functions as f
       join pg_catalog.pg_proc as p on p.oid = f.oid
      where p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every security definer function in public pins an empty search_path'
);

select * from finish();
rollback;
