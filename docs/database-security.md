# Database security

The Supabase database as defined in `supabase/migrations/`: `0001_leads_and_security.sql` covers
founding-family leads, their email outbox and the shared rate limit; `0002` to `0005` cover order
requests, their lines, audit trail and email outbox, order tracking and tracking-token rotation
(see [Orders](#orders-migrations-0002-to-0005)); `0006` adds the email outbox worker's claim and
record functions for both outboxes (see [Email outbox](#email-outbox-migration-0006)). Staff tables
and staff access are not built yet (Task 8b).

## Principles

- **Deny by default.** Every table has row level security **enabled and forced**, and **no
  policies**. No API role (`anon`, `authenticated`, `service_role`) holds any privilege on any
  table; Supabase's default grants are explicitly revoked.
- **One way in.** The website server calls narrow `security definer` functions with bounded
  arguments and `set search_path = ''`, using the server-only service-role key. The functions are
  executable by `service_role` only. The browser never talks to Supabase for leads or orders, so `anon` needs nothing.
- **No raw IP address** is stored anywhere. Rate-limit keys are `<scope>:<HMAC>` values computed by
  the server (`lib/leads/http.ts`, keyed by `LEAD_IP_HASH_SECRET`) and never joined to a lead.
- **No child data.** An adult's email, optional first name, optional broad age band.
- **Owner guard.** The migration stops with an error unless the migrating role bypasses RLS or is a
  superuser (Supabase's `postgres` role bypasses RLS); otherwise every function would fail at runtime.

## Tables

| Table | Holds | Notes |
|---|---|---|
| `lead_submissions` | One row per adult, keyed by normalised (trimmed, lower-case) email | `first_name` (optional, at most 80, no `<` `>`), `age_band` (`under-3`, `3-5`, `6-8`, `9-12`, `prefer-not-to-say`), `consent_state` (`granted` or `withdrawn`), `consent_version`, `consent_granted_at`, `consent_withdrawn_at`, `source`, `locale`, `utm` (JSON object, at most 2 KB, five known keys), `acknowledgement_status` (mirror of the outbox), `last_submitted_at`, `rejoin_requested_at`, timestamps. No IP column, no child fields. |
| `lead_delivery_events` | The email outbox: one row per lead and kind | `kind` (`acknowledgement` or `staff_alert`), `status`, `attempts`, `last_attempt_at`, `next_attempt_at`, `provider_message_id`, `last_error_code` (a short code, never a provider message), timestamps. Unique on `(lead_id, kind)`, so a repeat signup never queues a second email. |
| `rate_limit_buckets` | Fixed-window counters shared by every server instance | `bucket_key`, `hits`, `window_started_at`, `expires_at`. |

## Functions and grants

| Function | Does | Executable by |
|---|---|---|
| `submit_lead(email, consent, consent_version, first_name, age_band, source, locale, utm)` → `(lead_id, created)` | Re-validates every argument in SQL, normalises the email, requires consent, inserts a new row. On an existing address it changes nothing about the person (see below). Errors never repeat submitted values. | `service_role` only |
| `enqueue_lead_delivery(lead_id, kind, claim)` → `(event_id, status, created)` | Writes the outbox row once per lead and kind. With `claim`, a new row starts as `sending` (attempt 1) for an immediate send. Since `0006` no kind is ever claimed, or written as anything but `skipped`, for a withdrawn adult; the website no longer claims here at all (it claims through `claim_lead_deliveries`). | `service_role` only |
| `claim_lead_deliveries(limit, lead_id, kinds)` → JSON (`0006`) | The one claim both send paths use: see [Email outbox](#email-outbox-migration-0006). | `service_role` only |
| `record_lead_delivery_attempt(event_id, status, provider_message_id, error_code)` → `boolean` | Records the result of a claimed (`sending`) row: `sent` with the provider id, `failed` with a short code and exponential backoff capped at 6 hours, or (`0006`) `deferred`, which hands the claim back uncounted. | `service_role` only |
| `consume_rate_limit(bucket_key, max_hits, window_seconds)` → `(allowed, remaining, retry_after_seconds)` | Counts one hit atomically (one upsert). Arguments are bounded (1 to 10000 hits, 1 s to 1 day). | `service_role` only |
| `purge_expired_rate_limit_buckets()` → `integer` | Deletes windows that ended over a day ago. | nobody but its owner (revoked from `public`, `anon`, `authenticated` and `service_role`) |

Every function is `security definer` with `set search_path = ''` and fully qualified names.

## A repeat submission never changes an existing record

The form cannot prove who owns an email address. So when an address is already on the list
(granted **or** withdrawn), `submit_lead` changes nothing about that person: not consent, consent
version or time, not name, age band, source, locale or campaign tags. It only sets
`last_submitted_at`, and for a withdrawn adult `rejoin_requested_at`. The function returns
`created: false` in both cases and the website answers exactly as for a new signup, so the form
cannot reveal who is on the list or who withdrew.

Consequences for staff:

- A withdrawn adult cannot re-join, and nobody can change their details, through the form. Both
  need a confirmed channel (double opt-in or staff action), which does not exist yet.
- `rejoin_requested_at` can be set by anyone who types the address. It is not proof that the person
  asked to re-join.
- Withdrawal is a staff action that marks the row withdrawn and keeps it; there is no delete path in
  the code. There is no staff tool for it yet (it needs SQL by the owner).

## Outbox states

`pending` → `sending` → `sent`, or `sending` → `failed` → (retry) `sending`, or `skipped` (final:
the claim refused to send it). Both outboxes use the same states.

- Without Resend configured, rows stay `pending`. `acknowledgementQueued: true` in the API answer
  means the row exists, never that an email went out.
- If the provider accepts an email but recording the result fails, the row stays `sending`; after
  15 minutes a claim takes it again and re-sends it under the same provider idempotency key, so the
  provider does not deliver it twice.
- The cron worker (`/api/cron/email-outbox`, Task 8a) sends due `pending` and `failed` rows and
  re-claims stale `sending` ones through the same claim functions as the sends made right after
  each answer, spends the same global send budget (below), and uses the idempotency keys
  `lead-delivery/<event id>` and `order-email/<row id>`. Every delivery kind of a withdrawn lead is
  `skipped` in SQL. Details: [Email outbox](#email-outbox-migration-0006).

## Rate limits

| Limit | Key | Value |
|---|---|---|
| Signups per client | `lead:<HMAC of the client address>` | 5 per 10 minutes. IPv4 addresses are counted whole; IPv6 addresses per /64; an IPv4-mapped IPv6 address as IPv4; anything unreadable in one shared bucket. |
| Emails sent straight from the form | `ack-send:global` | `LEAD_ACK_SEND_LIMIT_PER_HOUR` per hour (default 60), shared by acknowledgements, staff alerts, the order emails and the outbox worker. Over the cap the signup or order is still stored and the email waits `pending`. |

The limiter is the database whenever Supabase is configured. If it is unavailable the signup fails
closed with 503. The in-memory limiter in `lib/security/rate-limit.ts` is for tests only.
The client address is taken from the left-most `x-forwarded-for` entry, which is correct behind
Vercel's edge; on another host it could be spoofed.

## Orders (migrations 0002 to 0005)

The same principles apply: forced RLS with no policies, every privilege revoked from every API role,
and narrow functions executable by `service_role` only. Each order migration stops unless the
migrating role bypasses RLS, and `0004` re-checks the order grants in the same transaction, so a
deploy fails instead of leaving a door open. No order holds a price until staff quote it (Task 8),
and no payment detail is ever stored.

| Table | Holds | Notes |
|---|---|---|
| `orders` | One row per order request | Human-readable `reference` (`BB-XXXX-XXXX`), `submission_key` (the order form's random key for the request, unique: one order per key), `status` (`new`, `confirmed`, `paid`, `dispatched`, `closed`, `cancelled`), `status_changed_at`, adult contact and delivery details (each bounded: name 120, email 254, phone 32, address lines 200, city and region 100, postal code 16, notes 1000, a two-letter country), `consent_version`, `consent_granted_at`, `tracking_token_hash` (SHA-256 only, never the token), `tracking_token_expires_at`, `tracking_token_rotated_at`, and the staff quote columns (`currency`, `subtotal_minor`, `freight_minor`, `payment_url`, `quote_sent_at`), empty until Task 8, and `retain_until` (retention metadata), empty until a retention policy is adopted: nothing sets or acts on it yet. |
| `order_items` | The CMS snapshot of each product at ordering time | `sanity_id`, `title`, `sku`, `variant`, `pack`, `quantity` (1 to 999), `line_number` (1 to 40). One line per product. |
| `order_events` | The audit trail | `actor` (`customer`, `staff`, `system`), `event_type`, `old_status`, `new_status`, `metadata` (a small JSON object). |
| `order_email_outbox` | Order emails, sent right after the order and retried by the outbox worker | Shaped like `lead_delivery_events`: `kind` (`acknowledgement`, `staff_alert`, and since `0006` `quote`), `status` (plus `skipped`), `attempts`, `next_attempt_at`, `provider_message_id`, `last_error_code`; since `0006` also `quote_revision` (quotes only), `unconfirmed_since` and `idempotency_key` (see [Email outbox](#email-outbox-migration-0006)). |

| Function | Does | Executable by |
|---|---|---|
| `submit_order(...)` → `(order_id, reference, tracking_token, tracking_token_expires_at, acknowledgement_queued, duplicate)` | Re-validates every argument, then in one transaction writes the order, its lines (the server's canonical CMS snapshot, checked key by key), an `order_submitted` audit event and both outbox rows. If any part fails, nothing is kept. The tracking token is returned this once. A submission key already used with the same email (a retry whose answer was lost) returns the first order's id and reference with no token, nothing queued and `duplicate` true, and writes nothing; the same key with another email is refused. | `service_role` only |
| `lookup_order_by_token(token)` → JSON or null | The order for a current, unexpired token. | `service_role` only |
| `lookup_order_by_reference_email(reference, email)` → JSON or null | The order with that reference AND that email, both normalised. | `service_role` only |
| `rotate_order_tracking_token(order_id)` → `(tracking_token, tracking_token_expires_at)` | Issues a new token with a new expiry (180 days); the old one stops working; records a `tracking_token_rotated` event. For staff and the Task 8 worker. | `service_role` only |
| `order_tracking_payload`, `order_tracking_token_hash`, `issue_order_tracking_token` | Internal helpers, run with their caller's rights. | nobody but their owner |

Both lookups return the same locked payload: reference, status, `submittedAt`, `statusChangedAt` and
each line's title, variant, pack and quantity. Never an address, email, name, phone, notes, SKU,
product id, price or payment link. Every miss (unknown, malformed, expired, wrong email) returns the
same null, so a lookup cannot reveal which references exist.

One order per submission key (ruling R81): the order form makes a random key once per order attempt
and sends the same key on every retry, so a request sent again after a lost answer cannot become a
second order or queue a second set of emails. The first order's token cannot be handed out again
(only its hash is kept), so the site answers such a retry with the reference and points the buyer at
tracking by reference and email.

Order rate limits reuse `consume_rate_limit` (ruling R79; no second limiter table):

| Limit | Key | Value |
|---|---|---|
| Order requests per client | `order:<HMAC of the client address>` | 5 per hour |
| Tracking lookups per client | `order-track:<HMAC of the client address>` | 10 per 10 minutes, found or not |

## Email outbox (migration 0006)

`0006_order_events_and_email_outbox.sql` gives both outboxes one claim function each, used by both
send paths (ruling R88): the attempt made right after the API answer, which names its lead or
order and one message kind, and the cron worker (`/api/cron/email-outbox`), which names neither. No
table privilege changes: the outbox tables stay unreachable except through these functions.

| Function | Does | Executable by |
|---|---|---|
| `claim_lead_deliveries(limit, lead_id, kinds)` → JSON | Claims up to `limit` (1 to 50) due rows, optionally of one lead and some kinds, `for update skip locked`, so two callers never hold the same row. Each claimed row becomes `sending` with its attempt counted, and is returned with only what its email needs: `{id, kind, attempt, email, firstName, ageBand, source}`. Answers `{"claimed": [...], "skipped": n, "expired": n}`. | `service_role` only |
| `claim_order_emails(limit, order_id, kinds)` → JSON | The same for order emails. Each claimed row carries the order reference, contact name, email, each line's title, variant, pack and quantity, and for a quote its currency, subtotal, freight, payment link and revision. Never the tracking token or its hash, an address, phone, notes or SKU. | `service_role` only |
| `record_lead_delivery_attempt(event_id, status, provider_message_id, error_code)`, `record_order_email_attempt(email_id, status, provider_message_id, error_code)` → `boolean` | Records a claimed row's result: `sent`, `failed` (backoff 2, 4, 8 … minutes, capped at 6 hours) or `deferred` (the global send budget was spent: the claim is handed back with its earlier status and attempt count, still due). `false` when the row was no longer claimed. When the provider accepts a `quote`, the same statement sets `orders.quote_sent_at` (R90). | `service_role` only |
| `outbox_failure_unconfirmed(error_code)` | Internal: whether a failure code means the send may have reached the provider (a timeout, an abort, a dropped connection, a provider server error). | nobody but its owner (revoked from `public`, `anon`, `authenticated` and `service_role`) |

Claim rules:

- **Due** means `pending` or `failed` with `next_attempt_at` reached, or `sending` for over 15
  minutes (a crash or a lost result). A stale `sending` row is sent again under the same provider
  idempotency key, the row id, so an email the provider already accepted is not repeated (R91).
- **Unconfirmed sends** (`unconfirmed_since`): the provider keeps an idempotency key for 24 hours, so
  a send whose outcome is unknown is retried only within 23 hours. After that the claim parks it as
  `failed` with `stale_unconfirmed` and `next_attempt_at` = infinity, for a human to check; it is
  counted as `expired`.
- **At most 8 attempts.** The eighth failure, and a provider answer that the idempotency key was
  already used for another message (`invalid_idempotent_request`), are final: `failed` with
  `next_attempt_at` = infinity. Infinity is the terminal marker; no status value was added for it.
- **Withdrawn leads** (R92): every delivery kind of a withdrawn lead is marked `skipped`
  (`lead_withdrawn`) by the claim and never returned, so no caller can email a withdrawn adult even
  with a bug. A later `enqueue_lead_delivery` for that lead answers `skipped`, not created.
- **Quotes** (queued by Task 8b): `orders.quote_revision` (default 0) counts the order's quotes. A
  quote email whose revision is no longer the order's current one, whose order was cancelled, or
  whose quote figures are incomplete is `skipped`, never sent with figures it was not queued for.
- **Idempotency key** (R90): `order_email_outbox.idempotency_key` is a stored generated column,
  `<order id>:<kind>` for the acknowledgement and staff alert and `<order id>:quote:<revision>` for
  a quote, and unique. It replaces the old unique `(order_id, kind)` rule, which still holds for
  the two submit kinds through the key.
- `lead_submissions.acknowledgement_status` follows the acknowledgement row, `skipped` included.

## Tests

- `tests/leads/migration-policy.test.ts`: static checks of the SQL text (forced RLS, revokes,
  `search_path`, grants, the columns a conflict may touch).
- `tests/leads/migration-database.test.ts`: runs the migration and the pgTAP file
  `supabase/tests/0001_leads_rls.sql` (81 assertions) in PGlite, an embedded Postgres, inside a
  stand-in for Supabase's roles and default grants. It runs with every `npm test`.
- Against a real project (Task 11): `supabase test db` runs the same pgTAP file. PGlite proves the
  policy logic, not Supabase's own role setup, so the real run is the authority.
- `tests/orders/migration-policy.test.ts` and `tests/orders/migration-database.test.ts` do the same
  for the order migrations: the second applies `0001` to `0006` in order and runs every pgTAP file
  (`supabase/tests/0002_orders_rls.sql`, `0003_tracking_grants.sql`, `0004_email_outbox.sql` and the
  lead file) against the result.
- `tests/outbox/migration-policy.test.ts` pins the outbox statuses, kinds and limits in `0006` to
  `lib/outbox/constants.ts`; `supabase/tests/0004_email_outbox.sql` checks the outbox grants and
  every claim, skip, backoff and stale rule in PGlite.

## Migration rules

- `0001_leads_and_security.sql` may still be edited in place, **only until it is first applied to a
  real Supabase project** (Task 11). From then on every change is a new numbered migration
  (`0002_…`), never an edit to an applied one.
- Apply migrations with the Supabase CLI (`supabase db push`) as the project owner, after review.
  Confirm afterwards that tables, policies, functions and grants match this page, then run
  `supabase test db`.
- The retention helper is meant to be scheduled with `pg_cron` (it runs as the owner):
  `select cron.schedule('purge-rate-limit-buckets', '17 3 * * *', $$select public.purge_expired_rate_limit_buckets()$$);`
  Not scheduled yet (Task 11).
- Never run destructive cleanup on production data other than records QA explicitly created.
