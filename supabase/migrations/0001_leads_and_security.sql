-- BIBO Bay migration 0001: founding-family leads, the email outbox and the shared rate limit.
--
-- Security model (spec §3 ruling 10, §11; Task 5 rulings R3, R25-R27):
--   * Every table has row level security enabled AND forced, and no policies: deny by default.
--   * No API role (anon, authenticated, service_role) holds any privilege on these tables. The only
--     way in is a narrow `security definer` RPC with bounded arguments and `set search_path = ''`.
--   * The RPCs are executable by service_role only, which the Next.js server uses with a server-only
--     key. The browser never talks to Supabase for leads, so anon needs nothing at all.
--   * Internal helpers (retention) are executable by nobody but their owner.
--   * No raw client address is stored anywhere. The rate-limit key is an HMAC computed by the
--     server (lib/leads/http.ts) and is never joined to a lead row.
--   * No child data: an adult's email and optional first name, and an optional broad age band.
--
-- The `security definer` functions run as the migration owner and must write to forced-RLS tables
-- that have no policies. That only works when the owner bypasses RLS, as Supabase's `postgres`
-- role does; the guard below stops the migration instead of leaving every RPC failing at runtime.
--
-- Tests: tests/leads/migration-policy.test.ts (static) and tests/leads/migration-database.test.ts
-- (runs this file and supabase/tests/0001_leads_rls.sql in an embedded Postgres). Task 11 runs the
-- pgTAP file against the real project with `supabase test db`.

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0001 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per adult, keyed by the normalised (trimmed, lower-case) email.
create table if not exists public.lead_submissions (
  id                      uuid primary key default gen_random_uuid(),
  email                   text not null,
  first_name              text,
  age_band                text,
  consent_state           text not null default 'granted',
  consent_version         text not null,
  consent_granted_at      timestamptz not null default now(),
  consent_withdrawn_at    timestamptz,
  source                  text not null default 'landing',
  locale                  text,
  utm                     jsonb not null default '{}'::jsonb,
  -- Mirror of the acknowledgement's outbox status, for staff views and support.
  acknowledgement_status  text not null default 'not_queued',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint lead_submissions_email_key unique (email),
  constraint lead_submissions_email_normalised check (email = lower(btrim(email))),
  constraint lead_submissions_email_shape check (char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint lead_submissions_first_name_bounds check (first_name is null or (char_length(first_name) between 1 and 80 and first_name !~ '[<>]')),
  constraint lead_submissions_age_band_values check (age_band is null or age_band in ('under-3', '3-5', '6-8', '9-12', 'prefer-not-to-say')),
  constraint lead_submissions_consent_state_values check (consent_state in ('granted', 'withdrawn')),
  constraint lead_submissions_consent_version_bounds check (char_length(consent_version) between 1 and 40),
  constraint lead_submissions_source_shape check (source ~ '^[a-z0-9-]{1,40}$'),
  constraint lead_submissions_locale_shape check (locale is null or (char_length(locale) <= 35 and locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$')),
  constraint lead_submissions_utm_object check (jsonb_typeof(utm) = 'object' and pg_column_size(utm) <= 2048),
  constraint lead_submissions_acknowledgement_status_values check (acknowledgement_status in ('not_queued', 'pending', 'sending', 'sent', 'failed'))
);

create index if not exists lead_submissions_created_at_idx on public.lead_submissions (created_at desc);

-- The email outbox. One row per lead and message kind: a repeat signup never queues a second email,
-- so the form cannot be used to flood someone else's inbox. The retry worker (Task 8) claims rows
-- whose status is pending or failed (or sending for too long) and whose next_attempt_at has passed.
create table if not exists public.lead_delivery_events (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references public.lead_submissions (id) on delete cascade,
  kind                 text not null,
  status               text not null default 'pending',
  attempts             integer not null default 0,
  last_attempt_at      timestamptz,
  next_attempt_at      timestamptz not null default now(),
  provider_message_id  text,
  last_error_code      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint lead_delivery_events_lead_kind_key unique (lead_id, kind),
  constraint lead_delivery_events_kind_values check (kind in ('acknowledgement', 'staff_alert')),
  constraint lead_delivery_events_status_values check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint lead_delivery_events_attempts_bounds check (attempts between 0 and 1000),
  constraint lead_delivery_events_provider_id_bounds check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  constraint lead_delivery_events_error_code_shape check (last_error_code is null or last_error_code ~ '^[A-Za-z0-9_]{1,60}$')
);

create index if not exists lead_delivery_events_due_idx
  on public.lead_delivery_events (next_attempt_at)
  where status in ('pending', 'sending', 'failed');

-- Fixed-window counters shared by every server instance (spec §9.3, §11). Keys are opaque:
-- `<scope>:<hmac>` from the server, never an address. Task 7 (migration 0005) reuses this table.
create table if not exists public.rate_limit_buckets (
  bucket_key         text primary key,
  hits               integer not null,
  window_started_at  timestamptz not null default now(),
  expires_at         timestamptz not null,
  constraint rate_limit_buckets_key_bounds check (char_length(bucket_key) between 1 and 200),
  constraint rate_limit_buckets_hits_bounds check (hits >= 0)
);

create index if not exists rate_limit_buckets_expires_at_idx on public.rate_limit_buckets (expires_at);

-- ---------------------------------------------------------------------------
-- Row level security and table privileges: deny everything to every API role
-- ---------------------------------------------------------------------------

alter table public.lead_submissions     enable row level security;
alter table public.lead_delivery_events enable row level security;
alter table public.rate_limit_buckets   enable row level security;

-- Forced, so even the table owner is subject to RLS unless it holds BYPASSRLS.
alter table public.lead_submissions     force row level security;
alter table public.lead_delivery_events force row level security;
alter table public.rate_limit_buckets   force row level security;

-- Supabase grants new public tables to anon, authenticated and service_role by default; take all of
-- it back. service_role bypasses RLS, so without this revoke it could read every lead directly.
revoke all on table public.lead_submissions     from public, anon, authenticated, service_role;
revoke all on table public.lead_delivery_events from public, anon, authenticated, service_role;
revoke all on table public.rate_limit_buckets   from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- submit_lead: store or update one adult's signup. Returns only the id and whether it was new.
-- ---------------------------------------------------------------------------

create or replace function public.submit_lead(
  p_email            text,
  p_consent          boolean,
  p_consent_version  text,
  p_first_name       text default null,
  p_age_band         text default null,
  p_source           text default 'landing',
  p_locale           text default null,
  p_utm              jsonb default '{}'::jsonb
)
returns table (lead_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_email       text := lower(btrim(p_email));
  v_first_name  text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_age_band    text := nullif(btrim(coalesce(p_age_band, '')), '');
  v_version     text := btrim(coalesce(p_consent_version, ''));
  v_source      text := coalesce(nullif(btrim(coalesce(p_source, '')), ''), 'landing');
  v_locale      text := nullif(btrim(coalesce(p_locale, '')), '');
  v_utm         jsonb := coalesce(p_utm, '{}'::jsonb);
  v_id          uuid;
  v_created     boolean;
begin
  -- Error messages never repeat the submitted values.
  if p_consent is distinct from true then
    raise exception 'consent is required' using errcode = '22023';
  end if;
  if v_email is null or char_length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'email is invalid' using errcode = '22023';
  end if;
  if v_first_name is not null and (char_length(v_first_name) > 80 or v_first_name ~ '[<>]') then
    raise exception 'first name is invalid' using errcode = '22023';
  end if;
  if v_age_band is not null and v_age_band not in ('under-3', '3-5', '6-8', '9-12', 'prefer-not-to-say') then
    raise exception 'age band is invalid' using errcode = '22023';
  end if;
  if char_length(v_version) not between 1 and 40 then
    raise exception 'consent version is invalid' using errcode = '22023';
  end if;
  if v_source !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'source is invalid' using errcode = '22023';
  end if;
  if v_locale is not null and (char_length(v_locale) > 35 or v_locale !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$') then
    raise exception 'locale is invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(v_utm) <> 'object' or exists (
    select 1 from jsonb_each(v_utm) as tag
    where tag.key not in ('source', 'medium', 'campaign', 'term', 'content')
       or jsonb_typeof(tag.value) <> 'string'
       or char_length(tag.value #>> '{}') not between 1 and 100
  ) then
    raise exception 'campaign tags are invalid' using errcode = '22023';
  end if;

  -- One row per normalised email. A repeat signup refreshes the consent record (a new, explicit
  -- grant under the current copy version) and keeps earlier details the adult did not resend.
  -- Consent is only ever granted here; withdrawal is a separate staff action, never a side effect.
  insert into public.lead_submissions as lead (
    email, first_name, age_band, consent_state, consent_version, consent_granted_at,
    consent_withdrawn_at, source, locale, utm
  )
  values (v_email, v_first_name, v_age_band, 'granted', v_version, now(), null, v_source, v_locale, v_utm)
  on conflict on constraint lead_submissions_email_key do update set
    first_name           = coalesce(excluded.first_name, lead.first_name),
    age_band             = coalesce(excluded.age_band, lead.age_band),
    consent_state        = 'granted',
    consent_version      = excluded.consent_version,
    consent_granted_at   = excluded.consent_granted_at,
    consent_withdrawn_at = null,
    source               = excluded.source,
    locale               = coalesce(excluded.locale, lead.locale),
    utm                  = excluded.utm,
    updated_at           = now()
  returning lead.id, (lead.xmax = 0) into v_id, v_created;

  return query select v_id, v_created;
end;
$fn$;

revoke all on function public.submit_lead(text, boolean, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_lead(text, boolean, text, text, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- enqueue_lead_delivery: write the outbox row for one message kind, once per lead and kind.
-- With p_claim the new row starts as `sending` (attempt 1): the caller is about to send it now.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_lead_delivery(
  p_lead_id  uuid,
  p_kind     text,
  p_claim    boolean default false
)
returns table (event_id uuid, status text, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_id      uuid;
  v_status  text;
begin
  if p_lead_id is null then
    raise exception 'lead id is required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('acknowledgement', 'staff_alert') then
    raise exception 'delivery kind is invalid' using errcode = '22023';
  end if;

  insert into public.lead_delivery_events as event (lead_id, kind, status, attempts, last_attempt_at)
  values (
    p_lead_id,
    p_kind,
    case when p_claim then 'sending' else 'pending' end,
    case when p_claim then 1 else 0 end,
    case when p_claim then now() end
  )
  on conflict on constraint lead_delivery_events_lead_kind_key do nothing
  returning event.id, event.status into v_id, v_status;

  if v_id is not null then
    if p_kind = 'acknowledgement' then
      update public.lead_submissions as lead set acknowledgement_status = v_status, updated_at = now() where lead.id = p_lead_id;
    end if;
    return query select v_id, v_status, true;
    return;
  end if;

  select event.id, event.status into v_id, v_status
  from public.lead_delivery_events as event
  where event.lead_id = p_lead_id and event.kind = p_kind;

  return query select v_id, v_status, false;
end;
$fn$;

revoke all on function public.enqueue_lead_delivery(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_lead_delivery(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- record_lead_delivery_attempt: record the outcome of a claimed (`sending`) delivery.
-- A failure stores a short provider error code (never a message, which can carry an address) and
-- schedules the next attempt with exponential backoff, capped at six hours.
-- Returns false when the event was not in `sending` (already recorded, or never claimed).
-- ---------------------------------------------------------------------------

create or replace function public.record_lead_delivery_attempt(
  p_event_id             uuid,
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
#variable_conflict use_column
declare
  v_lead_id  uuid;
  v_kind     text;
begin
  if p_status is null or p_status not in ('sent', 'failed') then
    raise exception 'delivery status is invalid' using errcode = '22023';
  end if;
  if p_status = 'sent' and (p_provider_message_id is null or char_length(p_provider_message_id) not between 1 and 200) then
    raise exception 'provider message id is invalid' using errcode = '22023';
  end if;
  if p_status = 'failed' and (p_error_code is null or p_error_code !~ '^[A-Za-z0-9_]{1,60}$') then
    raise exception 'error code is invalid' using errcode = '22023';
  end if;

  update public.lead_delivery_events as event set
    status              = p_status,
    provider_message_id = case when p_status = 'sent' then p_provider_message_id else event.provider_message_id end,
    last_error_code     = case when p_status = 'failed' then p_error_code else null end,
    last_attempt_at     = now(),
    next_attempt_at     = case
                            when p_status = 'failed'
                              then now() + least(interval '6 hours', interval '1 minute' * power(2, least(event.attempts, 12)))
                            else event.next_attempt_at
                          end,
    updated_at          = now()
  where event.id = p_event_id and event.status = 'sending'
  returning event.lead_id, event.kind into v_lead_id, v_kind;

  if v_lead_id is null then
    return false;
  end if;
  if v_kind = 'acknowledgement' then
    update public.lead_submissions as lead set acknowledgement_status = p_status, updated_at = now() where lead.id = v_lead_id;
  end if;
  return true;
end;
$fn$;

revoke all on function public.record_lead_delivery_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_lead_delivery_attempt(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- consume_rate_limit: count one hit against a shared fixed window (ruling R3).
-- Atomic under concurrency: one upsert per call. Hits stop counting one past the limit.
-- ---------------------------------------------------------------------------

create or replace function public.consume_rate_limit(
  bucket_key      text,
  max_hits        integer,
  window_seconds  integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now      timestamptz := now();
  v_hits     integer;
  v_expires  timestamptz;
begin
  if consume_rate_limit.bucket_key is null or char_length(consume_rate_limit.bucket_key) not between 1 and 200 then
    raise exception 'bucket key is invalid' using errcode = '22023';
  end if;
  if consume_rate_limit.max_hits is null or consume_rate_limit.max_hits not between 1 and 10000 then
    raise exception 'max hits is invalid' using errcode = '22023';
  end if;
  if consume_rate_limit.window_seconds is null or consume_rate_limit.window_seconds not between 1 and 86400 then
    raise exception 'window is invalid' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets as bucket (bucket_key, hits, window_started_at, expires_at)
  values (
    consume_rate_limit.bucket_key,
    1,
    v_now,
    v_now + make_interval(secs => consume_rate_limit.window_seconds)
  )
  on conflict on constraint rate_limit_buckets_pkey do update set
    hits              = case when bucket.expires_at <= v_now then 1 else least(bucket.hits + 1, consume_rate_limit.max_hits + 1) end,
    window_started_at = case when bucket.expires_at <= v_now then v_now else bucket.window_started_at end,
    expires_at        = case when bucket.expires_at <= v_now then v_now + make_interval(secs => consume_rate_limit.window_seconds) else bucket.expires_at end
  returning bucket.hits, bucket.expires_at into v_hits, v_expires;

  return query select
    v_hits <= consume_rate_limit.max_hits,
    greatest(0, consume_rate_limit.max_hits - v_hits),
    case
      when v_hits <= consume_rate_limit.max_hits then 0
      else greatest(1, ceil(extract(epoch from (v_expires - v_now)))::integer)
    end;
end;
$fn$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Retention (internal): delete rate-limit windows that ended over a day ago.
-- Executable by its owner only. Task 11 schedules it with pg_cron, which runs as the owner:
--   select cron.schedule('purge-rate-limit-buckets', '17 3 * * *', $$select public.purge_expired_rate_limit_buckets()$$);
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_rate_limit_buckets()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_buckets as bucket where bucket.expires_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

revoke all on function public.purge_expired_rate_limit_buckets() from public, anon, authenticated, service_role;
