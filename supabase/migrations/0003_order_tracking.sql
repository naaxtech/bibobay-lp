-- BIBO Bay migration 0003: order tracking (Task 7a; spec §10 step 11, §11).
--
-- Two ways for a buyer to see their own order, and no third:
--   1. lookup_order_by_token: the private token issued with the order (migration 0002). Only its
--      hash is stored; it expires, and staff can rotate it (migration 0005).
--   2. lookup_order_by_reference_email: the human-readable reference AND the email the order was
--      placed with, both normalised. A reference alone reveals nothing.
--
-- Both return one locked payload (order_tracking_payload): reference, status, when it was
-- submitted, when its status last changed, and each line's title, variant, pack and quantity.
-- Never the address, email, name, phone, notes, SKU, product id, any price or the payment link.
--
-- Both return NULL for every miss (unknown, malformed, expired, wrong email), and the caller cannot
-- tell which. A form that answered "no such reference" for one and "wrong email" for another would
-- be an oracle for which references exist.
--
-- Executable by service_role only: the server route (app/api/orders/track) rate-limits each client
-- before calling them, and answers every miss with the same generic message.

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0003 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
  if pg_catalog.to_regclass('public.orders') is null
     or pg_catalog.to_regprocedure('public.order_tracking_token_hash(text)') is null then
    raise exception 'Migration 0002 must be applied before 0003.' using errcode = '55000';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Internal: the one payload both lookups return. Invoker rights and no grant to anyone, so even a
-- stray grant would reach no table: only the definer lookups below, after their checks, call it.
-- ---------------------------------------------------------------------------

create or replace function public.order_tracking_payload(p_order_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object(
    'reference', o.reference,
    'status', o.status,
    'submittedAt', o.created_at,
    'statusChangedAt', o.status_changed_at,
    'lines', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('title', i.title, 'variant', i.variant, 'pack', i.pack, 'quantity', i.quantity)
          order by i.line_number
        )
        from public.order_items as i
        where i.order_id = o.id
      ),
      '[]'::jsonb
    )
  )
  from public.orders as o
  where o.id = p_order_id;
$fn$;

revoke all on function public.order_tracking_payload(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- lookup_order_by_token: the private link. NULL unless the token is well formed, matches a stored
-- hash and has not expired.
-- ---------------------------------------------------------------------------

create or replace function public.lookup_order_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_order_id uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select o.id into v_order_id
  from public.orders as o
  where o.tracking_token_hash = public.order_tracking_token_hash(p_token)
    and o.tracking_token_expires_at > now();

  if v_order_id is null then
    return null;
  end if;
  return public.order_tracking_payload(v_order_id);
end;
$fn$;

revoke all on function public.lookup_order_by_token(text) from public, anon, authenticated;
grant execute on function public.lookup_order_by_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- lookup_order_by_reference_email: the lookup form. Reference AND email, trimmed and case-folded
-- (orders.email is stored normalised). NULL for an unknown reference and for a wrong email alike.
-- ---------------------------------------------------------------------------

create or replace function public.lookup_order_by_reference_email(p_reference text, p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_reference  text := upper(btrim(coalesce(p_reference, '')));
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_order_id   uuid;
begin
  if v_reference !~ '^BB-[0-9A-F]{4}-[0-9A-F]{4}$' or char_length(v_email) not between 3 and 254 then
    return null;
  end if;

  select o.id into v_order_id
  from public.orders as o
  where o.reference = v_reference and o.email = v_email;

  if v_order_id is null then
    return null;
  end if;
  return public.order_tracking_payload(v_order_id);
end;
$fn$;

revoke all on function public.lookup_order_by_reference_email(text, text) from public, anon, authenticated;
grant execute on function public.lookup_order_by_reference_email(text, text) to service_role;
