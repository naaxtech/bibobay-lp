-- BIBO Bay migration 0005: shared rate limits for orders, and tracking token rotation (Task 7a).
--
-- Shared rate limits (ruling R79). Migration 0001 already built the database-backed limiter that
-- every serverless instance shares: rate_limit_buckets and consume_rate_limit(bucket_key, max_hits,
-- window_seconds), service_role only. Orders reuse it unchanged, under their own bucket scopes, so
-- there is no second limiter table:
--   order:<keyed hash of the client address>         order submissions (lib/orders/submit.ts)
--   order-track:<keyed hash of the client address>   tracking lookups (lib/orders/track.ts)
-- The key is an HMAC computed by the server (lib/leads/http.ts; an IPv6 client counts per /64); no
-- address is ever stored. Keys stay well inside consume_rate_limit's 200-character bound.
--
-- Token rotation (spec §11 "Tracking tokens support expiry/rotation"). rotate_order_tracking_token
-- replaces an order's private token with a fresh one and a fresh expiry, and returns the new token
-- once; the old one stops working at once. For staff and the Task 8 worker (for example to put a
-- working link in an email, since only a hash of the token is stored), so service_role only.

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0005 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
  if pg_catalog.to_regprocedure('public.consume_rate_limit(text, integer, integer)') is null
     or pg_catalog.to_regprocedure('public.issue_order_tracking_token()') is null then
    raise exception 'Migrations 0001 and 0002 must be applied before 0005.' using errcode = '55000';
  end if;
end;
$guard$;

create or replace function public.rotate_order_tracking_token(p_order_id uuid)
returns table (tracking_token text, tracking_token_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_token       text;
  v_token_hash  text;
  v_expires_at  timestamptz;
  v_found       uuid;
begin
  if p_order_id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  select issued.token, issued.token_hash, issued.expires_at
    into v_token, v_token_hash, v_expires_at
    from public.issue_order_tracking_token() as issued;

  -- The status time is left alone: rotating a link is not a change to the order.
  update public.orders as o set
    tracking_token_hash       = v_token_hash,
    tracking_token_expires_at = v_expires_at,
    tracking_token_rotated_at = now(),
    updated_at                = now()
  where o.id = p_order_id
  returning o.id into v_found;

  if v_found is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  insert into public.order_events (order_id, actor, event_type, metadata)
  values (v_found, 'system', 'tracking_token_rotated', '{}'::jsonb);

  return query select v_token, v_expires_at;
end;
$fn$;

revoke all on function public.rotate_order_tracking_token(uuid) from public, anon, authenticated;
grant execute on function public.rotate_order_tracking_token(uuid) to service_role;

-- The same proof as 0004, for the function this migration adds.
do $verify$
begin
  if pg_catalog.has_function_privilege('anon', 'public.rotate_order_tracking_token(uuid)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.rotate_order_tracking_token(uuid)', 'EXECUTE') then
    raise exception 'rotate_order_tracking_token is executable by an anonymous or signed-in role' using errcode = '42501';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.rotate_order_tracking_token(uuid)', 'EXECUTE') then
    raise exception 'rotate_order_tracking_token is not executable by service_role' using errcode = '42501';
  end if;
end;
$verify$;
