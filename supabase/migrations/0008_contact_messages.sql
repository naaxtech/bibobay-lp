-- BIBO Bay migration 0008: the contact form's messages and their own outbox (rulings R191,
-- R201-R207).
--
-- What this adds:
--
--   * contact_messages: one row per message a grown-up writes through the contact form (/contact):
--     a name, an email address (trimmed and lower-cased, as for a signup), a topic from a fixed
--     list, the message, and when it arrived. No raw client address is stored (the rate limit is
--     keyed by the server's HMAC, as for signups and orders), no user agent, and no child data.
--   * contact_message_deliveries: the contact outbox (R201), a table of its own, not a kind of the
--     signup outbox. It mirrors the outboxes of 0001 and 0006 column for column: attempts,
--     next_attempt_at with the same capped backoff, the claimed_at / `sending` lease,
--     unconfirmed_since, and the final-failure codes. One rule differs (R211): an unconfirmed alert
--     is retried until the attempt cap, never parked outside the provider's 23-hour idempotency
--     window; unconfirmed_since still records that it may have reached staff twice. Its one kind is
--     the staff alert (`contact_staff_alert`), one per message
--     (unique (message_id, kind)); the row id is its idempotency key (`contact-delivery/<id>`,
--     lib/outbox/contact.ts). There is no `skipped` status (R207): a contact message cannot be
--     withdrawn, so nothing ever refuses its alert, and the claim always answers "skipped": 0.
--   * submit_contact_message: stores the message AND queues its alert in one transaction, so the
--     API never answers `persisted` for a message nobody will be told about.
--   * claim_contact_deliveries and record_contact_delivery_attempt: the contact outbox's claim and
--     record functions, with the same due rule, lease, backoff and deferral as 0006's claim and
--     record functions for the signup outbox, and parking at the attempt cap only (R211). The
--     claim takes no kinds array (the table
--     holds one kind) and names one message or none (the cron worker). Each claimed entry:
--       {id, kind, attempt, name, email, topic, message, receivedAt}
--
-- Nothing here touches the signup outbox, the signup table, their constraints or their functions
-- (R201). The record function calls 0006's outbox_failure_unconfirmed, which stays executable by
-- its owner only.
--
-- Security model (the same as 0001-0007): both tables have row level security enabled AND forced,
-- no policies, and no privilege for any API role (anon, authenticated, service_role). The only way
-- in is the three `security definer` functions with `set search_path = ''`, executable by
-- service_role only. Errors use 22023 and name the field, never the value.
--
-- Every statement is idempotent: the harness applies every migration twice.
--
-- Tests: tests/contact/migration-policy.test.ts (static) and tests/orders/migration-database.test.ts
-- (runs every migration and supabase/tests/0007_contact_messages.sql in an embedded Postgres).

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0008 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
  if pg_catalog.to_regprocedure('public.outbox_failure_unconfirmed(text)') is null
     or pg_catalog.to_regprocedure('public.is_active_staff()') is null then
    raise exception 'Migrations 0001 to 0007 must be applied before 0008.' using errcode = '55000';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The bounds mirror lib/contact/fields.ts CONTACT_LIMITS and CONTACT_TOPICS (pinned by the static
-- gate). Lengths are char_length, which counts characters (code points) as the form does.
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  topic       text not null,
  message     text not null,
  created_at  timestamptz not null default now(),
  constraint contact_messages_name_bounds check (char_length(name) between 1 and 80 and name !~ '[<>\x01-\x1f\x7f]'),
  constraint contact_messages_email_normalised check (email = lower(btrim(email))),
  constraint contact_messages_email_shape check (char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint contact_messages_topic_values check (topic in ('general', 'partnerships', 'press', 'shop-order', 'privacy')),
  -- Line breaks (LF) and tabs only; the server turns CRLF and CR into LF before it calls the RPC.
  constraint contact_messages_message_bounds check (char_length(message) between 10 and 3000 and message !~ '[\x01-\x08\x0b-\x1f\x7f]')
);

-- Staff read messages newest first, by SQL, while there is no inbox page (R200).
create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);

-- The contact outbox (R201). 'infinity' in next_attempt_at is the parked marker, as in 0006.
create table if not exists public.contact_message_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  message_id           uuid not null references public.contact_messages (id) on delete cascade,
  kind                 text not null,
  status               text not null default 'pending',
  attempts             integer not null default 0,
  last_attempt_at      timestamptz,
  next_attempt_at      timestamptz not null default now(),
  provider_message_id  text,
  last_error_code      text,
  -- When a send became unconfirmed (it may have reached the provider; R91).
  unconfirmed_since    timestamptz,
  -- When the current holder claimed the row; cleared when the outcome is recorded or handed back.
  claimed_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- One alert per message. Its index also serves the foreign key (message_id leads).
  constraint contact_message_deliveries_message_kind_key unique (message_id, kind),
  constraint contact_message_deliveries_kind_values check (kind in ('contact_staff_alert')),
  constraint contact_message_deliveries_status_values check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint contact_message_deliveries_attempts_bounds check (attempts between 0 and 1000),
  constraint contact_message_deliveries_provider_id_bounds check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  constraint contact_message_deliveries_error_code_shape check (last_error_code is null or last_error_code ~ '^[A-Za-z0-9_]{1,60}$')
);

create index if not exists contact_message_deliveries_due_idx
  on public.contact_message_deliveries (next_attempt_at)
  where status in ('pending', 'sending', 'failed');

-- ---------------------------------------------------------------------------
-- Row level security and table privileges: deny everything to every API role
-- ---------------------------------------------------------------------------

alter table public.contact_messages           enable row level security;
alter table public.contact_message_deliveries enable row level security;

-- Forced, so even the table owner is subject to RLS unless it holds BYPASSRLS.
alter table public.contact_messages           force row level security;
alter table public.contact_message_deliveries force row level security;

-- Supabase grants new public tables to anon, authenticated and service_role by default; take all of
-- it back. service_role bypasses RLS, so without this revoke it could read every message directly.
revoke all on table public.contact_messages           from public, anon, authenticated, service_role;
revoke all on table public.contact_message_deliveries from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- submit_contact_message: store one message and queue its one staff alert, in one transaction.
-- Returns only the two ids.
-- ---------------------------------------------------------------------------

create or replace function public.submit_contact_message(
  p_name     text,
  p_email    text,
  p_topic    text,
  p_message  text
)
returns table (message_id uuid, delivery_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_name         text := btrim(p_name);
  v_email        text := lower(btrim(p_email));
  v_message_id   uuid;
  v_delivery_id  uuid;
begin
  -- Error messages never repeat the submitted values.
  if v_name is null or char_length(v_name) not between 1 and 80 or v_name ~ '[<>\x01-\x1f\x7f]' then
    raise exception 'name is invalid' using errcode = '22023';
  end if;
  if v_email is null or char_length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email is invalid' using errcode = '22023';
  end if;
  if p_topic is null or p_topic not in ('general', 'partnerships', 'press', 'shop-order', 'privacy') then
    raise exception 'topic is invalid' using errcode = '22023';
  end if;
  -- The message is checked as given: the server sends it normalised (lib/contact/fields.ts).
  if p_message is null or char_length(p_message) not between 10 and 3000 or p_message ~ '[\x01-\x08\x0b-\x1f\x7f]' then
    raise exception 'message is invalid' using errcode = '22023';
  end if;

  insert into public.contact_messages as msg (name, email, topic, message)
  values (v_name, v_email, p_topic, p_message)
  returning msg.id into v_message_id;

  insert into public.contact_message_deliveries as delivery (message_id, kind, status, attempts)
  values (v_message_id, 'contact_staff_alert', 'pending', 0)
  returning delivery.id into v_delivery_id;

  return query select v_message_id, v_delivery_id;
end;
$fn$;

revoke all on function public.submit_contact_message(text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- claim_contact_deliveries: claim up to p_limit (1-50) due contact alerts, optionally of one
-- message. The due rule and the 15-minute stale lease are 0006's; the parking rule is not (R211):
--   * due: `pending` or `failed` with next_attempt_at reached, or `sending` for over 15 minutes;
--   * parked (failed, next_attempt_at 'infinity', reported as expired): out of attempts only. An
--     unconfirmed send is NOT parked outside the provider's 23-hour idempotency window, as the
--     signup and order outboxes park theirs: with a once-a-day worker that would lose the alert of a
--     stored message, while a retry can at worst alert staff twice;
--   * otherwise claimed: `sending`, the attempt counted, claimed_at now.
-- Nothing is ever skipped (R207).
-- ---------------------------------------------------------------------------

create or replace function public.claim_contact_deliveries(
  p_limit       integer default 10,
  p_message_id  uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_claimed  jsonb := '[]'::jsonb;
  v_expired  integer := 0;
  r          record;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'claim limit is invalid' using errcode = '22023';
  end if;

  for r in
    select delivery.id, delivery.kind, delivery.status, delivery.attempts, coalesce(delivery.claimed_at, delivery.last_attempt_at) as claimed_at, delivery.unconfirmed_since,
           msg.name, msg.email, msg.topic, msg.message, msg.created_at as received_at
      from public.contact_message_deliveries as delivery
      join public.contact_messages as msg on msg.id = delivery.message_id
     where (p_message_id is null or delivery.message_id = p_message_id)
       and (
         (delivery.status in ('pending', 'failed') and delivery.next_attempt_at <= now())
         or (delivery.status = 'sending' and coalesce(delivery.claimed_at, delivery.last_attempt_at) <= now() - interval '15 minutes')
       )
     order by delivery.next_attempt_at, delivery.created_at, delivery.id
     limit p_limit
     for update of delivery skip locked
  loop
    if r.attempts >= 8 then
      -- R211: only the attempt cap parks a contact alert. An unconfirmed send is retried at any age,
      -- under the same key; once the provider has forgotten the key a retry is a new send, and a
      -- duplicate staff alert is accepted where a lost one is not. A lost eighth attempt (a stale
      -- `sending` row) is parked as `stale_unconfirmed`.
      update public.contact_message_deliveries as delivery
         set status = 'failed',
             last_error_code = case when r.status = 'sending' then 'stale_unconfirmed' else delivery.last_error_code end,
             unconfirmed_since = case when r.status = 'sending' then coalesce(r.unconfirmed_since, r.claimed_at) else delivery.unconfirmed_since end,
             next_attempt_at = 'infinity',
             last_attempt_at = case when r.status = 'sending' then r.claimed_at else delivery.last_attempt_at end,
             claimed_at = null,
             updated_at = now()
       where delivery.id = r.id;
      v_expired := v_expired + 1;
    else
      update public.contact_message_deliveries as delivery
         set status = 'sending',
             attempts = delivery.attempts + 1,
             -- A stuck send was a real attempt: it keeps its time until this one is recorded.
             last_attempt_at = case when r.status = 'sending' then r.claimed_at else delivery.last_attempt_at end,
             claimed_at = now(),
             -- A stuck send may have gone out: unconfirmed from when it was claimed.
             unconfirmed_since = case when r.status = 'sending' then coalesce(r.unconfirmed_since, r.claimed_at) else delivery.unconfirmed_since end,
             updated_at = now()
       where delivery.id = r.id;
      v_claimed := v_claimed || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'attempt', r.attempts + 1,
        'name', r.name,
        'email', r.email,
        'topic', r.topic,
        'message', r.message,
        'receivedAt', r.received_at
      ));
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('claimed', v_claimed, 'skipped', 0, 'expired', v_expired);
end;
$fn$;

revoke all on function public.claim_contact_deliveries(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_contact_deliveries(integer, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- record_contact_delivery_attempt: record the outcome of a claimed (`sending`) contact alert, with
-- 0006's statuses and rules:
--   sent      the provider accepted it; its message id is kept.
--   failed    a short error code (never a provider message); next attempt with exponential backoff
--             (2^attempts minutes, at most six hours), or never after the eighth attempt or an
--             idempotency conflict. An unconfirmed failure sets unconfirmed_since (R91), which
--             here marks a possible duplicate and parks nothing (R211).
--   deferred  no attempt was made (the send budget was spent): the claim is handed back, so the
--             row returns to its earlier status and attempt count and stays due.
-- Returns false when the row was not `sending` (already recorded, parked, or never claimed).
-- ---------------------------------------------------------------------------

create or replace function public.record_contact_delivery_attempt(
  p_delivery_id          uuid,
  p_status               text,
  p_provider_message_id  text default null,
  p_error_code           text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if p_status is null or p_status not in ('sent', 'failed', 'deferred') then
    raise exception 'delivery status is invalid' using errcode = '22023';
  end if;
  if p_status = 'sent' and (p_provider_message_id is null or char_length(p_provider_message_id) not between 1 and 200) then
    raise exception 'provider message id is invalid' using errcode = '22023';
  end if;
  if p_status = 'failed' and (p_error_code is null or p_error_code !~ '^[A-Za-z0-9_]{1,60}$') then
    raise exception 'error code is invalid' using errcode = '22023';
  end if;

  update public.contact_message_deliveries as delivery set
    status              = case
                            when p_status <> 'deferred' then p_status
                            when delivery.attempts <= 1 then 'pending'
                            else 'failed'
                          end,
    attempts            = case when p_status = 'deferred' then greatest(delivery.attempts - 1, 0) else delivery.attempts end,
    provider_message_id = case when p_status = 'sent' then p_provider_message_id else delivery.provider_message_id end,
    last_error_code     = case p_status when 'sent' then null when 'failed' then p_error_code else delivery.last_error_code end,
    last_attempt_at     = case when p_status = 'deferred' then delivery.last_attempt_at else coalesce(delivery.claimed_at, now()) end,
    claimed_at          = null,
    unconfirmed_since   = case
                            when p_status = 'failed' and public.outbox_failure_unconfirmed(p_error_code)
                              then coalesce(delivery.unconfirmed_since, delivery.claimed_at, now())
                            else delivery.unconfirmed_since
                          end,
    next_attempt_at     = case
                            when p_status = 'failed' and (delivery.attempts >= 8 or p_error_code = 'invalid_idempotent_request')
                              then 'infinity'::timestamptz
                            when p_status = 'failed'
                              then now() + least(interval '6 hours', interval '1 minute' * power(2, least(delivery.attempts, 12)))
                            else delivery.next_attempt_at
                          end,
    updated_at          = now()
  where delivery.id = p_delivery_id and delivery.status = 'sending';

  return found;
end;
$fn$;

revoke all on function public.record_contact_delivery_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_contact_delivery_attempt(uuid, text, text, text) to service_role;

-- The same proof as 0004-0007, for the objects this migration adds: the functions are executable by
-- service_role alone, and the tables stay closed to every API role and forced under RLS.
do $verify$
declare
  v_fn     text;
  v_table  text;
begin
  foreach v_fn in array array[
    'public.submit_contact_message(text, text, text, text)',
    'public.claim_contact_deliveries(integer, uuid)',
    'public.record_contact_delivery_attempt(uuid, text, text, text)'
  ] loop
    if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '% is executable by an anonymous or signed-in role', v_fn using errcode = '42501';
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '% is not executable by service_role', v_fn using errcode = '42501';
    end if;
  end loop;
  foreach v_table in array array['public.contact_messages', 'public.contact_message_deliveries'] loop
    if pg_catalog.has_table_privilege('anon', v_table, 'SELECT, INSERT, UPDATE, DELETE')
       or pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT, INSERT, UPDATE, DELETE')
       or pg_catalog.has_table_privilege('service_role', v_table, 'SELECT, INSERT, UPDATE, DELETE') then
      raise exception '% is reachable by an API role', v_table using errcode = '42501';
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class as c
      where c.oid = pg_catalog.to_regclass(v_table) and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception '% does not force row level security', v_table using errcode = '42501';
    end if;
  end loop;
end;
$verify$;
