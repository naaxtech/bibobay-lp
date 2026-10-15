-- BIBO Bay migration 0002: orders, their lines, their audit trail and their email outbox.
-- Task 7a; spec §10 (manual checkout) steps 4-7 and §11 (data model and security).
--
-- Security model (the same as migration 0001; rulings R25-R27):
--   * Every table has row level security enabled AND forced, and no policies: deny by default.
--     Staff access (Task 8) adds narrow policies on top; nothing here grants it.
--   * No API role (anon, authenticated, service_role) holds any privilege on these tables. The only
--     way in is a narrow `security definer` RPC with bounded arguments and `set search_path = ''`,
--     executable by service_role alone, which the Next.js server calls with a server-only key.
--   * Internal helpers run with their caller's rights and are executable by nobody but their owner.
--     Supabase grants every new function to anon, authenticated and service_role DIRECTLY by
--     default privilege, so each revoke names those roles; revoking from PUBLIC alone is not enough.
--   * No price exists on a submitted order: staff quote later (Task 8 sets currency, subtotal,
--     freight and the payment link). No payment credential is ever stored.
--   * Adults only: contact and delivery details. No child data, no raw client address.
--
-- What one order request writes, in one transaction (submit_order):
--   orders (status new, consent version and time, a hashed private tracking token with an expiry,
--           and the submission key of the request that made it)
--   order_items (the canonical CMS snapshot of each product: Sanity id, title, SKU, variant, pack)
--   order_events (the audit trail: the customer submitted it)
--   order_email_outbox (the buyer acknowledgement and the staff alert, pending for the Task 8 worker)
-- If any part fails, none of it is kept.
--
-- One order per submission key (ruling R81). The order form makes a random key once per order
-- attempt and sends it again on every retry. A request whose answer was lost, sent again, finds the
-- first order instead of making a second one: submit_order answers with that order's id and
-- reference, writes nothing and queues no second email. It cannot hand out the first tracking token
-- again (only its hash exists), so a repeat answers without one.
--
-- The tracking token is issued here and returned to the server once. Only its SHA-256 hash is
-- stored, so a leaked table cannot be used to track anyone's order. Lookups are in migration 0003.
--
-- Tests: tests/orders/migration-policy.test.ts (static) and tests/orders/migration-database.test.ts
-- (runs every migration and supabase/tests/0002_orders_rls.sql in an embedded Postgres).

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0002 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
  -- Orders share migration 0001's rate limiter (ruling R79) and follow its conventions.
  if pg_catalog.to_regprocedure('public.consume_rate_limit(text, integer, integer)') is null then
    raise exception 'Migration 0001 must be applied before 0002 (the shared rate limiter is missing).'
      using errcode = '55000';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per order request. Every limit mirrors lib/orders/fields.ts (ORDER_LIMITS) and the status
-- list mirrors lib/orders/constants.ts (ORDER_STATUSES); tests/orders/migration-policy.test.ts
-- fails if they drift apart.
create table if not exists public.orders (
  id                          uuid primary key default gen_random_uuid(),
  -- Human-readable, safe to read aloud or put in a subject line. Not a secret: on its own it
  -- reveals nothing (the reference lookup also needs the order's email).
  reference                   text not null,
  -- The order form's random key for the request that made this order (R81); never shown to anyone.
  submission_key              uuid not null,
  status                      text not null default 'new',
  status_changed_at           timestamptz not null default now(),
  contact_name                text not null,
  email                       text not null,
  phone                       text,
  address_line1               text not null,
  address_line2               text,
  city                        text not null,
  region                      text,
  postal_code                 text,
  country                     text not null,
  notes                       text,
  consent_version             text not null,
  consent_granted_at          timestamptz not null default now(),
  -- The private tracking token, as a hash only (see order_tracking_token_hash).
  tracking_token_hash         text not null,
  tracking_token_expires_at   timestamptz not null,
  tracking_token_rotated_at   timestamptz,
  -- Set by staff when they quote (Task 8). Null until then: zero would read as free.
  currency                    text,
  subtotal_minor              integer,
  freight_minor               integer,
  payment_url                 text,
  quote_sent_at               timestamptz,
  -- Retention metadata (spec §11): when this order may be deleted or anonymised. Empty until the
  -- owner adopts a retention policy; nothing in this migration sets or acts on it.
  retain_until                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint orders_reference_key unique (reference),
  constraint orders_submission_key_key unique (submission_key),
  constraint orders_tracking_token_hash_key unique (tracking_token_hash),
  constraint orders_reference_shape check (reference ~ '^BB-[0-9A-F]{4}-[0-9A-F]{4}$'),
  constraint orders_status_values check (status in ('new', 'confirmed', 'paid', 'dispatched', 'closed', 'cancelled')),
  constraint orders_contact_name_bounds check (char_length(contact_name) between 1 and 120 and contact_name !~ '[\x01-\x1f\x7f]'),
  constraint orders_email_normalised check (email = lower(btrim(email))),
  constraint orders_email_shape check (char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint orders_phone_shape check (phone is null or (char_length(phone) between 6 and 32 and phone ~ '^[0-9+() .-]+$')),
  constraint orders_address_line1_bounds check (char_length(address_line1) between 1 and 200 and address_line1 !~ '[\x01-\x1f\x7f]'),
  constraint orders_address_line2_bounds check (address_line2 is null or (char_length(address_line2) between 1 and 200 and address_line2 !~ '[\x01-\x1f\x7f]')),
  constraint orders_city_bounds check (char_length(city) between 1 and 100 and city !~ '[\x01-\x1f\x7f]'),
  constraint orders_region_bounds check (region is null or (char_length(region) between 1 and 100 and region !~ '[\x01-\x1f\x7f]')),
  constraint orders_postal_code_shape check (postal_code is null or (char_length(postal_code) between 1 and 16 and postal_code ~ '^[A-Za-z0-9][A-Za-z0-9 -]*$')),
  constraint orders_country_shape check (country ~ '^[A-Z]{2}$'),
  -- Notes may hold line breaks and tabs, nothing else below a space.
  constraint orders_notes_bounds check (notes is null or (char_length(notes) between 1 and 1000 and notes !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')),
  constraint orders_consent_version_bounds check (char_length(consent_version) between 1 and 40),
  constraint orders_tracking_token_hash_shape check (tracking_token_hash ~ '^[0-9a-f]{64}$'),
  constraint orders_currency_shape check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint orders_subtotal_bounds check (subtotal_minor is null or subtotal_minor >= 0),
  constraint orders_freight_bounds check (freight_minor is null or freight_minor >= 0),
  constraint orders_payment_url_shape check (payment_url is null or (char_length(payment_url) between 9 and 2048 and payment_url ~ '^https://'))
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_email_idx on public.orders (email);

-- The canonical CMS snapshot of each product at the moment of ordering. Snapshotted, not
-- referenced: a later edit in the CMS must never rewrite what someone ordered.
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  line_number  smallint not null,
  sanity_id    text not null,
  title        text not null,
  sku          text,
  variant      text,
  pack         text,
  quantity     integer not null,
  created_at   timestamptz not null default now(),
  constraint order_items_order_line_key unique (order_id, line_number),
  constraint order_items_order_product_key unique (order_id, sanity_id),
  constraint order_items_line_number_bounds check (line_number between 1 and 40),
  -- A published Sanity document id (lib/orders/pad.ts): never a draft or a release version.
  constraint order_items_sanity_id_shape check (sanity_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' and sanity_id !~ '^(drafts|versions)\.'),
  constraint order_items_title_bounds check (char_length(title) between 1 and 200 and btrim(title) <> '' and title !~ '[\x01-\x1f\x7f]'),
  constraint order_items_sku_bounds check (sku is null or (char_length(sku) between 1 and 64 and sku !~ '[\x01-\x1f\x7f]')),
  constraint order_items_variant_bounds check (variant is null or (char_length(variant) between 1 and 120 and variant !~ '[\x01-\x1f\x7f]')),
  constraint order_items_pack_bounds check (pack is null or (char_length(pack) between 1 and 120 and pack !~ '[\x01-\x1f\x7f]')),
  constraint order_items_quantity_bounds check (quantity between 1 and 999)
);

-- The audit trail (spec §11): who did what to an order, and which status it moved between.
create table if not exists public.order_events (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  actor          text not null,
  -- The staff member's auth user id, for staff actions (Task 8).
  actor_user_id  uuid,
  event_type     text not null,
  old_status     text,
  new_status     text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint order_events_actor_values check (actor in ('customer', 'staff', 'system')),
  constraint order_events_event_type_shape check (event_type ~ '^[a-z][a-z_]{0,59}$'),
  constraint order_events_old_status_values check (old_status is null or old_status in ('new', 'confirmed', 'paid', 'dispatched', 'closed', 'cancelled')),
  constraint order_events_new_status_values check (new_status is null or new_status in ('new', 'confirmed', 'paid', 'dispatched', 'closed', 'cancelled')),
  constraint order_events_metadata_object check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096)
);

create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- The order email outbox, shaped like lead_delivery_events (migration 0001). One row per order and
-- message kind, so a repeated call can never queue a second message. The Task 8 worker claims
-- rows whose status is pending or failed (or sending for too long) and whose next_attempt_at has
-- passed, sends them, and records the outcome. Messages never carry a price at this stage.
create table if not exists public.order_email_outbox (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,
  kind                 text not null,
  status               text not null default 'pending',
  attempts             integer not null default 0,
  last_attempt_at      timestamptz,
  next_attempt_at      timestamptz not null default now(),
  provider_message_id  text,
  last_error_code      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint order_email_outbox_order_kind_key unique (order_id, kind),
  constraint order_email_outbox_kind_values check (kind in ('acknowledgement', 'staff_alert')),
  constraint order_email_outbox_status_values check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint order_email_outbox_attempts_bounds check (attempts between 0 and 1000),
  constraint order_email_outbox_provider_id_bounds check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  constraint order_email_outbox_error_code_shape check (last_error_code is null or last_error_code ~ '^[A-Za-z0-9_]{1,60}$')
);

create index if not exists order_email_outbox_due_idx
  on public.order_email_outbox (next_attempt_at)
  where status in ('pending', 'sending', 'failed');

-- ---------------------------------------------------------------------------
-- Row level security and table privileges: deny everything to every API role
-- ---------------------------------------------------------------------------

alter table public.orders             enable row level security;
alter table public.order_items        enable row level security;
alter table public.order_events       enable row level security;
alter table public.order_email_outbox enable row level security;

alter table public.orders             force row level security;
alter table public.order_items        force row level security;
alter table public.order_events       force row level security;
alter table public.order_email_outbox force row level security;

revoke all on table public.orders             from public, anon, authenticated, service_role;
revoke all on table public.order_items        from public, anon, authenticated, service_role;
revoke all on table public.order_events       from public, anon, authenticated, service_role;
revoke all on table public.order_email_outbox from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal: the tracking token's stored form, and a fresh token with its expiry.
-- Invoker rights, executable by their owner only; the definer RPCs call them.
-- ---------------------------------------------------------------------------

create or replace function public.order_tracking_token_hash(p_token text)
returns text
language sql
stable
strict
set search_path = ''
as $fn$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex');
$fn$;

revoke all on function public.order_tracking_token_hash(text) from public, anon, authenticated, service_role;

-- 64 hex digits from two random UUIDs (244 random bits). Tokens expire after 180 days; staff or the
-- Task 8 worker issue a fresh one with rotate_order_tracking_token (migration 0005).
create or replace function public.issue_order_tracking_token(out token text, out token_hash text, out expires_at timestamptz)
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
  token_hash := public.order_tracking_token_hash(token);
  expires_at := pg_catalog.now() + interval '180 days';
end;
$fn$;

revoke all on function public.issue_order_tracking_token() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- submit_order: store one order request, atomically. Returns its id and reference, the private
-- tracking token (the only time it exists outside a hash) and whether the acknowledgement is queued.
-- A repeated submission key (R81) returns the first order's id and reference with no token, nothing
-- queued and `duplicate` true; the same key with another email is refused.
-- ---------------------------------------------------------------------------
--
-- Every column a buyer must not control is set here, never passed in: status, prices, the payment
-- link, the token and every timestamp. The lines arrive as a JSON array of the server's canonical
-- snapshots (lib/orders/catalogue.ts); each key is checked, so no extra column can be smuggled in.
-- Error messages never repeat the submitted values.

create or replace function public.submit_order(
  p_contact_name     text,
  p_email            text,
  p_address_line1    text,
  p_city             text,
  p_country          text,
  p_consent          boolean,
  p_consent_version  text,
  p_lines            jsonb,
  p_submission_key   uuid,
  p_phone            text default null,
  p_address_line2    text default null,
  p_region           text default null,
  p_postal_code      text default null,
  p_notes            text default null
)
returns table (order_id uuid, reference text, tracking_token text, tracking_token_expires_at timestamptz, acknowledgement_queued boolean, duplicate boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_contact_name  text := btrim(coalesce(p_contact_name, ''));
  v_email         text := lower(btrim(coalesce(p_email, '')));
  v_phone         text := nullif(btrim(coalesce(p_phone, '')), '');
  v_line1         text := btrim(coalesce(p_address_line1, ''));
  v_line2         text := nullif(btrim(coalesce(p_address_line2, '')), '');
  v_city          text := btrim(coalesce(p_city, ''));
  v_region        text := nullif(btrim(coalesce(p_region, '')), '');
  v_postal_code   text := nullif(btrim(coalesce(p_postal_code, '')), '');
  v_country       text := upper(btrim(coalesce(p_country, '')));
  v_notes         text := nullif(btrim(coalesce(p_notes, '')), '');
  v_version       text := btrim(coalesce(p_consent_version, ''));
  v_count         integer;
  v_reference     text;
  v_attempt       integer := 0;
  v_order_id      uuid;
  v_token         text;
  v_token_hash    text;
  v_expires_at    timestamptz;
  v_ack_queued    boolean;
  v_first_id      uuid;
  v_first_ref     text;
  v_first_email   text;
begin
  if p_consent is distinct from true then
    raise exception 'consent is required' using errcode = '22023';
  end if;
  if p_submission_key is null then
    raise exception 'submission key is required' using errcode = '22023';
  end if;
  if char_length(v_version) not between 1 and 40 then
    raise exception 'consent version is invalid' using errcode = '22023';
  end if;
  if char_length(v_contact_name) not between 1 and 120 or v_contact_name ~ '[\x01-\x1f\x7f]' then
    raise exception 'contact name is invalid' using errcode = '22023';
  end if;
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email is invalid' using errcode = '22023';
  end if;
  if v_phone is not null and (char_length(v_phone) not between 6 and 32 or v_phone !~ '^[0-9+() .-]+$') then
    raise exception 'phone is invalid' using errcode = '22023';
  end if;
  if char_length(v_line1) not between 1 and 200 or v_line1 ~ '[\x01-\x1f\x7f]'
     or (v_line2 is not null and (char_length(v_line2) > 200 or v_line2 ~ '[\x01-\x1f\x7f]'))
     or char_length(v_city) not between 1 and 100 or v_city ~ '[\x01-\x1f\x7f]'
     or (v_region is not null and (char_length(v_region) > 100 or v_region ~ '[\x01-\x1f\x7f]'))
     or (v_postal_code is not null and (char_length(v_postal_code) > 16 or v_postal_code !~ '^[A-Za-z0-9][A-Za-z0-9 -]*$'))
     or v_country !~ '^[A-Z]{2}$' then
    raise exception 'address is invalid' using errcode = '22023';
  end if;
  if v_notes is not null and (char_length(v_notes) > 1000 or v_notes ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]') then
    raise exception 'notes are invalid' using errcode = '22023';
  end if;

  -- Lines: 1 to 40 canonical snapshots, one per product, whole quantities from 1 to 999
  -- (lib/orders/constants.ts ORDER_PAD_MAX_LINES and ORDER_PAD_MAX_QUANTITY).
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'order lines are invalid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count not between 1 and 40 then
    raise exception 'order lines are invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) as line(value)
    where jsonb_typeof(line.value) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(line.value) as line_key(name)
         where line_key.name not in ('sanity_id', 'title', 'sku', 'variant', 'pack', 'quantity')
       )
       or coalesce(jsonb_typeof(line.value -> 'sanity_id'), 'missing') <> 'string'
       or (line.value ->> 'sanity_id') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
       or (line.value ->> 'sanity_id') ~ '^(drafts|versions)\.'
       or coalesce(jsonb_typeof(line.value -> 'title'), 'missing') <> 'string'
       or char_length(line.value ->> 'title') not between 1 and 200
       or btrim(line.value ->> 'title') = ''
       or (line.value ->> 'title') ~ '[\x01-\x1f\x7f]'
       or coalesce(jsonb_typeof(line.value -> 'sku'), 'null') not in ('string', 'null')
       or (jsonb_typeof(line.value -> 'sku') = 'string' and (char_length(line.value ->> 'sku') not between 1 and 64 or (line.value ->> 'sku') ~ '[\x01-\x1f\x7f]'))
       or coalesce(jsonb_typeof(line.value -> 'variant'), 'null') not in ('string', 'null')
       or (jsonb_typeof(line.value -> 'variant') = 'string' and (char_length(line.value ->> 'variant') not between 1 and 120 or (line.value ->> 'variant') ~ '[\x01-\x1f\x7f]'))
       or coalesce(jsonb_typeof(line.value -> 'pack'), 'null') not in ('string', 'null')
       or (jsonb_typeof(line.value -> 'pack') = 'string' and (char_length(line.value ->> 'pack') not between 1 and 120 or (line.value ->> 'pack') ~ '[\x01-\x1f\x7f]'))
       or coalesce(jsonb_typeof(line.value -> 'quantity'), 'missing') <> 'number'
       or (line.value ->> 'quantity') !~ '^[1-9][0-9]{0,2}$'
  ) then
    raise exception 'order lines are invalid' using errcode = '22023';
  end if;
  if (select count(distinct line.value ->> 'sanity_id') from jsonb_array_elements(p_lines) as line(value)) <> v_count then
    raise exception 'order lines are invalid' using errcode = '22023';
  end if;

  -- A fresh reference: BB- and 32 random bits as two groups of four hex digits.
  loop
    v_attempt := v_attempt + 1;
    v_reference := 'BB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4))
                   || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    exit when not exists (select 1 from public.orders as existing where existing.reference = v_reference);
    if v_attempt >= 10 then
      raise exception 'no free order reference' using errcode = '55000';
    end if;
  end loop;

  select issued.token, issued.token_hash, issued.expires_at
    into v_token, v_token_hash, v_expires_at
    from public.issue_order_tracking_token() as issued;

  -- R81: a key already used (even by a request still committing) yields to the first order.
  insert into public.orders as o (
    reference, submission_key, contact_name, email, phone, address_line1, address_line2, city, region,
    postal_code, country, notes, consent_version, consent_granted_at, tracking_token_hash, tracking_token_expires_at
  )
  values (
    v_reference, p_submission_key, v_contact_name, v_email, v_phone, v_line1, v_line2, v_city, v_region,
    v_postal_code, v_country, v_notes, v_version, now(), v_token_hash, v_expires_at
  )
  on conflict (submission_key) do nothing
  returning o.id into v_order_id;

  if v_order_id is null then
    select first_order.id, first_order.reference, first_order.email
      into v_first_id, v_first_ref, v_first_email
      from public.orders as first_order
     where first_order.submission_key = p_submission_key;
    -- The same request again: the same normalised email. Anything else is not a retry, and the
    -- refusal names neither the order nor its email.
    if v_first_email is distinct from v_email then
      raise exception 'submission key already used' using errcode = '23505';
    end if;
    -- No new row anywhere, no outbox row, no token: the first order's token exists only as a hash.
    return query select v_first_id, v_first_ref, null::text, null::timestamptz, false, true;
    return;
  end if;

  insert into public.order_items (order_id, line_number, sanity_id, title, sku, variant, pack, quantity)
  select v_order_id, line.line_no::smallint, line.value ->> 'sanity_id', line.value ->> 'title',
         line.value ->> 'sku', line.value ->> 'variant', line.value ->> 'pack', (line.value ->> 'quantity')::integer
  from jsonb_array_elements(p_lines) with ordinality as line(value, line_no);

  insert into public.order_events (order_id, actor, event_type, old_status, new_status, metadata)
  values (v_order_id, 'customer', 'order_submitted', null, 'new', jsonb_build_object('lines', v_count));

  -- Both messages wait for the Task 8 worker; nothing is sent from this transaction.
  insert into public.order_email_outbox (order_id, kind)
  values (v_order_id, 'acknowledgement'), (v_order_id, 'staff_alert');

  v_ack_queued := exists (
    select 1 from public.order_email_outbox as queued
    where queued.order_id = v_order_id and queued.kind = 'acknowledgement'
  );

  return query select v_order_id, v_reference, v_token, v_expires_at, v_ack_queued, false;
end;
$fn$;

revoke all on function public.submit_order(text, text, text, text, text, boolean, text, jsonb, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_order(text, text, text, text, text, boolean, text, jsonb, uuid, text, text, text, text, text) to service_role;
