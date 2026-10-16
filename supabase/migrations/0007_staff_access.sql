-- BIBO Bay migration 0007: staff access (Task 8b; spec §5 "Staff routes", §10 steps 8-10, §11;
-- rulings R94-R98).
--
-- Staff sign in through Supabase Auth (email and password; the owner creates each account in
-- Supabase Auth, Task 11). Being signed in grants nothing: a person is staff only while an ACTIVE
-- row in staff_users names their auth user id. Every check below asks auth.uid(), the user id in
-- the request's verified JWT, never a value the caller passes in.
--
-- What this adds:
--
--   * staff_users: one row per staff member (their auth user id, an optional display name, the
--     active flag, when the row was made and when it was disabled). No password, no email: Supabase
--     Auth keeps those. Rows are written by the owner (SQL editor or dashboard); no API role can
--     write them. A signed-in user may read their own row and nothing else.
--   * is_active_staff(): true only while the caller's own row is active. A security definer so the
--     policies can consult staff_users without granting it; executable by `authenticated` only.
--   * Staff reads, under row level security (R95): a select policy for `authenticated` on orders,
--     order_items, order_events and order_email_outbox that passes only for active staff, and
--     column grants that never include orders.tracking_token_hash, orders.submission_key or the
--     outbox's delivery internals (provider message id, idempotency key, unconfirmed time). Anyone
--     else signed in reads no row at all. anon and service_role still hold no table privilege.
--   * Staff writes, only through four security definer RPCs executable by `authenticated`. Each
--     checks is_active_staff() first (42501 `staff only` otherwise), works on one order found by
--     its reference, locks it, and records what it did in order_events with actor `staff` and
--     actor_user_id = auth.uid():
--       staff_save_order_quote       currency (ISO 4217 letters), subtotal and freight (whole minor
--                                    units, 0..100,000,000) and the payment link; bumps
--                                    quote_revision; only while the order is `new` or `confirmed`;
--                                    names the revision the staff member saw (optimistic); never
--                                    notifies anyone (R96). Event `quote_saved`.
--       staff_queue_order_quote      sends one saved revision: queues it as a `quote` row in the
--                                    order outbox (migration 0006's idempotency key
--                                    <order id>:quote:<revision>), so sending the same revision
--                                    again queues nothing and answers `already_queued` (R96). Never
--                                    changes the status. Event `quote_queued`, once per revision.
--       staff_advance_order_status   one step of new -> confirmed -> paid -> dispatched -> closed, or
--                                    cancelled from any status before closed; closed and cancelled
--                                    are final. Names the status the staff member saw: if the order
--                                    has moved on, nothing changes (R98). Event `status_changed`.
--       staff_rotate_order_tracking_token  a new private tracking link, returned once; the old one
--                                    stops working at once. Event `tracking_token_rotated`, actor
--                                    `staff` (migration 0005's rotation stays the system's).
--   * The payment link is checked here for its shape (https, no user info, no port, no IP address,
--     no whitespace, at most 2,048 characters). Which hosts are allowed is the server's
--     PAYMENT_HOST_ALLOWLIST (lib/security/payment-url.ts, R97): the app refuses any other host
--     before it calls the RPC.
--
-- Errors carry fixed messages and these codes, which lib/orders/admin.ts maps to HTTP answers:
--   42501 staff only · P0002 order not found · 22023 invalid arguments · 40001 stale (the status or
--   quote revision the staff member saw is no longer the order's) · 55000 not possible in the
--   order's state (a quote for an order past `confirmed`, or a send with no saved quote).
--
-- Tests: tests/admin/staff-migration-policy.test.ts (static) and tests/orders/migration-database.test.ts
-- (runs every migration and supabase/tests/0005_staff_access.sql in an embedded Postgres).

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0007 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
  if pg_catalog.to_regprocedure('public.claim_order_emails(integer, uuid, text[])') is null
     or pg_catalog.to_regprocedure('public.issue_order_tracking_token()') is null then
    raise exception 'Migrations 0001 to 0006 must be applied before 0007.' using errcode = '55000';
  end if;
  if pg_catalog.to_regclass('auth.users') is null or pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception 'Migration 0007 needs Supabase Auth (auth.users and auth.uid()).' using errcode = '55000';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- staff_users
-- ---------------------------------------------------------------------------

create table if not exists public.staff_users (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  disabled_at   timestamptz,
  constraint staff_users_display_name_bounds check (
    display_name is null or (char_length(display_name) between 1 and 80 and btrim(display_name) <> '' and display_name !~ '[\x01-\x1f\x7f]')
  ),
  -- To disable someone: set active = false and disabled_at = now() together.
  constraint staff_users_disabled_shape check (active = (disabled_at is null))
);

alter table public.staff_users enable row level security;
alter table public.staff_users force row level security;
revoke all on table public.staff_users from public, anon, authenticated, service_role;

-- Quote figures are whole minor units up to 100,000,000 (R96). 0002 already refuses negatives.
alter table public.orders drop constraint if exists orders_quote_amounts_upper_bound;
alter table public.orders add constraint orders_quote_amounts_upper_bound
  check ((subtotal_minor is null or subtotal_minor <= 100000000) and (freight_minor is null or freight_minor <= 100000000));

-- ---------------------------------------------------------------------------
-- is_active_staff
-- ---------------------------------------------------------------------------

create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.staff_users as staff
    where staff.user_id = auth.uid() and staff.active
  );
$fn$;

revoke all on function public.is_active_staff() from public, anon, authenticated, service_role;
grant execute on function public.is_active_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Staff reads under row level security (R95)
-- ---------------------------------------------------------------------------

drop policy if exists staff_users_read_own on public.staff_users;
create policy staff_users_read_own on public.staff_users
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists orders_staff_read on public.orders;
create policy orders_staff_read on public.orders
  for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items
  for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists order_events_staff_read on public.order_events;
create policy order_events_staff_read on public.order_events
  for select to authenticated
  using ((select public.is_active_staff()));

drop policy if exists order_email_outbox_staff_read on public.order_email_outbox;
create policy order_email_outbox_staff_read on public.order_email_outbox
  for select to authenticated
  using ((select public.is_active_staff()));

-- Column grants: a column not named here cannot be read even by active staff.
grant select (user_id, display_name, active) on public.staff_users to authenticated;
grant select (
  id, reference, status, status_changed_at, contact_name, email, phone, address_line1, address_line2,
  city, region, postal_code, country, notes, consent_version, consent_granted_at,
  tracking_token_expires_at, tracking_token_rotated_at, currency, subtotal_minor, freight_minor,
  payment_url, quote_sent_at, quote_revision, retain_until, created_at, updated_at
) on public.orders to authenticated;
grant select (id, order_id, line_number, sanity_id, title, sku, variant, pack, quantity, created_at)
  on public.order_items to authenticated;
grant select (id, order_id, actor, actor_user_id, event_type, old_status, new_status, metadata, created_at)
  on public.order_events to authenticated;
grant select (id, order_id, kind, quote_revision, status, attempts, last_attempt_at, next_attempt_at, last_error_code, created_at, updated_at)
  on public.order_email_outbox to authenticated;

-- ---------------------------------------------------------------------------
-- staff_save_order_quote (R96)
-- ---------------------------------------------------------------------------

create or replace function public.staff_save_order_quote(
  p_reference          text,
  p_expected_revision  integer,
  p_currency           text,
  p_subtotal_minor     integer,
  p_freight_minor      integer,
  p_payment_url        text
)
returns table (order_id uuid, quote_revision integer)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_reference  text := upper(btrim(coalesce(p_reference, '')));
  v_order      record;
  v_revision   integer;
begin
  if not public.is_active_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0
     or p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or p_subtotal_minor is null or p_subtotal_minor not between 0 and 100000000
     or p_freight_minor is null or p_freight_minor not between 0 and 100000000
     or p_payment_url is null or char_length(p_payment_url) > 2048
     or p_payment_url ~ '[[:space:][:cntrl:]]'
     -- https, then a lower-case DNS host (two or more labels, punycode allowed) and a path: no user
     -- info, no port, nothing but a host before the first slash.
     or p_payment_url !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+/'
     -- No IP address (an all-digit host).
     or p_payment_url ~ '^https://[0-9.]+/' then
    raise exception 'quote is invalid' using errcode = '22023';
  end if;

  select o.id, o.status, o.quote_revision into v_order
    from public.orders as o
   where o.reference = v_reference
   for update;
  if v_order.id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status not in ('new', 'confirmed') then
    raise exception 'order cannot be quoted' using errcode = '55000';
  end if;
  if v_order.quote_revision <> p_expected_revision then
    raise exception 'stale' using errcode = '40001';
  end if;

  v_revision := v_order.quote_revision + 1;
  update public.orders as o set
    currency       = p_currency,
    subtotal_minor = p_subtotal_minor,
    freight_minor  = p_freight_minor,
    payment_url    = p_payment_url,
    quote_revision = v_revision,
    updated_at     = now()
  where o.id = v_order.id;

  -- The figures, never the link (it may carry the payment provider's own session id).
  insert into public.order_events (order_id, actor, actor_user_id, event_type, metadata)
  values (v_order.id, 'staff', auth.uid(), 'quote_saved', pg_catalog.jsonb_build_object(
    'revision', v_revision, 'currency', p_currency, 'subtotal_minor', p_subtotal_minor, 'freight_minor', p_freight_minor
  ));

  return query select v_order.id, v_revision;
end;
$fn$;

revoke all on function public.staff_save_order_quote(text, integer, text, integer, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.staff_save_order_quote(text, integer, text, integer, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_queue_order_quote (R96): the explicit send of one saved revision
-- ---------------------------------------------------------------------------

create or replace function public.staff_queue_order_quote(
  p_reference  text,
  p_revision   integer
)
returns table (order_id uuid, quote_revision integer, already_queued boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_reference  text := upper(btrim(coalesce(p_reference, '')));
  v_order      record;
  v_email_id   uuid;
begin
  if not public.is_active_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 1 then
    raise exception 'quote is invalid' using errcode = '22023';
  end if;

  select o.id, o.status, o.quote_revision, o.currency, o.subtotal_minor, o.freight_minor, o.payment_url into v_order
    from public.orders as o
   where o.reference = v_reference
   for update;
  if v_order.id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status not in ('new', 'confirmed') then
    raise exception 'order cannot be quoted' using errcode = '55000';
  end if;
  if v_order.quote_revision = 0
     or v_order.currency is null or v_order.subtotal_minor is null or v_order.freight_minor is null or v_order.payment_url is null then
    raise exception 'no quote to send' using errcode = '55000';
  end if;
  if v_order.quote_revision <> p_revision then
    raise exception 'stale' using errcode = '40001';
  end if;

  -- One row per revision, whatever happened to an earlier send of it (R90 idempotency key).
  insert into public.order_email_outbox as outbox (order_id, kind, quote_revision)
  values (v_order.id, 'quote', p_revision)
  on conflict (idempotency_key) do nothing
  returning outbox.id into v_email_id;

  if v_email_id is null then
    return query select v_order.id, p_revision, true;
    return;
  end if;

  insert into public.order_events (order_id, actor, actor_user_id, event_type, metadata)
  values (v_order.id, 'staff', auth.uid(), 'quote_queued', pg_catalog.jsonb_build_object('revision', p_revision));

  return query select v_order.id, p_revision, false;
end;
$fn$;

revoke all on function public.staff_queue_order_quote(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.staff_queue_order_quote(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_advance_order_status (R98). The one-way flow mirrors lib/orders/constants.ts; the static
-- gate tests/admin/staff-migration-policy.test.ts fails if the two drift apart.
-- ---------------------------------------------------------------------------

create or replace function public.staff_advance_order_status(
  p_reference  text,
  p_from       text,
  p_to         text
)
returns table (order_id uuid, status text, status_changed_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_reference  text := upper(btrim(coalesce(p_reference, '')));
  v_order      record;
  v_changed_at timestamptz := now();
begin
  if not public.is_active_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or not (
       (p_from = 'new'        and p_to in ('confirmed', 'cancelled'))
    or (p_from = 'confirmed'  and p_to in ('paid', 'cancelled'))
    or (p_from = 'paid'       and p_to in ('dispatched', 'cancelled'))
    or (p_from = 'dispatched' and p_to in ('closed', 'cancelled'))
  ) then
    raise exception 'transition not allowed' using errcode = '22023';
  end if;

  select o.id, o.status into v_order
    from public.orders as o
   where o.reference = v_reference
   for update;
  if v_order.id is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order.status <> p_from then
    raise exception 'stale' using errcode = '40001';
  end if;

  update public.orders as o set status = p_to, status_changed_at = v_changed_at, updated_at = v_changed_at
   where o.id = v_order.id;

  insert into public.order_events (order_id, actor, actor_user_id, event_type, old_status, new_status)
  values (v_order.id, 'staff', auth.uid(), 'status_changed', p_from, p_to);

  return query select v_order.id, p_to, v_changed_at;
end;
$fn$;

revoke all on function public.staff_advance_order_status(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.staff_advance_order_status(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- staff_rotate_order_tracking_token: a new private link, shown to the staff member once
-- ---------------------------------------------------------------------------

create or replace function public.staff_rotate_order_tracking_token(p_reference text)
returns table (tracking_token text, tracking_token_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_reference   text := upper(btrim(coalesce(p_reference, '')));
  v_token       text;
  v_token_hash  text;
  v_expires_at  timestamptz;
  v_found       uuid;
begin
  if not public.is_active_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select issued.token, issued.token_hash, issued.expires_at
    into v_token, v_token_hash, v_expires_at
    from public.issue_order_tracking_token() as issued;

  -- The status time is left alone: a new link is not a change to the order.
  update public.orders as o set
    tracking_token_hash       = v_token_hash,
    tracking_token_expires_at = v_expires_at,
    tracking_token_rotated_at = now(),
    updated_at                = now()
  where o.reference = v_reference
  returning o.id into v_found;

  if v_found is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  insert into public.order_events (order_id, actor, actor_user_id, event_type, metadata)
  values (v_found, 'staff', auth.uid(), 'tracking_token_rotated', '{}'::jsonb);

  return query select v_token, v_expires_at;
end;
$fn$;

revoke all on function public.staff_rotate_order_tracking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.staff_rotate_order_tracking_token(text) to authenticated;

-- The same proof as 0004-0006, for the functions this migration adds: staff functions are
-- executable by `authenticated` alone (they check for active staff themselves), never by anon or
-- service_role, and the tables stay closed to anon and service_role.
do $verify$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.is_active_staff()',
    'public.staff_save_order_quote(text, integer, text, integer, integer, text)',
    'public.staff_queue_order_quote(text, integer)',
    'public.staff_advance_order_status(text, text, text)',
    'public.staff_rotate_order_tracking_token(text)'
  ] loop
    if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '% is executable by anon or service_role', v_fn using errcode = '42501';
    end if;
    if not pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '% is not executable by authenticated', v_fn using errcode = '42501';
    end if;
  end loop;
  if pg_catalog.has_column_privilege('authenticated', 'public.orders', 'tracking_token_hash', 'SELECT')
     or pg_catalog.has_column_privilege('authenticated', 'public.orders', 'submission_key', 'SELECT') then
    raise exception 'staff could read the tracking token hash or the submission key' using errcode = '42501';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.staff_users', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'public.staff_users', 'SELECT') then
    raise exception 'staff_users is readable by anon or service_role' using errcode = '42501';
  end if;
end;
$verify$;
