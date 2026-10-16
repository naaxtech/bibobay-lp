-- BIBO Bay migration 0006: the email outbox worker (Task 8a; spec §10 steps 6-7 and 9, §12;
-- rulings R88-R92).
--
-- What this adds, on top of the outbox tables of 0001 (lead_delivery_events) and 0002
-- (order_email_outbox):
--
--   * One claim function per outbox, used by BOTH send paths (R88): the attempt made right after
--     the API answer (which names its lead or order and message kind) and the cron worker (which
--     names neither). A claim takes due rows only, `for update skip locked`, marks them `sending`
--     and counts the attempt (R91), so two callers can never hold the same row and nothing is sent
--     twice. It answers with only what the email needs, as JSON:
--       {"claimed": [...], "skipped": <rows not to send>, "expired": <rows parked for a human>}
--   * Due means: `pending` or `failed` with next_attempt_at reached, or `sending` for over
--     15 minutes (a crash or a lost result: the row is sent again under the same provider
--     idempotency key, which is the row id, so an email the provider already accepted is not
--     repeated).
--   * The provider keeps an idempotency key for 24 hours. A send whose outcome is unknown (a
--     timeout, a dropped connection, a stuck `sending` row) may have been delivered, so it is only
--     retried within 23 hours of the attempt that made it unknown (`unconfirmed_since`). After
--     that the claim parks the row as `failed` with `stale_unconfirmed` and next_attempt_at
--     'infinity', for a human to check (R91). A failure the provider answered (a refusal, a quota)
--     delivered nothing and keeps retrying.
--   * At most 8 attempts. The eighth failure, and a provider answer that the key was already used
--     with another message (`invalid_idempotent_request`), are final: `failed` with
--     next_attempt_at 'infinity'. 'infinity' is the terminal marker; no status value was added for it.
--   * Every delivery kind of a withdrawn lead is refused in SQL: the claim marks it `skipped`
--     (`lead_withdrawn`) and never returns it, so no caller can email a withdrawn adult even with a
--     bug (R92). enqueue_lead_delivery no longer claims any kind for a withdrawn lead either.
--   * Recording: `sent` or `failed` (with exponential backoff, capped at six hours), or `deferred`:
--     the claim is handed back without an attempt (the global send budget was spent), returning the
--     row to its earlier status and attempt count, still due.
--   * Order emails gain the `quote` kind (queued by Task 8b), an explicit unique `idempotency_key`
--     (R90): `<order id>:<kind>` for the acknowledgement and staff alert, `<order id>:quote:<revision>`
--     for a quote. It is a stored generated column, so every row has the right key without
--     submit_order (migration 0002) being copied here, and nobody can write a different one.
--     `orders.quote_revision` counts the order's quotes; a queued quote whose revision is no longer
--     the order's current one, whose order was cancelled, or whose quote is incomplete is
--     `skipped`, never sent with figures it was not queued for. When the provider accepts a quote,
--     the statement that records it also sets `orders.quote_sent_at` (R90).
--
-- Security model (the same as 0001-0005): the new functions are `security definer` with
-- `set search_path = ''`, executable by service_role only; the failure-code helper is executable by
-- nobody but its owner. No table privilege changes: the outbox tables stay unreachable except
-- through these RPCs.
--
-- Tests: tests/outbox/migration-policy.test.ts (static) and tests/orders/migration-database.test.ts
-- (runs every migration and supabase/tests/0004_email_outbox.sql in an embedded Postgres).

do $guard$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'Migration 0006 must run as a role that bypasses row level security (Supabase: postgres).'
      using errcode = '42501';
  end if;
  if pg_catalog.to_regprocedure('public.enqueue_lead_delivery(uuid, text, boolean)') is null
     or pg_catalog.to_regprocedure('public.rotate_order_tracking_token(uuid)') is null then
    raise exception 'Migrations 0001 to 0005 must be applied before 0006.' using errcode = '55000';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- Columns and constraints
-- ---------------------------------------------------------------------------

-- Lead deliveries: a `skipped` status (R92) and the start of an unconfirmed send (R91).
alter table public.lead_delivery_events drop constraint if exists lead_delivery_events_status_values;
alter table public.lead_delivery_events add constraint lead_delivery_events_status_values
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
alter table public.lead_delivery_events add column if not exists unconfirmed_since timestamptz;

alter table public.lead_submissions drop constraint if exists lead_submissions_acknowledgement_status_values;
alter table public.lead_submissions add constraint lead_submissions_acknowledgement_status_values
  check (acknowledgement_status in ('not_queued', 'pending', 'sending', 'sent', 'failed', 'skipped'));

-- Orders: how many quotes staff have saved (Task 8b increments it). 0 means none yet.
alter table public.orders add column if not exists quote_revision integer not null default 0;
alter table public.orders drop constraint if exists orders_quote_revision_bounds;
alter table public.orders add constraint orders_quote_revision_bounds check (quote_revision >= 0);

-- Order emails: the quote kind, a `skipped` status, the quote revision a quote email was queued
-- for, the start of an unconfirmed send, and the idempotency key (R90).
alter table public.order_email_outbox drop constraint if exists order_email_outbox_kind_values;
alter table public.order_email_outbox add constraint order_email_outbox_kind_values
  check (kind in ('acknowledgement', 'staff_alert', 'quote'));
alter table public.order_email_outbox drop constraint if exists order_email_outbox_status_values;
alter table public.order_email_outbox add constraint order_email_outbox_status_values
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
alter table public.order_email_outbox add column if not exists quote_revision integer;
alter table public.order_email_outbox drop constraint if exists order_email_outbox_quote_revision_shape;
alter table public.order_email_outbox add constraint order_email_outbox_quote_revision_shape
  check ((kind = 'quote') = (quote_revision is not null) and (quote_revision is null or quote_revision >= 1));
alter table public.order_email_outbox add column if not exists unconfirmed_since timestamptz;
alter table public.order_email_outbox add column if not exists idempotency_key text
  generated always as (order_id::text || ':' || kind || coalesce(':' || quote_revision::text, '')) stored;
alter table public.order_email_outbox alter column idempotency_key set not null;
alter table public.order_email_outbox drop constraint if exists order_email_outbox_idempotency_key_key;
alter table public.order_email_outbox add constraint order_email_outbox_idempotency_key_key unique (idempotency_key);
-- One row per order and kind no longer holds for quotes (one per revision). For the
-- acknowledgement and the staff alert the idempotency key keeps exactly that rule.
alter table public.order_email_outbox drop constraint if exists order_email_outbox_order_kind_key;

-- ---------------------------------------------------------------------------
-- Internal: which failure codes leave a send unconfirmed (it may have reached the provider).
-- Our own codes (lib/email/client.ts, lib/leads/submit.ts) for a request that may have gone out,
-- an unrecognised provider error, and the provider's server-side and in-progress errors. Every other
-- provider code is an answer: nothing was accepted. Executable by its owner only.
-- ---------------------------------------------------------------------------

create or replace function public.outbox_failure_unconfirmed(p_error_code text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(p_error_code in (
    'send_timeout', 'send_aborted', 'send_exception', 'missing_message_id', 'provider_error',
    'application_error', 'internal_server_error', 'concurrent_idempotent_requests'
  ), true);
$fn$;

revoke all on function public.outbox_failure_unconfirmed(text) from public, anon, authenticated, service_role;

-- Backfill-safe: failures recorded before this migration with an unconfirmed code count as
-- unconfirmed from their last attempt (the closest time known).
update public.lead_delivery_events as event
   set unconfirmed_since = event.last_attempt_at
 where event.status = 'failed' and event.unconfirmed_since is null and event.last_attempt_at is not null
   and public.outbox_failure_unconfirmed(event.last_error_code);
update public.order_email_outbox as outbox
   set unconfirmed_since = outbox.last_attempt_at
 where outbox.status = 'failed' and outbox.unconfirmed_since is null and outbox.last_attempt_at is not null
   and public.outbox_failure_unconfirmed(outbox.last_error_code);

-- ---------------------------------------------------------------------------
-- enqueue_lead_delivery (replaces 0001's): unchanged, except that no delivery kind of a withdrawn
-- lead is ever claimed here (R92; 0001 refused only the acknowledgement). The app no longer claims
-- at enqueue at all (R88): it claims through claim_lead_deliveries after the answer.
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
  v_claim   boolean := coalesce(p_claim, false);
begin
  if p_lead_id is null then
    raise exception 'lead id is required' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('acknowledgement', 'staff_alert') then
    raise exception 'delivery kind is invalid' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.lead_submissions as lead where lead.id = p_lead_id and lead.consent_state = 'withdrawn'
  ) then
    v_claim := false;
  end if;

  insert into public.lead_delivery_events as event (lead_id, kind, status, attempts, last_attempt_at)
  values (
    p_lead_id,
    p_kind,
    case when v_claim then 'sending' else 'pending' end,
    case when v_claim then 1 else 0 end,
    case when v_claim then now() end
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
-- claim_lead_deliveries: claim up to p_limit (1-50) due lead deliveries, optionally of one lead
-- and of some kinds. Each claimed entry: {id, kind, attempt, email, firstName, ageBand, source}.
-- ---------------------------------------------------------------------------

create or replace function public.claim_lead_deliveries(
  p_limit    integer default 10,
  p_lead_id  uuid default null,
  p_kinds    text[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_claimed  jsonb := '[]'::jsonb;
  v_skipped  integer := 0;
  v_expired  integer := 0;
  v_status   text;
  r          record;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'claim limit is invalid' using errcode = '22023';
  end if;
  if p_kinds is not null and (
    pg_catalog.cardinality(p_kinds) = 0
    or exists (select 1 from pg_catalog.unnest(p_kinds) as k(kind) where k.kind is null or k.kind not in ('acknowledgement', 'staff_alert'))
  ) then
    raise exception 'delivery kind is invalid' using errcode = '22023';
  end if;

  for r in
    select event.id, event.lead_id, event.kind, event.status, event.attempts, event.last_attempt_at, event.unconfirmed_since,
           lead.consent_state, lead.email, lead.first_name, lead.age_band, lead.source
      from public.lead_delivery_events as event
      join public.lead_submissions as lead on lead.id = event.lead_id
     where (p_lead_id is null or event.lead_id = p_lead_id)
       and (p_kinds is null or event.kind = any (p_kinds))
       and (
         (event.status in ('pending', 'failed') and event.next_attempt_at <= now())
         or (event.status = 'sending' and event.last_attempt_at <= now() - interval '15 minutes')
       )
     order by event.next_attempt_at, event.created_at, event.id
     limit p_limit
     for update of event skip locked
  loop
    if r.consent_state = 'withdrawn' then
      -- R92: never email a withdrawn adult, whatever the kind.
      v_status := 'skipped';
      update public.lead_delivery_events as event
         set status = 'skipped', last_error_code = 'lead_withdrawn', updated_at = now()
       where event.id = r.id;
      v_skipped := v_skipped + 1;
    elsif r.attempts >= 8
       or (r.status = 'sending' and coalesce(r.unconfirmed_since, r.last_attempt_at) <= now() - interval '23 hours')
       or (r.status = 'failed' and r.unconfirmed_since is not null and r.unconfirmed_since <= now() - interval '23 hours') then
      -- R91: outside the provider's idempotency window a send may repeat one already delivered.
      v_status := 'failed';
      update public.lead_delivery_events as event
         set status = 'failed',
             last_error_code = case when r.status = 'sending' or r.unconfirmed_since is not null then 'stale_unconfirmed' else event.last_error_code end,
             unconfirmed_since = case when r.status = 'sending' then coalesce(r.unconfirmed_since, r.last_attempt_at) else event.unconfirmed_since end,
             next_attempt_at = 'infinity',
             updated_at = now()
       where event.id = r.id;
      v_expired := v_expired + 1;
    else
      v_status := 'sending';
      update public.lead_delivery_events as event
         set status = 'sending',
             attempts = event.attempts + 1,
             last_attempt_at = now(),
             -- A stuck send may have gone out: unconfirmed from when it was claimed.
             unconfirmed_since = case when r.status = 'sending' then coalesce(r.unconfirmed_since, r.last_attempt_at) else event.unconfirmed_since end,
             updated_at = now()
       where event.id = r.id;
      v_claimed := v_claimed || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'attempt', r.attempts + 1,
        'email', r.email,
        'firstName', r.first_name,
        'ageBand', r.age_band,
        'source', r.source
      ));
    end if;
    if r.kind = 'acknowledgement' then
      update public.lead_submissions as lead set acknowledgement_status = v_status, updated_at = now() where lead.id = r.lead_id;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('claimed', v_claimed, 'skipped', v_skipped, 'expired', v_expired);
end;
$fn$;

revoke all on function public.claim_lead_deliveries(integer, uuid, text[]) from public, anon, authenticated;
grant execute on function public.claim_lead_deliveries(integer, uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- record_lead_delivery_attempt (replaces 0001's): record the outcome of a claimed (`sending`) row.
--   sent      the provider accepted it; its message id is kept.
--   failed    a short error code (never a provider message); next attempt with exponential backoff
--             (2^attempts minutes, at most six hours), or never after the eighth attempt or an
--             idempotency conflict. An unconfirmed failure starts the 23-hour window (R91).
--   deferred  no attempt was made (the send budget was spent): the claim is handed back, so the
--             row returns to its earlier status and attempt count and stays due.
-- Returns false when the row was not `sending` (already recorded, or never claimed).
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
  v_status   text;
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

  update public.lead_delivery_events as event set
    status              = case
                            when p_status <> 'deferred' then p_status
                            when event.attempts <= 1 then 'pending'
                            else 'failed'
                          end,
    attempts            = case when p_status = 'deferred' then greatest(event.attempts - 1, 0) else event.attempts end,
    provider_message_id = case when p_status = 'sent' then p_provider_message_id else event.provider_message_id end,
    last_error_code     = case p_status when 'sent' then null when 'failed' then p_error_code else event.last_error_code end,
    last_attempt_at     = case when p_status = 'deferred' then event.last_attempt_at else now() end,
    unconfirmed_since   = case
                            when p_status = 'failed' and public.outbox_failure_unconfirmed(p_error_code)
                              then coalesce(event.unconfirmed_since, event.last_attempt_at)
                            else event.unconfirmed_since
                          end,
    next_attempt_at     = case
                            when p_status = 'failed' and (event.attempts >= 8 or p_error_code = 'invalid_idempotent_request')
                              then 'infinity'::timestamptz
                            when p_status = 'failed'
                              then now() + least(interval '6 hours', interval '1 minute' * power(2, least(event.attempts, 12)))
                            else event.next_attempt_at
                          end,
    updated_at          = now()
  where event.id = p_event_id and event.status = 'sending'
  returning event.lead_id, event.kind, event.status into v_lead_id, v_kind, v_status;

  if v_lead_id is null then
    return false;
  end if;
  if v_kind = 'acknowledgement' then
    update public.lead_submissions as lead set acknowledgement_status = v_status, updated_at = now() where lead.id = v_lead_id;
  end if;
  return true;
end;
$fn$;

revoke all on function public.record_lead_delivery_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_lead_delivery_attempt(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- claim_order_emails: claim up to p_limit (1-50) due order emails, optionally of one order and of
-- some kinds. Each claimed entry:
--   {id, kind, attempt, reference, contactName, email,
--    lines: [{title, variant, pack, quantity}, ...],
--    quote: null | {currency, subtotalMinor, freightMinor, paymentUrl, revision}}
-- Never the address, phone, notes, SKUs, product ids or the tracking token hash.
-- ---------------------------------------------------------------------------

create or replace function public.claim_order_emails(
  p_limit     integer default 10,
  p_order_id  uuid default null,
  p_kinds     text[] default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_claimed  jsonb := '[]'::jsonb;
  v_skipped  integer := 0;
  v_expired  integer := 0;
  v_skip     text;
  r          record;
begin
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'claim limit is invalid' using errcode = '22023';
  end if;
  if p_kinds is not null and (
    pg_catalog.cardinality(p_kinds) = 0
    or exists (select 1 from pg_catalog.unnest(p_kinds) as k(kind) where k.kind is null or k.kind not in ('acknowledgement', 'staff_alert', 'quote'))
  ) then
    raise exception 'email kind is invalid' using errcode = '22023';
  end if;

  for r in
    select outbox.id, outbox.order_id, outbox.kind, outbox.status, outbox.attempts, outbox.last_attempt_at, outbox.unconfirmed_since,
           outbox.quote_revision, o.reference, o.contact_name, o.email, o.status as order_status, o.currency, o.subtotal_minor,
           o.freight_minor, o.payment_url, o.quote_revision as order_quote_revision
      from public.order_email_outbox as outbox
      join public.orders as o on o.id = outbox.order_id
     where (p_order_id is null or outbox.order_id = p_order_id)
       and (p_kinds is null or outbox.kind = any (p_kinds))
       and (
         (outbox.status in ('pending', 'failed') and outbox.next_attempt_at <= now())
         or (outbox.status = 'sending' and outbox.last_attempt_at <= now() - interval '15 minutes')
       )
     order by outbox.next_attempt_at, outbox.created_at, outbox.id
     limit p_limit
     for update of outbox skip locked
  loop
    -- A quote goes out only with the figures it was queued for, and never for a cancelled order.
    v_skip := case
      when r.kind <> 'quote' then null
      when r.order_status = 'cancelled' then 'order_cancelled'
      when r.quote_revision is distinct from r.order_quote_revision then 'quote_superseded'
      when r.currency is null or r.subtotal_minor is null or r.freight_minor is null or r.payment_url is null then 'quote_incomplete'
    end;

    if v_skip is not null then
      update public.order_email_outbox as outbox
         set status = 'skipped', last_error_code = v_skip, updated_at = now()
       where outbox.id = r.id;
      v_skipped := v_skipped + 1;
    elsif r.attempts >= 8
       or (r.status = 'sending' and coalesce(r.unconfirmed_since, r.last_attempt_at) <= now() - interval '23 hours')
       or (r.status = 'failed' and r.unconfirmed_since is not null and r.unconfirmed_since <= now() - interval '23 hours') then
      update public.order_email_outbox as outbox
         set status = 'failed',
             last_error_code = case when r.status = 'sending' or r.unconfirmed_since is not null then 'stale_unconfirmed' else outbox.last_error_code end,
             unconfirmed_since = case when r.status = 'sending' then coalesce(r.unconfirmed_since, r.last_attempt_at) else outbox.unconfirmed_since end,
             next_attempt_at = 'infinity',
             updated_at = now()
       where outbox.id = r.id;
      v_expired := v_expired + 1;
    else
      update public.order_email_outbox as outbox
         set status = 'sending',
             attempts = outbox.attempts + 1,
             last_attempt_at = now(),
             unconfirmed_since = case when r.status = 'sending' then coalesce(r.unconfirmed_since, r.last_attempt_at) else outbox.unconfirmed_since end,
             updated_at = now()
       where outbox.id = r.id;
      v_claimed := v_claimed || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'attempt', r.attempts + 1,
        'reference', r.reference,
        'contactName', r.contact_name,
        'email', r.email,
        'lines', (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'title', item.title, 'variant', item.variant, 'pack', item.pack, 'quantity', item.quantity
                 ) order by item.line_number), '[]'::jsonb)
            from public.order_items as item
           where item.order_id = r.order_id
        ),
        'quote', case when r.kind = 'quote' then pg_catalog.jsonb_build_object(
          'currency', r.currency,
          'subtotalMinor', r.subtotal_minor,
          'freightMinor', r.freight_minor,
          'paymentUrl', r.payment_url,
          'revision', r.quote_revision
        ) end
      ));
    end if;
  end loop;

  return pg_catalog.jsonb_build_object('claimed', v_claimed, 'skipped', v_skipped, 'expired', v_expired);
end;
$fn$;

revoke all on function public.claim_order_emails(integer, uuid, text[]) from public, anon, authenticated;
grant execute on function public.claim_order_emails(integer, uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- record_order_email_attempt: the order outbox's record_lead_delivery_attempt, with the same
-- statuses and rules. When the provider accepted a quote, the same statement sets the order's
-- quote_sent_at (R90). Returns false when the row was not `sending`.
-- ---------------------------------------------------------------------------

create or replace function public.record_order_email_attempt(
  p_email_id             uuid,
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
declare
  v_found  boolean;
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

  with recorded as (
    update public.order_email_outbox as outbox set
      status              = case
                              when p_status <> 'deferred' then p_status
                              when outbox.attempts <= 1 then 'pending'
                              else 'failed'
                            end,
      attempts            = case when p_status = 'deferred' then greatest(outbox.attempts - 1, 0) else outbox.attempts end,
      provider_message_id = case when p_status = 'sent' then p_provider_message_id else outbox.provider_message_id end,
      last_error_code     = case p_status when 'sent' then null when 'failed' then p_error_code else outbox.last_error_code end,
      last_attempt_at     = case when p_status = 'deferred' then outbox.last_attempt_at else now() end,
      unconfirmed_since   = case
                              when p_status = 'failed' and public.outbox_failure_unconfirmed(p_error_code)
                                then coalesce(outbox.unconfirmed_since, outbox.last_attempt_at)
                              else outbox.unconfirmed_since
                            end,
      next_attempt_at     = case
                              when p_status = 'failed' and (outbox.attempts >= 8 or p_error_code = 'invalid_idempotent_request')
                                then 'infinity'::timestamptz
                              when p_status = 'failed'
                                then now() + least(interval '6 hours', interval '1 minute' * power(2, least(outbox.attempts, 12)))
                              else outbox.next_attempt_at
                            end,
      updated_at          = now()
    where outbox.id = p_email_id and outbox.status = 'sending'
    returning outbox.order_id, outbox.kind, outbox.status
  ), quoted as (
    update public.orders as o set quote_sent_at = now(), updated_at = now()
      from recorded
     where o.id = recorded.order_id and recorded.kind = 'quote' and recorded.status = 'sent'
    returning o.id
  )
  select exists (select 1 from recorded) into v_found;

  return v_found;
end;
$fn$;

revoke all on function public.record_order_email_attempt(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_order_email_attempt(uuid, text, text, text) to service_role;

-- The same proof as 0004 and 0005, for the functions this migration adds or replaces.
do $verify$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.claim_lead_deliveries(integer, uuid, text[])',
    'public.claim_order_emails(integer, uuid, text[])',
    'public.record_order_email_attempt(uuid, text, text, text)',
    'public.record_lead_delivery_attempt(uuid, text, text, text)',
    'public.enqueue_lead_delivery(uuid, text, boolean)'
  ] loop
    if pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '% is executable by an anonymous or signed-in role', v_fn using errcode = '42501';
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '% is not executable by service_role', v_fn using errcode = '42501';
    end if;
  end loop;
  if pg_catalog.has_function_privilege('service_role', 'public.outbox_failure_unconfirmed(text)', 'EXECUTE') then
    raise exception 'outbox_failure_unconfirmed is executable by an API role' using errcode = '42501';
  end if;
end;
$verify$;
