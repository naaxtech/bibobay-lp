-- BIBO Bay migration 0004: lock the tracking payload (Task 7a; spec §11 "internal payload builder
-- functions are revoked from PUBLIC, anon, and authenticated"; "migration tests assert policy and
-- function grants").
--
-- order_tracking_payload builds an order's tracking view with NO token check and NO email check;
-- the two lookups in 0003 make those checks first. The design rests on that builder being out of
-- reach. On Supabase, revoking EXECUTE from PUBLIC alone does not achieve it: the platform's default
-- privileges grant every new function to anon, authenticated and service_role directly, and those
-- direct grants survive a revoke from PUBLIC. 0002 and 0003 already name every role; this migration
-- restates those revokes and then PROVES the result in the same transaction, so a deploy fails
-- loudly instead of leaving a door open if a grant ever regresses (another migration, a dashboard
-- click, a default privilege).

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0004 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
  if pg_catalog.to_regprocedure('public.order_tracking_payload(uuid)') is null then
    raise exception 'Migration 0003 must be applied before 0004.' using errcode = '55000';
  end if;
end;
$guard$;

-- The internal helpers: their owner only, and their caller's rights.
revoke all on function public.order_tracking_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.order_tracking_token_hash(text) from public, anon, authenticated, service_role;
revoke all on function public.issue_order_tracking_token() from public, anon, authenticated, service_role;
alter function public.order_tracking_payload(uuid) security invoker;
alter function public.order_tracking_token_hash(text) security invoker;
alter function public.issue_order_tracking_token() security invoker;

-- Prove it, in the same transaction that did it.
do $verify$
declare
  v_role      text;
  v_function  text;
  v_table     text;
  v_privilege text;
begin
  -- Nobody but the owner may run an internal helper.
  foreach v_function in array array['public.order_tracking_payload(uuid)', 'public.order_tracking_token_hash(text)', 'public.issue_order_tracking_token()'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception 'internal order function % is executable by %', v_function, v_role using errcode = '42501';
      end if;
    end loop;
    if exists (
      select 1 from pg_catalog.aclexplode(
        coalesce((select p.proacl from pg_catalog.pg_proc p where p.oid = v_function::regprocedure),
                 pg_catalog.acldefault('f', (select p.proowner from pg_catalog.pg_proc p where p.oid = v_function::regprocedure)))
      ) as acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'internal order function % is executable by PUBLIC', v_function using errcode = '42501';
    end if;
  end loop;

  -- The order RPCs: service_role only.
  foreach v_function in array array[
    'public.submit_order(text, text, text, text, text, boolean, text, jsonb, text, text, text, text, text)',
    'public.lookup_order_by_token(text)',
    'public.lookup_order_by_reference_email(text, text)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception 'order RPC % is executable by %', v_function, v_role using errcode = '42501';
      end if;
    end loop;
    if not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'order RPC % is not executable by service_role', v_function using errcode = '42501';
    end if;
  end loop;

  -- No API role touches an order table directly, and RLS stays forced.
  foreach v_table in array array['public.orders', 'public.order_items', 'public.order_events', 'public.order_email_outbox'] loop
    if not (select c.relrowsecurity and c.relforcerowsecurity from pg_catalog.pg_class c where c.oid = v_table::regclass) then
      raise exception 'row level security is not forced on %', v_table using errcode = '42501';
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if pg_catalog.has_table_privilege(v_role, v_table, v_privilege) then
          raise exception '% holds % on %', v_role, v_privilege, v_table using errcode = '42501';
        end if;
      end loop;
    end loop;
  end loop;
end;
$verify$;
