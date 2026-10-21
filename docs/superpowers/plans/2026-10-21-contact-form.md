# Contact Us Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/contact` page where a grown-up writes to the BIBO Bay team. The message is stored in Supabase and announced to staff by exactly one alert email through an outbox. The form is open only when someone will actually receive the message.

**Architecture:** A server page reads CMS copy (with a repository fallback). It renders the client form only while `contactFormOpen()` holds; otherwise it shows the CMS contact address as a mailto link, or a closed notice. The form posts JSON to `POST /api/contact`, which runs honeypot → zod validation → open check → per-client and global DB rate limits → one `security definer` RPC that writes `contact_messages` and its row in a new outbox table, `contact_message_deliveries`, in one transaction (R169). After the answer, `after()` claims that row through `claim_contact_deliveries` and sends it with the shared attempt step (`lib/outbox/attempt.ts`). The cron worker (once a day, R180) drains this third outbox, named `contact`, after the order and signup outboxes, as the retry net. The lead outbox and the lead and consent tables are not touched.

**Tech Stack:** Next.js 16.3.8 App Router, React 19.3, TypeScript, zod 4.6.6, `@supabase/supabase-js` 2.117.3 (RPC only), `resend` 6.32.1, Sanity (standalone Studio in `studio/`), Vitest with PGlite and pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-bibobay-production-platform-design.md` (the binding truth, child-data, lead-capture and security rules) and the controller rulings R158–R177 quoted below, which are this slice's specification.

**Base:** `main` once PR #5 has merged: `39b95e1` plus `2e2c197` (R180, the email outbox cron once a day on Hobby). Branch `slice/bibobay/contact-form` from that `main`. Every file:line reference below is to that tree.

## Global Constraints

- npm only (`package-lock.json`), never bun. Implementers never run `npm ci`, `npm install` or `npm update` (R112), never build, and never start a server or Playwright (the controller does, R150).
- Implementers make no git writes (R7). The controller stages explicit paths, reads `git diff --cached --numstat`, and commits.
- Never edit `AGENTS.md` or `CLAUDE.md`. Never delete a file, export, test or feature. Migrations `0001`–`0007` are not edited.
- R169: the lead outbox is not altered. No task touches `lead_delivery_events` or its constraints, `lead_submissions`, the consent columns, `enqueue_lead_delivery`, `claim_lead_deliveries`, `record_lead_delivery_attempt`, `LEAD_DELIVERY_KINDS`, `lib/outbox/leads.ts` or `lib/supabase/leads.ts`.
- Public repository: every new or changed tracked file must pass `tests/scripts/docs-hygiene.test.ts`. That means no local absolute paths, addresses only on reserved domains (`example.com`, `.test`), no private project or tool names, and never the name of the dotted, git-ignored working-ledger folder.
- No child data. Grown-ups only: no age field, no child's name. Copy addresses parents, carers and professionals.
- Truth: `persisted: true` only after the RPC returned both ids. No visible string says a message was emailed, sent or delivered (`DELIVERY_CLAIM_PATTERN`, C7).
- The sender never receives an email (R160).
- Every database touch is a `security definer` RPC with `set search_path = ''`, executable by `service_role` only. The browser never talks to Supabase or Resend.
- No raw IP is stored anywhere. Rate-limit keys come from `clientKeyFromHeaders` (`lib/leads/http.ts:21`, IPv6 per /64), keyed by `LEAD_IP_HASH_SECRET`.
- No new environment names. Reused: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LEAD_IP_HASH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `STAFF_NOTIFICATION_EMAIL`, `LEAD_ACK_SEND_LIMIT_PER_HOUR`, and `CRON_SECRET` (worker only). `RESEND_REPLY_TO` is not used by the contact alert: its Reply-To is the sender (R172).
- Law 1: no `any`, no TODO, no stub, no commented-out code and no unhandled error path. Lint passes at zero warnings, and no `eslint-disable` is added in advance.
- Next 16.3.8 differs from older versions. Before using any Next API, read its guide in the copy of the framework docs that the controller names in the brief (R113), and cite it as `// src: <doc path> · next 16.3.8 · <date>`.
- Browser specs never reach the real `/api/contact`. Every call is answered by `page.route`, and a context guard aborts and fails any call a test did not route (the R39 pattern of `e2e/leads/lead-form.spec.ts`).
- The cron worker runs once a day on Hobby (R180). The alert relies on the send made right after the answer; the worker is only the retry net (R174). Text this slice adds says "the next cron run" and links `docs/deployment.md#email-outbox-worker-task-8a`; it says "once a day" only in a file the R180 restore sentence of `docs/deployment.md` lists.

## Rulings

- **R158 Route `/contact`.** A server page, with every string CMS-controlled and a repository fallback. It is added to the sitemap and follows the site's existing indexing rules. The footer gets a "Contact us" link to `/contact` whenever the form is open. The existing footer mailto (CMS `contactEmail`) stays as it is.
- **R159 Storage.** A NEW migration (the next number after the existing ones; applied migrations are never edited) creates `contact_messages` with forced RLS and no anon/authenticated policies. A `security definer` RPC with `set search_path = ''`, executable only by `service_role`, inserts the message AND its outbox row in one transaction. No raw IP is stored (it is hashed, as for leads). The rate limit is DB-backed and uses the existing limiter, with buckets per IP and global (numbers: R171). A honeypot hit gets the same generic 400 as leads and nothing is stored. The route accepts JSON only, has a body size limit, and validates with zod, with field error codes like leads.
- **R160 Delivery.** Exactly one staff-alert email per message, through an outbox (R169: its own table, not a kind of the lead outbox), to the existing staff-alert recipient env, with Reply-To set to the sender's address (R172) and the topic in the subject. NO email goes to the sender (an anonymous form cannot prove address ownership, so sending one would make us a relay). The success copy says the message was received, never that it was emailed. `persisted: true` only after the DB confirmed both rows.
- **R161 Availability.** The form is OPEN only when Supabase AND email sending are configured (otherwise nobody would ever read the message; exact condition: R173). When closed, the page shows the CMS contact email as a mailto if one is set, else a plain closed notice, and the API answers 503 in the same JSON shape. `/api/readiness` gains a `contact` boolean.
- **R162 Fields.** Name (required, ≤ 80), email (required, reusing `EMAIL_PATTERN` and its limits), topic (enum: `general`, `partnerships`, `press`, `shop-order`, `privacy`), message (required, 10–3000 characters) and a honeypot. Grown-ups only: no child data and no age field, and the copy addresses parents and other grown-ups. No consent checkbox; a link to the privacy notice sits under the submit button.
- **R163 CMS.** The page and form copy is modelled the same way as the lead form's (Studio schema + normalize + fallback + types). The Studio typecheck and build must stay green. After merge, the owner must redeploy the Studio and the schema.
- **R164 Legal.** The fallback legal text (`lib/content/legal-fallback.ts`) lists the new table and what it holds, and states no retention period (R174). `tests/content/legal-pages.test.tsx` asserts it.
- **R165 Branch inventory.** Enumerate every place in the codebase that switches or filters on the outbox or its kinds, or uses elimination logic (`!== 'x'`), list each by file:line, and say what each must do with the contact alert. Under R169 this is the inventory of a third outbox, below.
- **R166 Analytics.** One consent-gated PostHog event on a successful submit, with no PII, following the `lib/analytics` conventions.
- **R167 Tests.** TDD for every task (failing test first). Unit and route tests mirror `tests/leads/*`; migration tests mirror the migration-policy and pgTAP harness; e2e specs under `e2e/` answer every `/api/contact` call with `page.route` and keep the unrouted-call guard; a11y checks (labels, error summary, focus to the summary on error) match LeadForm. A second `role="status"` inside a form breaks the existing e2e locators.
- **R168 Deferred: an admin inbox page for messages.** Trigger: the owner asks, or more than 20 messages arrive in a week. Until then, staff read each message in its alert email, or by SQL when an alert is parked (`docs/incident-runbook.md`).
- **R169 Separate outbox table.** Contact staff alerts go in a new table `contact_message_deliveries` (forced RLS, no anon/authenticated policies). Its row is enqueued inside the submit RPC. It has its own `security definer` claim and record functions with `set search_path = ''`, executable only by `service_role`. It mirrors the lead outbox's columns and semantics: attempts, `next_attempt_at` with the same capped backoff, the `claimed_at`/`sending` lease, `unconfirmed_since` with parking outside the 23-hour idempotency window, the final-failure codes, and an idempotency key derived from the row id. `lead_delivery_events`, its constraints, `record_lead_delivery_attempt`, `LEAD_DELIVERY_KINDS` and the lead and consent tables are NOT altered at all. The worker gains a third outbox, `contact`, beside `leads` and `orders`.
- **R170 Send budget.** Contact alerts spend their own budget, `send:contact_staff_alert`, with the same `LEAD_ACK_SEND_LIMIT_PER_HOUR` cap.
- **R171 Rate limits.** 3 messages per 10 minutes per client (IPv6 per /64, as leads) and 100 per hour globally.
- **R172 Reply-To.** The contact staff alert, and only it, sets Reply-To to the sender's address, and its body labels the address "unverified". This is the documented exception to review M3 (`lib/outbox/leads.ts:47`): answering the sender is the point of the alert. The signup and order staff alerts keep no reply-to.
- **R173 Open condition.** Supabase configured AND email sending configured (`RESEND_API_KEY` + `RESEND_FROM`) AND `STAFF_NOTIFICATION_EMAIL` AND a valid `LEAD_IP_HASH_SECRET` (32+ characters). `/api/readiness` `contact` reflects exactly that.
- **R174 Legal basis and retry.** Legitimate interest is the basis. No retention period is stated; the legal review owns it, and the docs task adds it to the open items of `docs/data-protection.md`. A daily retry for contact alerts is accepted: the immediate send after submit is the main path.
- **R175 No `skipped` status.** A contact message cannot be withdrawn, so the contact outbox has no `skipped` status and its claim always reports `"skipped": 0`.
- **R176 Housekeeping inside this slice.** Task 0 also fixes the orphaned doc comment at `lib/outbox/constants.ts` (the comment attached to nothing, directly above another doc comment), since Task 0 edits that file anyway. Task 6 adds `docs/database-security.md` to the R180 list of files to change when `*/15` is restored, and pins the list.
- **R177 Staff address removed.** If `STAFF_NOTIFICATION_EMAIL` is removed after messages were queued, their alerts wait (never parked) and readiness reports `contact: false`; the form is closed by R173. Task 6 documents this in `docs/incident-runbook.md`. The worker drains contact alerts without `LEAD_IP_HASH_SECRET`; only the form needs it.

### Decisions this plan makes where the code and the rulings meet

- **No `skipped` status in the contact outbox.** Nothing refuses a contact alert (there is no withdrawal), so the status check is `pending, sending, sent, failed`, and the claim always answers `"skipped": 0`. `OUTBOX_STATUSES` is unchanged. Everything else mirrors 0006's lead outbox (R169).
- **The contact claim takes no kinds array.** The table holds one kind, by a positive list (`kind in ('contact_staff_alert')`), so the signature is `claim_contact_deliveries(p_limit, p_message_id)`. The adapter answers an empty batch without calling the RPC when `kinds` is empty.
- **The `kind` column stays.** `ClaimedItem` needs a kind, the send budget is keyed by it, and the logs name it. `unique (message_id, kind)` gives one alert per message, as `unique (lead_id, kind)` does for leads.
- **Logging, as orders do it.** The submit flow logs its own `contact_*` events through `logContactEvent` (scope `contact`). The send after the answer logs its outbox events through `outboxLogger("contact")`; the cron run logs every outbox through `outboxLogger("worker")`.
- **Drain order.** Orders (quotes first), then signups, then contact alerts. When the run's 40 seconds run out, a staff alert waits behind emails to buyers and parents.
- **The 0008 guard** checks for `public.outbox_failure_unconfirmed(text)` (0006, which 0008's record function calls) and `public.is_active_staff()` (0007, the last migration).
- **R158 vs R12.** The CMS owns the page heading, intro, SEO, button label, success, error and closed messages, and the footer link label. Field labels, hints, validation messages, topic labels and status words are repository chrome, exactly like `FORM_COPY` for the lead form (R163: "modelled the same way").
- **R159, "never edit applied migrations".** No migration has been applied to a live project yet (R124). Even so, this slice adds 0008 and leaves 0001–0007 alone. The harness applies every migration twice, so 0008 must be idempotent.
- **R161, the closed API.** It answers `503 { ok: false, persisted: false, closed: true, message }`. The API's `message` strings are informational code constants. The form never shows them: it maps each status to its CMS or chrome copy, so every visible string stays CMS- or chrome-controlled.

## Review Focus

1. **Line breaks and non-BMP characters at the length limits.** Think of a textarea value with CRLF line ends, or emoji, at exactly 10 or 3000 characters. The browser, zod and SQL must agree (code points, counted after CRLF→LF and trimming), so nothing passes the browser check and then fails with a 500. Pinned by T0's shared case table (used by T0 and T2) and by T1's pgTAP: a 3000-code-point emoji message is accepted, 3001 is refused.
2. **Hostile text reaching the staff inbox:** `<script>` in the message, a CR or LF in the name, or a 3000-character unbroken word. The name refuses control characters, every value is escaped, the subject carries only the topic label, and long words wrap. Pinned by T2's `contact-emails` tests.
3. **A retried alert must be byte-identical:** Resend refuses a reused idempotency key with a different body. Building the alert twice from one claimed row must give the same message, and nothing may depend on the attempt number or the send path. Pinned by T2's channel and email tests.
4. **Double submit on a slow network:** a double click, or Enter pressed twice while saving. The browser must send exactly one request (the pending guard and the disabled button); the per-client limit bounds scripted repeats. Pinned by T4.
5. **The form closes after the page rendered,** or while alerts are pending: the staff address or the Resend key is removed. The API answers 503 `closed`, and the form shows the CMS closed copy. Pending alerts wait, because the worker claims no contact row without a staff address (and does not run without Resend), and readiness shows `contact: false`. Nothing is parked silently. Pinned by T4 (the closed answer) and T2 (the worker and the cron route with no staff address).

## Contracts

Every name below is fixed. A task creates only the files it owns (see the task graph) and imports the rest.

### C1. Field rules, browser-safe: `lib/contact/fields.ts` (Task 0)

No Zod, no `server-only`, no `process.env` in this file: the client form imports it.

- `CONTACT_PATH = "/contact"`, `CONTACT_API_PATH = "/api/contact"`.
- `CONTACT_TOPICS = ["general", "partnerships", "press", "shop-order", "privacy"] as const`; `type ContactTopic`.
- `CONTACT_TOPIC_LABELS satisfies Record<ContactTopic, string>`: `general` "A general question", `partnerships` "Partnerships", `press` "Press and media", `shop-order` "Shop and orders", `privacy` "Privacy and your details". These are UI chrome (R12), shared by the form and the staff alert.
- `CONTACT_LIMITS = { name: 80, email: LEAD_LIMITS.email, messageMin: 10, messageMax: 3000 } as const` (email is 254).
- `type ContactField = "name" | "email" | "topic" | "message"`; `CONTACT_FIELD_ORDER: readonly ContactField[]` in that order.
- `type ContactFieldErrorCode = "required" | "invalid" | "too_short" | "too_long"`; `type ContactFieldErrors = Partial<Record<ContactField, ContactFieldErrorCode>>`.
- `interface ContactFieldValues { name: string; email: string; topic: string; message: string }`.
- Re-exports `HONEYPOT_FIELD` (`"website"`) from `lib/leads/fields.ts`.
- `characterCount(value: string): number`: code points (`Array.from(value).length`), which is what Postgres `char_length` counts.
- `normalizeMessage(value: string): string`: replaces `\r\n` and lone `\r` with `\n`, then `trim()`.
- `isContactTopic(value: unknown): value is ContactTopic`.
- `isSafeMessage(value: string): boolean`: false for any control character other than `\n` and `\t`, i.e. `/[\u0000-\u0008\u000b-\u001f\u007f]/`.
- `checkContactFields(values: ContactFieldValues): ContactFieldErrors`, giving the first problem per field in this order:

| Field | Normalise | `required` | `too_short` | `too_long` | `invalid` |
|---|---|---|---|---|---|
| name | `trim()` | empty | | `characterCount > 80` | `!isSafeFirstName` (`lib/leads/fields.ts:67`) |
| email | `normalizeEmail` | empty | | `length > 254` | `!EMAIL_PATTERN.test` (`lib/leads/fields.ts:39`) |
| topic | `trim()` | empty | | | `!isContactTopic` |
| message | `normalizeMessage` | empty | `characterCount < 10` | `characterCount > 3000` | `!isSafeMessage` |

- `interface ContactApiBody { ok: boolean; persisted: boolean; message: string; fieldErrors?: ContactFieldErrors; closed?: true }`.

### C2. Server types and the outbox vocabulary (Task 0)

`lib/contact/types.ts` (types only):

```ts
export interface ContactRecordInput { name: string; email: string; topic: ContactTopic; message: string }
export interface ContactRepository extends ContactDeliveryOutbox {
  /** Resolves only once the message and its outbox row are both stored (one RPC, one transaction). */
  submitMessage(record: ContactRecordInput): Promise<{ messageId: string; deliveryId: string }>;
}
```

`lib/outbox/constants.ts` additions (R169, R170):

- `CONTACT_DELIVERY_KINDS = ["contact_staff_alert"] as const`; `type ContactDeliveryKind`.
- `type OutboxName = "leads" | "orders" | "contact"`; its comment says "The three outboxes".
- `SEND_BUDGETS.contact = { contact_staff_alert: "contact_staff_alert" }`. The `satisfies` clause gains `contact: Record<ContactDeliveryKind, string>`, and `SendBudget` gains `(typeof SEND_BUDGETS.contact)[ContactDeliveryKind]`, so `sendBudgetKey` gives `send:contact_staff_alert`. The bucket list in the `SEND_BUDGETS` comment gains `send:contact_staff_alert   the contact staff alert (public form)`.
- `sendBudgetFor` keeps its body. `LEAD_DELIVERY_KINDS`, `ORDER_EMAIL_KINDS`, `OUTBOX_STATUSES`, `OUTBOX_LIMITS`, `OUTBOX_FINAL_FAILURE_CODES`, `PROVIDER_REFUSAL_CODES`, `WORKER_LIMITS` and the R180 cron comment (`:65`) are unchanged.

`lib/outbox/types.ts` additions (its module comment also names `lib/supabase/contact.ts` and migration 0008):

```ts
export interface ClaimedContactDelivery { id: string; kind: ContactDeliveryKind; attempt: number; name: string; email: string; topic: ContactTopic; message: string; receivedAt: string }
/** The contact outbox through migration 0008's RPCs. */
export interface ContactDeliveryOutbox {
  claimDeliveries(options: ClaimOptions<ContactDeliveryKind>): Promise<ClaimBatch<ClaimedContactDelivery>>;
  /** False when the row was no longer claimed (already recorded, or parked). */
  recordDeliveryAttempt(deliveryId: string, outcome: OutboxOutcome): Promise<boolean>;
}
```

### C3. Availability: `lib/contact/availability.ts` (Task 0, `server-only`)

`contactFormOpen(env: Readonly<Record<string, string | undefined>> = process.env): boolean` returns `leadStorageConfigured` (Supabase URL, a service-role key that is not `sb_publishable_…`, and a `LEAD_IP_HASH_SECRET` of 32+ characters) AND `getEmailEnvironment(env) !== null` AND `getStaffNotificationEmail(env) !== null`, each called with a copy of `env` (R173). It is the one definition used by the route, readiness, the page, the footer, the sitemap and the legal text.

### C4. Database: `supabase/migrations/0008_contact_messages.sql` (Task 1)

The guard, as in 0006: the migration runs as a role with BYPASSRLS (`42501` "Migration 0008 must run as a role that bypasses row level security (Supabase: postgres)." otherwise), and `to_regprocedure('public.outbox_failure_unconfirmed(text)')` and `to_regprocedure('public.is_active_staff()')` both exist (`55000` "Migrations 0001 to 0007 must be applied before 0008." otherwise). Every statement is idempotent (`create table if not exists`, `create index if not exists`, `create or replace function`, `revoke`, `grant`). The file names no lead object: not `lead_delivery_events`, `lead_submissions`, `enqueue_lead_delivery`, `claim_lead_deliveries`, `record_lead_delivery_attempt` or `submit_lead` (R169).

Both tables: RLS enabled and forced; all privileges revoked from `public, anon, authenticated, service_role`; no policies.

`public.contact_messages`, index `contact_messages_created_at_idx (created_at desc)`:

| Column | Type | Constraint |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `name` | `text not null` | 1–80 characters, no `<` or `>`, no control character |
| `email` | `text not null` | `= lower(btrim(email))`; 3–254 characters; `~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'` |
| `topic` | `text not null` | `in ('general', 'partnerships', 'press', 'shop-order', 'privacy')` |
| `message` | `text not null` | `char_length` 10–3000; `!~ '[\x01-\x08\x0b-\x1f\x7f]'` (LF and TAB allowed) |
| `created_at` | `timestamptz not null default now()` | |

`public.contact_message_deliveries`, the contact outbox (R169), mirroring `lead_delivery_events` (0001:78-96, 0006:72-79). Index `contact_message_deliveries_due_idx (next_attempt_at) where status in ('pending', 'sending', 'failed')`.

| Column | Type | Constraint |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | the idempotency key is `contact-delivery/<id>` (C6) |
| `message_id` | `uuid not null references public.contact_messages (id) on delete cascade` | |
| `kind` | `text not null` | `contact_message_deliveries_kind_values`: `kind in ('contact_staff_alert')` |
| `status` | `text not null default 'pending'` | `in ('pending', 'sending', 'sent', 'failed')` |
| `attempts` | `integer not null default 0` | `between 0 and 1000` |
| `last_attempt_at` | `timestamptz` | |
| `next_attempt_at` | `timestamptz not null default now()` | `'infinity'` is the parked marker |
| `provider_message_id` | `text` | null or 1–200 characters |
| `last_error_code` | `text` | null or `~ '^[A-Za-z0-9_]{1,60}$'` |
| `unconfirmed_since` | `timestamptz` | |
| `claimed_at` | `timestamptz` | |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Plus `contact_message_deliveries_message_kind_key unique (message_id, kind)`: one alert per message.

Functions. Each is `language plpgsql`, `security definer`, `set search_path = ''`, revoked from `public, anon, authenticated`, and executable by `service_role` only. Errors use `22023` and name the field, never the value.

| Signature | Returns | Rules |
|---|---|---|
| `submit_contact_message(p_name text, p_email text, p_topic text, p_message text)` | `table (message_id uuid, delivery_id uuid)` | `#variable_conflict use_column` (the output name `message_id` is also a column). Trims the name, and lower-cases and trims the email (as `submit_lead` does). Validates the message as given (the server sends it normalised). Inserts the message, then `contact_message_deliveries (message_id, kind, status, attempts) = (<id>, 'contact_staff_alert', 'pending', 0)`. |
| `claim_contact_deliveries(p_limit integer default 10, p_message_id uuid default null)` | `jsonb {"claimed": [...], "skipped": 0, "expired": <n>}` | `p_limit` must be 1–50 (`22023`). The due rule, the 15-minute stale `sending` lease, the park rule (`attempts >= 8`, or unconfirmed for 23 hours, as `stale_unconfirmed` with `next_attempt_at = 'infinity'`) and the claim update are those of `claim_lead_deliveries` (0006:226-324) on `contact_message_deliveries` joined to `contact_messages`, with no withdrawal branch and no acknowledgement mirror; `order by next_attempt_at, created_at, id`; `for update of delivery skip locked`. Each claimed entry is `{id, kind, attempt, name, email, topic, message, receivedAt}`, where `receivedAt` is the message's `created_at` as a JSON string. |
| `record_contact_delivery_attempt(p_delivery_id uuid, p_status text, p_provider_message_id text default null, p_error_code text default null)` | `boolean` | Validation and update are those of `record_lead_delivery_attempt` (0006:340-403) on `contact_message_deliveries`: `sent`, `failed` (backoff `least(interval '6 hours', interval '1 minute' * power(2, least(delivery.attempts, 12)))`; `'infinity'` at the eighth attempt or on `invalid_idempotent_request`; `unconfirmed_since` set through `public.outbox_failure_unconfirmed`), and `deferred` (back to the earlier status and attempt count). Only a `sending` row is updated. Returns `found`. |

### C5. API: `POST /api/contact` (Task 2)

- The request has `content-type: application/json` and is at most `CONTACT_BODY_LIMIT_BYTES = 32 * 1024` bytes. The body is a strict object: `{ "name": string, "email": string, "topic": ContactTopic, "message": string, "website"?: "" }`. Any other key rejects the whole body.
- The response is a `ContactApiBody`, with `cache-control: no-store`, plus `retry-after: <seconds>` on a 429.

| Status | When | Body |
|---|---|---|
| 200 | the RPC returned both ids | `{ ok: true, persisted: true, message: CONTACT_API_MESSAGES.received }` |
| 400 | field problems | `{ ok: false, persisted: false, message: checkDetails, fieldErrors }` |
| 400 | honeypot filled, bad JSON, not an object, unexpected keys | `{ ok: false, persisted: false, message: error }` (no `fieldErrors`) |
| 413 / 415 | body too large / not JSON | `{ ok: false, persisted: false, message: error }` |
| 429 | the per-client or the global limit is spent | `{ ok: false, persisted: false, message: rateLimited }` |
| 500 | the write failed, or an unexpected throw (reported with `reportError(error, { area: "contact", event: "contact_route_failed" })`) | `{ ok: false, persisted: false, message: error }` |
| 503 | the form is closed (`open` false, or no repository) | `{ ok: false, persisted: false, closed: true, message: closed }` |
| 503 | the limiter is missing or throws (fails closed) | `{ ok: false, persisted: false, message: error }` |

The order of checks (`lib/contact/submit.ts`): honeypot → validation → open → `contact:<clientKey>` (3 per 600 s) → `contact:global` (100 per 3600 s) (R171) → `submitMessage` → answer → `after()`: `sendAlert(messageId)`, which claims this message's alert by id, spends `send:contact_staff_alert`, sends and records (C6).

`CONTACT_API_MESSAGES` (informational; the form never shows them): `received` "Message received.", `error` "The message could not be saved. Please try again.", `closed` "The contact form is not open, so nothing was saved.", `rateLimited` "Too many messages just now. Please wait a few minutes and try again.", `checkDetails` "Please check the highlighted fields and try again."

`ContactSubmissionDependencies` (`lib/contact/submit.ts`, the shape of `OrderSubmissionDependencies`, `lib/orders/submit.ts:95-122`): `{ open: boolean; repository: ContactRepository | null; rateLimiter: RateLimiter | null; clientKey: string; log: (event: ContactLogEvent) => void; sendAlert?: ((messageId: string) => Promise<void>) | null; runAfterResponse?: (task: () => Promise<void>) => void }`. A `sendAlert` that throws is caught: the row stays due for the worker, and the answer is unchanged.

`ContactLogEvent` is one of `contact_stored`, `contact_store_failed {code}`, `contact_rate_limited {scope: "client" | "global"}`, `contact_rate_limit_unavailable {code}`, `contact_unconfigured` or `contact_honeypot`: names, codes and scopes only. `logContactEvent` writes one JSON line `{ scope: "contact", ...entry }`; warnings (`/_(failed|unavailable|unconfigured|invalid)$/`) also go to Sentry through `reportEvent`, like `logLeadEvent` (`lib/leads/dependencies.ts:84`).

### C6. The contact outbox, its channel and the alert (Task 2)

- The outbox is named `contact` (`OutboxName`); its table is `contact_message_deliveries`; its one kind is `contact_staff_alert`; the idempotency key is `contact-delivery/<row id>`; it spends `send:contact_staff_alert`, capped by `LEAD_ACK_SEND_LIMIT_PER_HOUR` (default 60, R170).
- `interface ContactChannelSettings { staffEmail: string | null }`.
- `contactKindsFor(staffEmail: string | null): ContactDeliveryKind[]` is `staffEmail ? ["contact_staff_alert"] : []`.
- `contactAlertChannel(outbox: ContactDeliveryOutbox, settings: ContactChannelSettings): OutboxChannel<ContactDeliveryKind, ClaimedContactDelivery>` has `name: "contact"` and builds `{ to: [staffEmail], replyTo: item.email, ...buildStaffContactAlert(item) }`, or `null` without a staff address. It reads no other setting, so the message depends on the row alone.
- `createContactAlertSender(outbox, settings, context: AttemptContext<ContactDeliveryKind>): (messageId: string) => Promise<void>` runs `attemptNow(channel, messageId, contactKindsFor(settings.staffEmail), context)`, like `createOrderEmailSender` (`lib/outbox/orders.ts:54-64`).
- `buildStaffContactAlert({ name, email, topic, message, receivedAt }): RenderedEmail` (`lib/email/contact-emails.ts`, reusing `escapeHtml`, `shell` and `paragraph` from `lib/email/lead-emails.ts`):
  - Subject: exactly `New BIBO Bay message: ${CONTACT_TOPIC_LABELS[topic]}`, never any submitted text.
  - Intro: "A message arrived through the contact form on the BIBO Bay website."
  - Rows: "Name", "Email (unverified)", "Topic" (the label), and "Received" (`formatReceivedAt(receivedAt)`, giving `YYYY-MM-DD HH:MM UTC`).
  - Note: "Replying to this email writes to the address above. Nothing on the form proves the sender owns it." (R172)
  - Then "Message", with the message escaped, in a block styled `white-space:pre-wrap;overflow-wrap:anywhere`.
  - The text part has the same rows, then a blank line, "Message:" and the message verbatim.
  - The output depends only on its input, so every attempt of a row builds the same message.

### C7. CMS copy (Task 3)

`lib/content/types.ts`:

```ts
export interface ContactPageContent { seo: Seo; heading: string; description: string; buttonLabel: string; successMessage: string; errorMessage: string; closedMessage: string; emailIntro: string }
```

`SiteSettings.footer` gains `contactPageLabel: string`.

`SAFE_FALLBACK_CONTACT_PAGE` (`lib/content/fallback.ts`):

- `seo`: `{ title: "Contact BIBO Bay", description: "Write to the BIBO Bay team with a question, a partnership idea or a press enquiry." }`
- `heading` "Contact us"
- `description` "Questions, ideas and press enquiries from grown-ups are welcome. Please write as a parent, carer or professional, and leave out any details about a child."
- `buttonLabel` "Send message"
- `successMessage` "Thank you. We have received your message."
- `errorMessage` "We could not save your message. Please try again."
- `closedMessage` "The contact form is not open yet, so no message can be saved from this page. Please check back soon."
- `emailIntro` "The contact form is not open yet. You can write to us at:"

The footer's `contactPageLabel` falls back to "Contact us".

`DELIVERY_CLAIM_PATTERN = /\b(sent|emailed|deliver(ed|y)?|inbox|check your (email|mail)|we('ve| have) emailed)\b/i` lives in `lib/content/claims.ts`. `normalizeContactPage` replaces a CMS `successMessage` that matches it with the fallback. The Studio keeps its own copy, pinned to this one.

Sanity: a singleton document `contactPage` ("Contact page") with the fields above (`seo` type `seo`; text fields). `successMessage` validation calls `deliveryClaimProblem` (`studio/schemaTypes/contact.ts`). `footerSettings` gains `contactPageLabel` ("Contact page link label").

### C8. Form chrome: `components/forms/contact-copy.ts` (Task 4)

`CONTACT_FORM_COPY`:

- `formLabel` "Contact BIBO Bay"
- `name.label` "Your name"
- `email.label` "Your email"; `email.hint` "We use it only to reply to you."
- `topic.label` "What is it about?"; `topic.placeholder` "Choose a topic"
- `message.label` "Your message"; `message.hint` "Please leave out any details about a child. Between 10 and 3,000 characters."
- `privacyLink` "How we handle your details"
- `sending` "Saving your message…"
- `errorSummaryTitle` "Please check the form"
- `outcome.rateLimited` "Several messages have been sent from here just now. Please wait a few minutes and try again."
- `noScript` "This form needs JavaScript. Turn it on in your browser to send a message."
- `honeypotLabel` "Leave this field empty"

`errors`:

- `name`: required "Enter your name.", invalid "Use your name only, without links or the characters < and >.", too_long "Keep your name under 80 characters."
- `email`: required "Enter your email.", invalid "Enter an email like name@example.com.", too_long "That email is too long."
- `topic`: required and invalid "Choose what your message is about."
- `message`: required "Write your message.", too_short "Write at least 10 characters.", too_long "Keep your message under 3,000 characters.", invalid "Remove the unusual characters from your message."

`contactFieldErrorMessage(field, code)` falls back to the field's first message, as `fieldErrorMessage` does.

### C9. The form's DOM contract (Task 4; Task 5's e2e locates by it)

- `<form id="contact-form" aria-label="Contact BIBO Bay" method="post" noValidate>`.
- Labelled `input[name=name]` (`autocomplete="name"`), `input[name=email][type=email]`, `select[name=topic]` (first option empty), and `textarea[name=message]`.
- The submit button `button[type=submit]` is disabled until hydrated and while pending, with `aria-busy` while pending.
- The error summary is `role="group"`, named "Please check the form", with `tabIndex={-1}`, focused after every failed submit, and links to each field. A field error is `<p id="<field id>-error">`, tied to its field by `aria-describedby`.
- There is exactly one `role="status"` element (`aria-live="polite"`, never focused). Its height is reserved with the `lead-form__outcome` data-attribute technique.
- The honeypot wrapper is `aria-hidden="true"`, with `input[name=website]`, `tabIndex={-1}` and `autoComplete="off"`.
- A `Link` to `/privacy` follows the submit button.

### C10. Analytics and readiness

- `lib/analytics/events.ts`: `contact_submitted: ["persisted", "topic"]`. The form calls `track("contact_submitted", { persisted: true, topic })` once, after a persisted answer only (Task 4).
- `Readiness.contact: boolean` is `contactFormOpen(env)` (R173). It is reported, not required: `ready` is unchanged (Task 2).

## R165: the third outbox, place by place

R169 puts the contact alert in its own outbox, so nothing that reads `lead_delivery_events` or a lead kind can meet a contact row. What changes is every place keyed on the outbox name, the outbox list, the send budgets or the outbox log channel.

### TypeScript

| # | Where | Keyed on | What it does with `contact` | Task |
|---|---|---|---|---|
| 1 | `lib/outbox/constants.ts:18-19` | `OutboxName` | Gains `"contact"` | T0 |
| 2 | `lib/outbox/constants.ts:21-40` | `SEND_BUDGETS`, its `satisfies` clause, `SendBudget` | Gain the `contact` entry and its budget, `contact_staff_alert` (R170) | T0 |
| 3 | `lib/outbox/constants.ts:42-46` | `sendBudgetFor(outbox, kind)` | No edit. Answers `contact_staff_alert` for `("contact", "contact_staff_alert")`, and `null` for any other kind in `contact` and for `contact_staff_alert` in `leads` or `orders`, so `reserve` fails closed with `unknown_budget` (`lib/outbox/send.ts:31-35`) | T0 (test) |
| 4 | `lib/outbox/constants.ts:10-12` | `LEAD_DELIVERY_KINDS` | Unchanged (R169; pinned to 0006 by `tests/outbox/migration-policy.test.ts:98`). `CONTACT_DELIVERY_KINDS` sits beside it | T0 |
| 5 | `lib/outbox/attempt.ts:34`, `:44-59`, `:66` | `OutboxChannel.name: OutboxName`, `OutboxLogEvent` (`budget: SendBudget`), `reserve(kind, outbox: OutboxName)` | No edit: the types widen with #1 and #2. `attemptNext` (`:122`), `attemptNow` (`:171`) and `drainChannel` (`:188`) run the contact channel as they are | none |
| 6 | `lib/outbox/send.ts:16-48` | `budgetedSends` → `sendBudgetFor(outbox, kind)` | No edit. The send after the answer and the worker spend `send:contact_staff_alert` through it | none |
| 7 | `lib/outbox/worker.ts:20-30` | `OutboxWorkerInput` (`leads`, `orders`), `context: AttemptContext<LeadDeliveryKind \| OrderEmailKind>` | Gains a required `contact: { outbox: ContactDeliveryOutbox; settings: ContactChannelSettings }`; the context union gains `ContactDeliveryKind` | T2 |
| 8 | `lib/outbox/worker.ts:32-47`, comment `:7-18` | the drain sequence and `addTally` | Drains `contactAlertChannel` with `contactKindsFor(contact.settings.staffEmail)` after the signup outbox, and returns the sum of the three tallies. Without a staff address it claims nothing from `contact` | T2 |
| 9 | `lib/outbox/dependencies.ts:12`, `:33` | `budgetedSends<LeadDeliveryKind \| OrderEmailKind>` | The union gains `ContactDeliveryKind` | T2 |
| 10 | `lib/outbox/dependencies.ts:17-55` | the worker wiring | Passes `contact: { outbox: createSupabaseContactRepository(client), settings: { staffEmail } }`. Still `null` without Supabase or Resend (the rows wait). Contact needs no `LEAD_IP_HASH_SECRET` here | T2 |
| 11 | `lib/outbox/log.ts:8-18` | `outboxLogger(channel: "leads" \| "orders" \| "worker")` and its comment | Gains `"contact"`; `lib/contact/dependencies.ts` passes `outboxLogger("contact")` to the send after the answer. The Sentry tags stay event, kind, budget and code | T2 |
| 12 | `lib/outbox/log.ts:35-37`, `app/api/cron/email-outbox/route.ts:34-38` | `logWorkerRun(tally)`; the route's `{ sent, failed, skipped, deferred }` | No edit: the worker's summed tally includes contact rows. `tests/outbox/cron-route.test.ts` gains a contact case | T2 (test) |
| 13 | `lib/supabase/outbox.ts:15-28` | module-private `isUuid`, `isText`, `isAttempt`, `batchFrom` | Exported, with no change in behaviour, for `lib/supabase/contact.ts`, which also imports `outcomeArguments` (`:74`) and `recordedFrom` (`:83`). `leadDelivery` (`:30-37`) and the order parsers are unchanged | T1 |
| 14 | `lib/outbox/leads.ts:28`, `:38-60` (an elimination `if (item.kind === "acknowledgement") … else` staff alert); `lib/leads/submit.ts:43`, `:215` (`sendBudgetFor("leads", kind)`), `:372`; `lib/supabase/leads.ts:9` | lead kinds | Unchanged (R169). They are typed `LeadDeliveryKind` and fed only by `lead_delivery_events`, so no contact row can reach the elimination | none |
| 15 | `lib/outbox/orders.ts:21-46`, `:60`; `lib/orders/dependencies.ts:99` and `lib/admin/dependencies.ts:42` (`outboxLogger("orders")`); `lib/orders/admin.ts:453`; `app/admin/orders/[reference]/page.tsx:210` | order kinds | Order outbox only; unchanged | none |
| 16 | `tests/outbox/worker.test.ts:78-167` | every `runOutboxWorker` call | `contact` is now required: each existing call gains an empty contact outbox with `staffEmail: null` | T2 |
| 17 | `tests/scripts/docs-claims.test.ts:360`, `:375` | buckets built from `SEND_BUDGETS.leads` and `.orders` (`toHaveLength(5)`) | Built from every outbox (`Object.values(SEND_BUDGETS).flatMap((budgets) => Object.values(budgets))`, length 6), so the docs must name `send:contact_staff_alert` | T6 |

### SQL

| # | Where | What | Task |
|---|---|---|---|
| S1 | `supabase/migrations/0008_contact_messages.sql` (new) | `submit_contact_message`, `claim_contact_deliveries` and `record_contact_delivery_attempt` (C4). The kind is a positive list; no branch uses `<>`, `!=` or `not in` on a kind | T1 |
| S2 | `supabase/tests/0006_catalogue.sql:118-131` | The explicit list of functions `service_role` may execute gains `claim_contact_deliveries(integer, uuid)`, `record_contact_delivery_attempt(uuid, text, text, text)` and `submit_contact_message(text, text, text, text)` in `collate "C"` order; the description becomes "(migrations 0001-0008)". The forced-RLS sweep (`:41-45`) and the `service_role` table-privilege sweep (`:81-88`) cover both new tables with no edit | T1 |
| S3 | `0001:78-96`, `0006:72-79`, `0006:161-406` | The lead outbox table, its constraints and its four functions | Not altered (R169). T1's static gate asserts 0008 names none of them; its pgTAP asserts `lead_delivery_events.lead_id` is still `not null` and the table has no `message_id` or `contact_message_id` column |

## Task graph and file ownership

```
Task 0 (controller, first) ─┬─ Task 1 database + adapter ──┐
                            ├─ Task 2 server (gate needs T1's lib/supabase/contact.ts)
                            └─ Task 3 CMS model ── Task 4 form ┴─ Task 5 page + wiring ── Task 6 docs
```

There are at most three implementers at once: T1, T2, and T3 followed by T4 in the third lane. T5 starts when T1–T4 have landed (its controller checks call the real route), and T6 when everything else has. No file appears in two tasks.

---

### Task 0: Shared contracts (the controller writes it before fanning out)

**Files:**
- Create: `lib/contact/fields.ts`, `lib/contact/types.ts`, `lib/contact/availability.ts`, `tests/contact/field-cases.ts`, `tests/contact/contact-fields.test.ts`, `tests/contact/availability.test.ts`, `tests/contact/outbox-vocabulary.test.ts`
- Modify: `lib/outbox/constants.ts:10-49` (C2), `lib/outbox/types.ts` (C2)

**Interfaces:**
- Produces: everything in C1, C2 and C3. `tests/contact/field-cases.ts` exports `CONTACT_FIELD_CASES: ReadonlyArray<{ label: string; values: ContactFieldValues; errors: ContactFieldErrors }>`, which T2's schema test reuses so that the browser and the server agree.

- [ ] **Step 1: Write the failing tests.**
  - `field-cases.ts` holds a valid base (`{ name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent." }`) and one case per cell of the C1 table. The edge cases: `"a".repeat(81)` (name `too_long`); `"Ada <b>"`, `"see https://x.example"` and `"Ada\nBcc: x"` (name `invalid`); `"🐢".repeat(10)` (message passes: 10 code points, 20 UTF-16 units); `"🐢".repeat(3001)` (`too_long`); `"a".repeat(3000)` (passes); `"  short \r\n"` (`too_short`); `"hello\u0007there!!"` (`invalid`); `"line one\nline two\tok"` (passes); topic `"other"` (`invalid`); an email of 255 characters (`too_long`).
  - `contact-fields.test.ts`:
    - "lists the five topics in order and labels each one": `CONTACT_TOPICS` equals C1; the keys of `CONTACT_TOPIC_LABELS` equal it.
    - "counts code points, as Postgres char_length does": `characterCount("🐢🐢🐢") === 3`.
    - "normalises CRLF and CR to LF before trimming": `normalizeMessage("  a\r\nb\rc  ") === "a\nb\nc"`.
    - `it.each(CONTACT_FIELD_CASES)("$label", …)`: `checkContactFields(values)` equals `errors`.
    - "stays browser-safe": the file's source matches none of `/server-only|from "zod"|process\.env/`.
  - `availability.test.ts` (with `vi.mock("server-only", () => ({}))`):
    - "opens only with storage, email sending, a staff address and the hash secret (R173)": with all of `NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com`, a service key, a 32-character `LEAD_IP_HASH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM=BIBO Bay <hello@example.com>` and `STAFF_NOTIFICATION_EMAIL=staff@example.com` it is `true`.
    - Dropping any one of those, a 31-character secret, or an `sb_publishable_…` key each gives `false`.
  - `outbox-vocabulary.test.ts`:
    - "names three outboxes": `Object.keys(SEND_BUDGETS)` equals `["leads", "orders", "contact"]`; `CONTACT_DELIVERY_KINDS` equals `["contact_staff_alert"]`.
    - "gives the contact alert its own budget (R170)": `sendBudgetFor("contact", "contact_staff_alert") === "contact_staff_alert"`; `sendBudgetKey(...) === "send:contact_staff_alert"`.
    - "never charges a contact alert to another outbox": `sendBudgetFor("leads", "contact_staff_alert")`, `sendBudgetFor("orders", "contact_staff_alert")` and `sendBudgetFor("contact", "staff_alert")` are `null`.
    - "leaves the lead outbox's kinds alone (R169)": `LEAD_DELIVERY_KINDS` still equals `["acknowledgement", "staff_alert"]`.
- [ ] **Step 2: Run `npx vitest run tests/contact`.** Expected: FAIL (the modules do not exist).
- [ ] **Step 3: Implement C1, C2 and C3 exactly as specified.**
- [ ] **Step 4: Gate.** Run `npm run typecheck && npm run lint && npx vitest run tests/contact tests/outbox tests/leads`. Expected: all pass.
- [ ] **Step 5: Commit** these paths: `feat(contact): shared field rules, the contact outbox vocabulary and availability (R158-R173 contracts)`.

### Task 1: Database: migration 0008, pgTAP, static gate and the Supabase adapter

**Files:**
- Create: `supabase/migrations/0008_contact_messages.sql`, `supabase/tests/0007_contact_messages.sql`, `lib/supabase/contact.ts`, `tests/contact/supabase-contact-adapter.test.ts`, `tests/contact/migration-policy.test.ts`
- Modify: `lib/supabase/outbox.ts:15-28` (export `isUuid`, `isText`, `isAttempt` and `batchFrom`; no change in behaviour), `supabase/tests/0006_catalogue.sql:118-131`, `tests/orders/migration-database.test.ts`

**Interfaces:**
- Consumes: C1, C2 (`CONTACT_TOPICS`, `CONTACT_LIMITS`, `CONTACT_DELIVERY_KINDS`, `OUTBOX_LIMITS`, `OUTBOX_FINAL_FAILURE_CODES`, `ContactRepository`, `ClaimedContactDelivery`); `callRpc`, `firstRow` and `RpcError` (`lib/supabase/rpc.ts`); `outcomeArguments` and `recordedFrom` (`lib/supabase/outbox.ts:74`, `:83`); `pgliteRpc` (`tests/support/pglite-rpc.ts`); `createSupabaseStandIn`, `applyMigrations`, `migrationFiles`, `pgtapFiles`, `readPgtap`, `runTap` and `summariseTap` (`tests/support/supabase-db.ts`).
- Produces: `createSupabaseContactRepository(client: RpcClient): ContactRepository` and the SQL objects of C4. Write the adapter and the migration first (Steps 1–4), because Task 2 imports the adapter.

- [ ] **Step 1: Write the failing adapter tests** (`supabase-contact-adapter.test.ts`, mirroring `tests/outbox/supabase-outbox-adapter.test.ts`: PGlite with every migration, through `pgliteRpc`):
  - "submitMessage stores one message and its alert, and returns both ids": both ids are UUIDs.
  - "turns a database refusal into an RpcError that names only the function and code": a 9-character message gives `RpcError` with `code === "22023"`, and the error text does not contain the message.
  - "claimDeliveries claims this message's alert with exactly the contract's keys": `{ ownerId: messageId, kinds: ["contact_staff_alert"], limit: 1 }` gives one item, with `Object.keys` sorted equal to `attempt, email, id, kind, message, name, receivedAt, topic`, `attempt === 1`, `id === deliveryId` and `Date.parse(receivedAt)` finite; a second claim gives none.
  - "recordDeliveryAttempt records a sent alert and answers false the second time".
  - "claims nothing and calls no RPC for an empty kinds list".
  - "refuses a malformed claim answer as bad_response": a fake client returns `topic: "other"`; then `kind: "staff_alert"`; then a 9-character `id`.
- [ ] **Step 2: Run `npx vitest run tests/contact/supabase-contact-adapter.test.ts`.** Expected: FAIL (no module, no migration).
- [ ] **Step 3: Write `supabase/migrations/0008_contact_messages.sql` (C4) and `lib/supabase/contact.ts`.** The adapter calls `submit_contact_message({ p_name, p_email, p_topic, p_message })` (through `firstRow`; both ids must be UUIDs), `claim_contact_deliveries({ p_limit, p_message_id: ownerId ?? null })` and `record_contact_delivery_attempt({ p_delivery_id, ...outcomeArguments(outcome) })`. It rebuilds every claimed item key by key (UUID id, kind in `CONTACT_DELIVERY_KINDS`, attempt 1–1000, name 1–80 characters, non-empty email and message, topic in `CONTACT_TOPICS`, parseable `receivedAt`) through the exported `batchFrom`, and refuses anything else as `bad_response`.
- [ ] **Step 4: Run the Step 2 command.** Expected: PASS. Tell the controller that the adapter has landed (it unblocks Task 2's gate).
- [ ] **Step 5: Write the failing static gate** (`tests/contact/migration-policy.test.ts`, reading 0008 as text with CRLF stripped, like `tests/outbox/migration-policy.test.ts`). Its assertions:
  - the guard (the bypass role `42501`; `outbox_failure_unconfirmed(text)` and `is_active_staff()`; "must be applied before 0008" `55000`);
  - for each of `contact_messages` and `contact_message_deliveries`: `create table if not exists`; `enable` and `force row level security`; `revoke all ... from public, anon, authenticated, service_role`; no `create policy`; no table `grant`;
  - each of the three functions is `security definer` with `set search_path = ''`, revoked from `public, anon, authenticated`, and `grant execute ... to service_role` only;
  - the topic list in the table and the RPC equals `CONTACT_TOPICS`, and the bounds 80, 254, 10 and 3000 equal `CONTACT_LIMITS`;
  - the kind check lists exactly `CONTACT_DELIVERY_KINDS`; the status check lists exactly `pending, sending, sent, failed`, each of them in `OUTBOX_STATUSES`; the file matches no `/kind\s*(<>|!=|not in)\s*\(?'/`;
  - the claim uses `interval '15 minutes'`, `interval '23 hours'` and `attempts >= 8` (equal to `OUTBOX_LIMITS`); the record function uses the 6-hour cap `least(interval '6 hours', interval '1 minute' * power(2, least(delivery.attempts, 12)))`, `public.outbox_failure_unconfirmed` and each of `OUTBOX_FINAL_FAILURE_CODES`; it returns `found`;
  - "never names a lead object (R169)": no match for `/\blead_delivery_events\b|\blead_submissions\b|\benqueue_lead_delivery\b|\bclaim_lead_deliveries\b|\brecord_lead_delivery_attempt\b|\bsubmit_lead\b/`;
  - no column named `ip`, `inet` or `user_agent`.
- [ ] **Step 6: Write the failing pgTAP file `supabase/tests/0007_contact_messages.sql`.** Follow the harness rules: `begin; select plan(N);` … `select * from finish(); rollback;`; temp tables created under `set local role service_role`; owner-only updates after `reset role`; order by `::text collate "C"`; N equal to the asserts written. Its asserts:
  - both tables have RLS enabled and forced, and no policies;
  - `table_privs_are` is empty for `anon`, `authenticated` and `service_role` on both tables;
  - the three functions are not executable by `anon` or `authenticated`;
  - one `submit_contact_message` call stores exactly one message (email stored lower-cased) and exactly one delivery (`contact_staff_alert`, `pending`, attempts 0, `message_id` equal to the returned id, `id` equal to the returned `delivery_id`);
  - `22023`, with nothing stored, for an empty name, an 81-character name, a name with `<`, a bad email, topic `other`, a 9-character message, a 3001-code-point emoji message and a message containing `\x07`; a 3000-code-point emoji message is accepted;
  - `claim_contact_deliveries(0)` and `claim_contact_deliveries(51)` raise `22023`;
  - `claim_contact_deliveries(1, <id>)` returns one entry with exactly the C4 keys and `attempt` 1, `"skipped": 0`, and the row becomes `sending` with `claimed_at` set; a second claim returns none;
  - `record_contact_delivery_attempt(..., 'sent', 're_contact_1')` returns true and stores the provider id; a second call returns false;
  - `failed` with `rate_limit_exceeded` backs off (`next_attempt_at = now() + interval '2 minutes'` after attempt 1) with `unconfirmed_since` null; `send_timeout` sets `unconfirmed_since`; `deferred` returns the row to `pending` with attempts 0;
  - the eighth failure, and `invalid_idempotent_request`, set `next_attempt_at = 'infinity'`;
  - a `sending` row whose `claimed_at` is 16 minutes old is re-claimed with the same id and the next attempt; at 25 hours it is parked (`failed`, `stale_unconfirmed`, `next_attempt_at = 'infinity'`, `expired` = 1);
  - as the owner: a delivery of kind `staff_alert` violates `23514`, and a second `contact_staff_alert` for the same message violates `23505`;
  - deleting the message removes its delivery;
  - the lead outbox is as 0006 left it (R169): `col_not_null('public', 'lead_delivery_events', 'lead_id')`, and `hasnt_column` for `message_id` and `contact_message_id` on `lead_delivery_events`.
- [ ] **Step 7: Update the existing harness to fail first.**
  - `0006_catalogue.sql:118-131`: add `claim_contact_deliveries(integer, uuid)`, `record_contact_delivery_attempt(uuid, text, text, text)` and `submit_contact_message(text, text, text, text)` in `collate "C"` order (each sorts just before its lead counterpart); the description becomes "(migrations 0001-0008)".
  - `migration-database.test.ts`: the header comment says 0001-0008; "applies 0001 to 0008 in order", with `0008_contact_messages.sql` in the list; the pgTAP list gains `0007_contact_messages.sql`.
  - Three new cases there: "leaves the contact functions and both contact tables owned by a role that bypasses RLS"; "keeps the contact rules after a second application of every migration" (runs `0007_contact_messages.sql` again); and, under "migration preconditions", "refuses to apply the contact migration before the staff migration" (every file except 0007 and 0008, then `0008_contact_messages.sql` rejects with `/must be applied before 0008/`).
- [ ] **Step 8: Run `npx vitest run tests/contact/migration-policy.test.ts tests/orders/migration-database.test.ts tests/leads/migration-database.test.ts`.** Expected: FAIL first (Steps 5–7 written before 0008 was complete), then PASS once 0008 meets C4. Then mutate a scratch copy of 0008 three times: drop the `attempts >= 8` park branch, raise the backoff cap to 12 hours, and remove `force row level security` from `contact_message_deliveries`. Watch the matching pgTAP, static or catalogue assert fail each time, and restore the exact bytes (check for CRLF in archive copies).
- [ ] **Step 9: Gate.** Run `npm run typecheck && npm run lint && npx vitest run tests/contact tests/outbox tests/orders tests/leads tests/admin`. Expected: all pass.
- [ ] **Step 10: Hand back** the paths: `feat(contact): contact_messages, its own delivery outbox and RPCs (migration 0008, R159, R169)`.

### Task 2: Server: validation, the route, the alert, the channel, the worker and readiness

**Files:**
- Create: `lib/contact/schema.ts`, `lib/contact/submit.ts`, `lib/contact/dependencies.ts`, `app/api/contact/route.ts`, `lib/email/contact-emails.ts`, `lib/outbox/contact.ts`, and the tests `tests/contact/contact-schema.test.ts`, `tests/contact/contact-emails.test.ts`, `tests/contact/contact-channel.test.ts`, `tests/contact/contact-submit.test.ts`, `tests/contact/contact-route.test.ts`
- Modify: `lib/outbox/worker.ts:1-47`, `lib/outbox/dependencies.ts:1-55`, `lib/outbox/log.ts:8-18`, `lib/ops/readiness.ts:15-51`, `app/api/readiness/route.ts:28-33` (comment only), `tests/outbox/worker.test.ts`, `tests/outbox/cron-route.test.ts`, `tests/ops/health-readiness.test.ts:59-132`, `e2e/ops/health.spec.ts:16`, `:65`

**Interfaces:**
- Consumes: C1–C3; `createSupabaseContactRepository` (Task 1); `isJsonRequest` and `readBodyWithLimit(request, limit)` (`lib/leads/http.ts:129`, `:94`); `clientKeyFromHeaders` (`:21`); `hashSecretFrom` (`lib/security/secrets.ts:13`); `getSupabaseAdminEnvironment` and `createSupabaseAdminClient` (`lib/supabase/admin.ts`); `createSupabaseRateLimiter` and `createMemoryRateLimiter` (`lib/security/rate-limit.ts`); `createEmailSenderFromEnv` and `getStaffNotificationEmail` (`lib/email/client.ts`); `ackSendLimitPerHour` (`lib/leads/dependencies.ts:70`); `errorCodeOf` (`lib/leads/submit.ts:171`); `budgetedSends` (`lib/outbox/send.ts:16`); `attemptNow` (`lib/outbox/attempt.ts:171`); `outboxLogger` (`lib/outbox/log.ts:18`); `reportError` and `reportEvent` (`lib/observability/report.ts`).
- Produces:
  - `validateContactSubmission(input: unknown): { ok: true; data: ContactRecordInput } | { ok: false; fieldErrors: ContactFieldErrors; formError?: "invalid_body" | "unexpected_fields" }`.
  - `submitContactMessage(input: unknown, dependencies: ContactSubmissionDependencies): Promise<{ status: 200 | 400 | 429 | 500 | 503; body: ContactApiBody; retryAfterSeconds?: number }>`, with `ContactSubmissionDependencies`, `ContactLogEvent` (C5), `CONTACT_BODY_LIMIT_BYTES`, `CONTACT_RATE_LIMIT = { scope: "contact", maxHits: 3, windowSeconds: 600 }`, `CONTACT_GLOBAL_RATE_LIMIT = { key: "contact:global", maxHits: 100, windowSeconds: 3600 }` (R171) and `CONTACT_API_MESSAGES` (C5).
  - `createContactDependencies(request: Request, env?): ContactSubmissionDependencies` (synchronous; no CMS read) and `logContactEvent(entry: ContactLogEvent): void`.
  - `buildStaffContactAlert` and `formatReceivedAt` (C6).
  - `ContactChannelSettings`, `contactKindsFor`, `contactAlertChannel` and `createContactAlertSender` (C6).
  - `OutboxWorkerInput.contact`, `outboxLogger("contact")` and `Readiness.contact`.

- [ ] **Step 1: Write the failing tests** for the pure parts:
  - `contact-schema.test.ts`:
    - `it.each(CONTACT_FIELD_CASES)("the server agrees with the browser on $label", …)`: the codes are equal (`{}` for a valid case).
    - "refuses unknown keys as a whole" (`formError: "unexpected_fields"`, no `fieldErrors`); "refuses a non-object body" (`invalid_body`).
    - "hands on the normalised record": `" Ada "`, `"Ada@Example.com"`, `"a\r\nbcdefghijk"` become `"Ada"`, `"ada@example.com"`, `"a\nbcdefghijk"`.
  - `contact-emails.test.ts`:
    - "puts only the topic label in the subject": exactly `New BIBO Bay message: Press and media`, containing neither the name, the address nor the message.
    - "escapes every value": `<script>` appears only as `&lt;script&gt;`; `&` as `&amp;`.
    - "keeps the message verbatim in the text part and wraps it in HTML": `pre-wrap`, `overflow-wrap:anywhere`.
    - "labels the address unverified and explains the reply (R172)".
    - "formats the time": `formatReceivedAt("2026-10-21T09:30:12.345+00:00") === "2026-10-21 09:30 UTC"`.
    - "is deterministic": two builds are deep-equal.
  - `contact-channel.test.ts`:
    - `contactKindsFor(null)` is `[]`, and `contactKindsFor("staff@example.com")` is `["contact_staff_alert"]`.
    - "builds nothing without a staff address"; otherwise `to: ["staff@example.com"]`, `replyTo` is the item's email, the channel name is `contact`, and the idempotency key is `contact-delivery/<id>`.
    - "builds the same message for attempt 1 and attempt 5 of one row".
    - "never addresses the sender": the item's email is never in `to`.
    - `createContactAlertSender` with a recording outbox and `budgetedSends` over `createMemoryRateLimiter` and a recording mailer: "claims this message's alert by id and sends it once": the claim gets `{ ownerId: messageId, kinds: ["contact_staff_alert"], limit: 1 }`; `send` is called once with `to: [staff]`, `replyTo: sender` and `idempotencyKey: "contact-delivery/<deliveryId>"`; the record gets `sent`.
    - "spends send:contact_staff_alert; over the cap the alert is handed back as deferred": with `sendLimitPerHour: 1`, the second message's record gets `{ status: "deferred" }` and `send` is not called for it.
    - "claims nothing without a staff address".
    - "outboxLogger('contact') writes channel contact": one `console.info` line `{"scope":"outbox","channel":"contact",...}` (with `server-only` mocked).
- [ ] **Step 2: Run `npx vitest run tests/contact/contact-schema.test.ts tests/contact/contact-emails.test.ts tests/contact/contact-channel.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `lib/contact/schema.ts`, `lib/email/contact-emails.ts`, `lib/outbox/contact.ts` and the `"contact"` channel of `outboxLogger`** (its comment names the three outboxes). The schema is built from C1's constants, with `z.strictObject`, the email `pipe(z.email({ pattern: EMAIL_PATTERN }))` as in `lib/leads/schema.ts`, `z.enum(CONTACT_TOPICS)`, and the message preprocessed with `normalizeMessage` and refined with `characterCount`/`isSafeMessage` into the C1 codes.
- [ ] **Step 4: Run the Step 2 command.** Expected: PASS.
- [ ] **Step 5: Write the failing flow tests.**
  - `contact-submit.test.ts` (fakes: `createMemoryRateLimiter`, a recording repository, a recording `sendAlert`, a captured `runAfterResponse`):
    - "a filled honeypot gets the generic 400 and touches nothing": no limiter call, no write, the log holds `contact_honeypot`, and `fieldErrors` is absent.
    - "field errors answer 400 in field order and store nothing".
    - "while closed it answers 503 with closed: true before any limiter or write" (`open: false`; and `open: true` with `repository: null`), logging `contact_unconfigured`.
    - "limits each client to 3 per 10 minutes under contact:<clientKey>": `consume("contact:k", { maxHits: 3, windowSeconds: 600 })`; the fourth call gets 429 with `retryAfterSeconds > 0`.
    - "caps all messages at 100 per hour under contact:global, checked after the client limit".
    - "fails closed with 503, not closed, when the limiter is missing or throws".
    - "stores exactly the normalised record and answers persisted only after both ids return".
    - "a write failure answers 500 and calls sendAlert never".
    - "after the answer, calls sendAlert once with the stored message id": nothing is called before `runAfterResponse` runs the task.
    - "a sendAlert that throws, or none at all, leaves the answer 200 persisted".
    - "logs names and codes only": the serialised logs contain neither the name, the address nor the message.
  - `contact-route.test.ts` (mocking `server-only`, `@supabase/supabase-js` `createClient`, `next/server` `after` and `resend` exactly as `tests/leads/lead-route.test.ts` does; env via `vi.stubEnv`):
    - The status cases: 415 when not JSON; 413 for `content-length` above 32 KB and for a streamed body above it; 400 for bad JSON.
    - "a stored message makes exactly these RPC calls in this order": `consume_rate_limit` (`contact:<hmac>`), `consume_rate_limit` (`contact:global`), `submit_contact_message`; then, from `after()`: `claim_contact_deliveries` (`{ p_limit: 1, p_message_id: <id> }`), `consume_rate_limit` (`send:contact_staff_alert`), `record_contact_delivery_attempt`. Resend gets one send to the staff address with `replyTo` the sender.
    - "two IPv6 addresses in one /64 share the contact bucket" (R171).
    - "every answer is no-store, and 429 carries retry-after".
    - "answers 503 closed while STAFF_NOTIFICATION_EMAIL is unset, though storage and email are configured", and likewise with a 31-character `LEAD_IP_HASH_SECRET` (R173).
    - "an unexpected throw answers 500 and is reported under area contact".
    - "never writes the name, the address or the message to the log".
  - `worker.test.ts`: every existing `runOutboxWorker` call gains `contact: { outbox: <empty queue>, settings: { staffEmail: null } }`, and their expectations are unchanged. New cases:
    - "drains orders (quotes first), then signups, then contact alerts": the send order ends with `contact-delivery/c1`.
    - "claims no contact row while no staff address is set".
    - "spends the contact budget for a contact row": `reserve` is asked `contact:contact_staff_alert`.
    - "a spent contact budget hands back that row and holds up no other outbox".
  - `cron-route.test.ts`: "with a staff address, drains the contact outbox last and counts it": `STAFF_NOTIFICATION_EMAIL=staff@example.com`, one due contact row; `claim_contact_deliveries` gets `{ p_limit: 1, p_message_id: null }`; the last send carries `contact-delivery/<id>`, `to: ["staff@example.com"]` and `replyTo` the row's email; `send:contact_staff_alert` is consumed; `record_contact_delivery_attempt` records `sent`; the answer's `sent` includes it. (The existing "drains both outboxes" case already proves that no `claim_contact_deliveries` call happens without a staff address: its claim list is exact.)
  - `health-readiness.test.ts`: the full-object expectations gain `contact`; "contact is true only when contactFormOpen is, and never changes ready"; the key list includes `"contact"`.
- [ ] **Step 6: Run `npx vitest run tests/contact tests/outbox tests/ops`.** Expected: FAIL.
- [ ] **Step 7: Implement the remaining files.**
  - `lib/contact/submit.ts`: the C5 order; after the answer it runs `sendAlert(messageId)` inside `runAfterResponse` when given, catching any throw, as `lib/orders/submit.ts:251-265` does.
  - `lib/contact/dependencies.ts`: storage only with both the admin environment and the hash secret (as `storageFrom`, `lib/orders/dependencies.ts:68-72`); `open: contactFormOpen(env)`; `sendAlert` only with storage, email and a staff address: `createContactAlertSender(repository, { staffEmail }, budgetedSends<ContactDeliveryKind>({ rateLimiter, sendLimitPerHour: ackSendLimitPerHour(env), mailer: email.sender, log: outboxLogger("contact") }))`; `runAfterResponse: (task) => after(task)`, with the `src` line citing the Next `after` guide.
  - `app/api/contact/route.ts`: `runtime = "nodejs"`, the same shape as `app/api/leads/route.ts`.
  - `lib/outbox/worker.ts`: R165 #7–#8; the module comment names the third outbox and the drain order.
  - `lib/outbox/dependencies.ts`: R165 #9–#10.
  - `readinessChecks`: `contact: contactFormOpen(env)`.
  - `e2e/ops/health.spec.ts`: `READINESS_KEYS` gains `"contact"`; keyless asserts `body.contact === false`; configured asserts `typeof body.contact === "boolean"`.
- [ ] **Step 8: Run the Step 6 command.** Expected: PASS. Mutation-check the order guards: with honeypot-after-validation, the global limit before the client limit, or the contact drain before the signup drain, a test must fail. Restore the code.
- [ ] **Step 9: Gate.** Run `npm run typecheck && npm run lint && npx vitest run tests/contact tests/outbox tests/ops tests/leads tests/orders tests/observability`. Expected: all pass. The e2e health spec is run by the controller.
- [ ] **Step 10: Hand back** the paths: `feat(contact): POST /api/contact, the staff alert through the contact outbox, the worker's third outbox, readiness contact (R159-R161, R165, R169-R173)`.

### Task 3: CMS content model and Studio

**Files:**
- Create: `lib/content/claims.ts`, `studio/schemaTypes/contact.ts`, `tests/content/contact-page-content.test.ts`
- Modify: `lib/content/types.ts:21-29` (plus `ContactPageContent`), `lib/content/fallback.ts:114` (plus `SAFE_FALLBACK_CONTACT_PAGE`), `lib/content/normalize.ts:130` (plus `normalizeContactPage`), `lib/sanity/queries.ts` (`CONTACT_PAGE_QUERY = '*[_id == "contactPage"][0]{...}'`), `lib/sanity/fetch.ts` (`getContactPage`), `lib/sanity/presentation.ts:2` (`contactPage: "/contact"`), `lib/security/revalidation.ts:35-52` (`contactPage: ["contactPage"]`), `studio/schemaTypes/documents/singletons.ts:80`, `studio/schemaTypes/objects/index.ts:76-79`, `studio/structure.ts` (`SINGLETON_IDS`), `studio/presentation/resolve.ts` (`mainDocuments` and `locations` for `/contact`), `studio/scripts/seed-data.ts` (`contactPage` document; footer `contactPageLabel: "Contact us"`), `tests/content/studio-contract.test.ts`, `tests/content/public-seed-integration.test.ts:16`, `tests/content/feature-defaults.test.ts`, `tests/security/revalidation.test.ts`, and any test with a full-object footer expectation (`tests/content/content-normalization.test.ts`, `tests/content/studio-preview-config.test.ts`)

**Interfaces:**
- Consumes: none beyond the existing content helpers.
- Produces: `ContactPageContent`, `SAFE_FALLBACK_CONTACT_PAGE`, `normalizeContactPage(raw: unknown): ContactPageContent`, `getContactPage(options?: ContentOptions): Promise<ContactPageContent>` (tag `contactPage`; the fallback when Sanity is absent or unreadable), `SiteSettings.footer.contactPageLabel`, and `DELIVERY_CLAIM_PATTERN` (C7).

- [ ] **Step 1: Write the failing tests.**
  - `contact-page-content.test.ts`:
    - "normalises a full document, trimming text".
    - "falls back field by field".
    - "an empty or missing document is SAFE_FALLBACK_CONTACT_PAGE".
    - "a CMS success message that claims delivery falls back": "We emailed the team" gives the fallback.
    - "the fallback copy addresses grown-ups, mentions leaving out child details, and no string matches DELIVERY_CLAIM_PATTERN".
    - "the footer's contactPageLabel normalises, with the fallback Contact us".
    - "getContactPage answers the fallback without Sanity" (mock `server-only`).
  - `studio-contract.test.ts`:
    - `covers("contactPage", ["seo", "heading", "description", "buttonLabel", "successMessage", "errorMessage", "closedMessage", "emailIntro"])` and `covers("footerSettings", [..., "contactPageLabel"])`.
    - `String(field.validation)` of `successMessage` contains `deliveryClaimProblem`.
    - `deliveryClaimProblem` refuses "We emailed the team" and accepts the fallback.
    - The Studio pattern's `.source` and `.flags` equal `DELIVERY_CLAIM_PATTERN`'s.
    - The seed's `contactPage` equals the fallback strings; the singletons include `contactPage`.
  - `public-seed-integration.test.ts`: 33 documents, and `contactPage` normalises without fallback substitution.
  - `feature-defaults.test.ts`: `resolvePresentationUrl("contactPage") === "/contact"`.
  - `revalidation.test.ts`: the derived type list includes `contactPage`, and `tagsForDocumentType("contactPage")` is `["contactPage"]`.
- [ ] **Step 2: Run `npx vitest run tests/content tests/security`.** Expected: FAIL.
- [ ] **Step 3: Implement C7** in the files listed above. The Studio field titles are plain words, and each field's description says where on the page its text shows.
- [ ] **Step 4: Run the Step 2 command.** Expected: PASS.
- [ ] **Step 5: Gate.** Run `npm run typecheck && npm run lint && npx vitest run tests/content tests/security tests/landing && npm --prefix studio run typecheck`. Expected: all pass. The controller runs `SANITY_STUDIO_PROJECT_ID=ci-placeholder SANITY_STUDIO_DATASET=production npm --prefix studio run build` in the clean copy.
- [ ] **Step 6: Hand back** the paths: `feat(contact): the Contact page document, footer label and fallback copy (R163)`.

### Task 4: The contact form component

**Files:**
- Create: `components/forms/ContactForm.tsx`, `components/forms/contact-copy.ts`, `tests/contact/contact-form.test.tsx`, `tests/contact/contact-copy.test.ts`
- Modify: `components/forms/lead-form.css` (one rule: `.lead-form__textarea { min-height: 10rem; resize: vertical; }`), `lib/analytics/events.ts:14-23`, `tests/analytics/events.test.ts:14`, `tests/leads/env-boundary.test.ts` (one case)

**Interfaces:**
- Consumes: C1; `DELIVERY_CLAIM_PATTERN` (Task 3); `track` (`lib/analytics/client.ts:120`).
- Produces: `interface ContactFormCopy { buttonLabel: string; successMessage: string; errorMessage: string; closedMessage: string }`, and `ContactForm({ copy, endpoint = CONTACT_API_PATH }: { copy: ContactFormCopy; endpoint?: string })` with the C9 DOM contract; `CONTACT_FORM_COPY`, `contactFieldErrorMessage` (C8); the `contact_submitted` event (C10).

- [ ] **Step 1: Write the failing tests** (`contact-form.test.tsx`; jsdom, with `fetch` stubbed and `track` spied; the patterns of the LeadForm tests):
  - "labels every field and ties hints and errors through aria-describedby".
  - "an empty submit lists name, email, topic and message in that order, focuses the named summary and calls fetch zero times".
  - "a 9-character message is refused in the browser with the too-short message".
  - "posts exactly name, email, topic, message and website as JSON to /api/contact": the keys are sorted; the name and email are trimmed; the message is `normalizeMessage`d; `website` is `""`.
  - "shows the CMS success message only for ok and persisted, resets the form, returns focus to the button and tracks contact_submitted once with exactly { persisted: true, topic }".
  - "a 200 without persisted: true shows the CMS error and tracks nothing".
  - "a 503 with closed: true shows the CMS closed message; a 503 without it shows the CMS error".
  - "429 shows the chrome rate-limit message; 500 and a network failure show the CMS error; none tracks".
  - "server field errors move focus to the summary".
  - "ignores a second submit while saving: fetch is called once, the button is disabled and aria-busy, the status says Saving your message…".
  - "keeps exactly one role=status element in the form (R167)".
  - "server HTML has the button disabled until hydration" (`renderToString`).
  - "the honeypot is aria-hidden, out of the tab order, with autocomplete off".
  - "the privacy link follows the submit button".
  - `contact-copy.test.ts`: "every field and code has a message"; "no chrome string matches DELIVERY_CLAIM_PATTERN"; "asks nothing about a child and says to leave child details out".
  - `events.test.ts`: the sorted list gains `contact_submitted`; `cleanProperties("contact_submitted", { persisted: true, topic: "press", email: "x@example.com", message: "hi" })` gives `{ persisted: true, topic: "press" }`.
  - `env-boundary.test.ts`: "the contact form's graph never reaches server-only, Supabase, zod, process.env or a secret", and it includes `lib/contact/fields.ts`.
- [ ] **Step 2: Run `npx vitest run tests/contact/contact-form.test.tsx tests/contact/contact-copy.test.ts tests/analytics tests/leads/env-boundary.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement it, mirroring `components/forms/LeadForm.tsx`:** `useHydrated`, `pendingRef`, the summary focus effect, the focus-return effect (button only, never the status line), the reserved-height outcome wrappers holding `successMessage`, `errorMessage`, `closedMessage` and `rateLimited`, and the `noscript` line. Reuse the `lead-form__*` classes.
- [ ] **Step 4: Run the Step 2 command.** Expected: PASS.
- [ ] **Step 5: Gate.** Run `npm run typecheck && npm run lint && npx vitest run tests/contact tests/analytics tests/leads`. Expected: all pass.
- [ ] **Step 6: Hand back** the paths: `feat(contact): the accessible contact form and its consent-gated event (R162, R166, R167)`.

### Task 5: The page, footer, SEO, legal text, deployment checks and browser specs

**Files:**
- Create: `app/contact/page.tsx`, `lib/contact/page-state.ts`, `e2e/contact/contact-form.spec.ts`, `tests/contact/contact-page.test.tsx`, `tests/contact/contact-footer.test.tsx`
- Modify: `lib/seo/metadata.ts:202-216` (plus `contactMetadata`), `app/sitemap.ts`, `components/landing/Footer.tsx:5-30`, `components/landing/LandingPage.tsx:11-44`, `components/legal/SiteFrame.tsx:45`, `app/page.tsx:40`, `components/landing/CtaLink.tsx:29`, `lib/content/legal-fallback.ts`, `scripts/lib/deployment-checks.ts:297` (and the form-API list), `scripts/verify-deployment.ts:61`, `e2e/crawl/public-routes.spec.ts:39-50`, `tests/seo/metadata.test.ts`, `tests/content/legal-pages.test.tsx`, `tests/scripts/deployment-checks.test.ts:434`

**Interfaces:**
- Consumes: C1, C3 (`contactFormOpen`), C7 (`getContactPage`, `ContactPageContent`), C9 (`ContactForm`), `SimplePageShell`, `isDraftMode`, `seoEnvironment`, `legalFallbackFor`.
- Produces:
  - `type ContactPageState = { kind: "form" } | { kind: "email"; email: string } | { kind: "closed" }`; `contactPageState(open: boolean, settings: Pick<SiteSettings, "contactEmail">): ContactPageState` (form when open, else email when an address is set, else closed).
  - `contactMetadata({ copy, settings, seo, draft, state }): Metadata`: indexable only when `seo.indexable && !draft && state.kind !== "closed" && copy.seo.noIndex !== true`, with `alternates.canonical` `/contact` only then, and otherwise `NOINDEX_FOLLOW`.
  - `SitemapInput.contactListed?: boolean`: `/contact` is listed when it is true and the site is indexable.
  - `Footer({ settings, contactOpen = false })` puts `{ label: settings.footer.contactPageLabel, href: CONTACT_PATH }` after the shop and track links and before the legal links, unless an editor's legal links already hold `/contact`. The mailto block is unchanged.
  - `LandingPage` gains `contactOpen?: boolean`, passed through; `app/page.tsx` passes `contactFormOpen()`; `SiteFrame` passes `contactFormOpen()` itself.
  - `PREFETCHABLE_ROUTES` gains `/contact`.
  - `FORM_API_PATHS = ["/api/leads", "/api/contact"]` (`scripts/lib/deployment-checks.ts`), used by the browser verifier's block-and-record route. `PAYLOAD_PATHS` gains `/contact`.

- [ ] **Step 1: Write the failing unit tests.**
  - `contact-page.test.tsx` (mocking `server-only`, `next/headers` `draftMode` and `@/lib/sanity/fetch`; env via `vi.stubEnv`):
    - "open: one h1 with the CMS heading, the CMS description and the contact form".
    - "closed with a CMS address: the CMS email intro and a mailto link, with no form and no textbox".
    - "closed without one: only the CMS closed message".
    - "contactPageState picks form, then email, then closed".
    - "metadata is indexable in production only with a way to reach the team, never in draft or with CMS noIndex; canonical /contact only then".
  - `contact-footer.test.tsx`:
    - "Footer shows the CMS Contact us link to /contact only when contactOpen".
    - "the mailto stays as it is".
    - "an editor's own /contact link is not doubled".
    - "LandingPage forwards contactOpen".
    - "SiteFrame shows the link when the environment opens the form, and not otherwise".
  - `metadata.test.ts`: "sitemapFor lists /contact only when contactListed and the site is indexable".
  - `legal-pages.test.tsx`:
    - "the text is unchanged while the form is closed": the existing `toBe(LEGAL_FALLBACK)` pins stay.
    - A new `describe("while the contact form is open (R164)")` with the C3 placeholder environment:
      - "says what a message stores: name, email address, topic, message and when it was sent";
      - "says the team receives it by email with the sender's address to reply to, and that the website does not email the sender" (R172);
      - "names contact messages among what Supabase stores";
      - "counts messages against the keyed code, by the hour in total, never storing the address" (R171);
      - "states no retention period: nothing deletes them automatically and none has been set" (R174);
      - "gives the basis: a legitimate interest in replying to people who write to us" (R174).
  - `deployment-checks.test.ts`: `PAYLOAD_PATHS` equals `["/", "/privacy", "/terms", "/thank-you", "/contact"]`; `FORM_API_PATHS` is pinned.
- [ ] **Step 2: Run `npx vitest run tests/contact tests/seo tests/content tests/scripts`.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - `app/contact/page.tsx` follows `components/legal/LegalPage.tsx`: draft-aware `load()`, `generateMetadata`, and `SimplePageShell` with `title={copy.heading}`. It renders `ContactForm` only for `state.kind === "form"`, with `copy={{ buttonLabel, successMessage, errorMessage, closedMessage }}`. It uses the simple-page classes the legal pages use.
  - `legalFallbackFor` computes `contact = contactFormOpen(env)` and passes it to `privacyText`, adding these blocks only when it is true:
    - heading "What the contact form collects", then "The contact form is for adults. When you send a message, the website stores your name, your email address, the topic you chose, your message and when you sent it. Please do not include details about a child." and "The BIBO Bay team receives your message by email, with your email address as the address to reply to, so they can answer you. The website does not email you when you send a message.";
    - after the rate-limit paragraph: "Messages sent through the contact form are counted the same way: against the keyed code in 10-minute windows, and all messages together by the hour. Those counts are not linked to your message.";
    - under "Why we use your details": "To read and answer a message you send through the contact form. The legal basis for keeping it is our legitimate interest in replying to people who write to us.";
    - the Supabase sentence lists "contact messages";
    - under "How long we keep your details": "Contact messages are kept too, with their email delivery records; nothing deletes them automatically, and no period for keeping them has been set.".
- [ ] **Step 4: Run `npx vitest run`** (the full suite: the frame change reaches every page test). Expected: all pass.
- [ ] **Step 5: Write the browser specs** (`e2e/contact/contact-form.spec.ts`, mobile 390 and desktop 1440). The R39-style context guard aborts and records any `/api/contact` request a test did not route; `afterEach` expects none.
  - Keyless (the default):
    - "/contact shows the closed notice, no form and no Contact us footer link";
    - "loading /contact never calls /api/contact";
    - "the guard aborts an unrouted contact request".
  - With `E2E_CONTACT_OPEN=1` (otherwise `test.skip`):
    - "the form has labelled fields, the privacy link under the button and exactly one role=status";
    - "an empty submit focuses the named summary and sends nothing";
    - "success appears only for a routed 200 persisted answer, and the form clears";
    - "a routed 503 closed answer shows the CMS closed message";
    - "routed 429 and 500 answers show their copy, never success";
    - "busy while saving, with no change of button or status size" (a delayed route, measured before and after);
    - "the body carries exactly name, email, topic, message and website";
    - "a keyboard-only submission works";
    - "the honeypot is out of reach";
    - "the footer on / and /privacy links to /contact".
  - Locate everything inside `page.getByRole("form", { name: "Contact BIBO Bay" })`, because the consent notice has its own status line. In `e2e/crawl/public-routes.spec.ts` add `{ path: "/contact", status: 200, why: "contact page: the closed notice keyless, the form when contact is configured" }`.
- [ ] **Step 6: Gate (implementer).** Run `npm run typecheck && npm run lint && npx vitest run`. Expected: all pass. Then the controller verifies, using its clean-copy procedure (servers stopped by port, never by job id):
  - The keyless production copy: `E2E_PRODUCTION=1 PLAYWRIGHT_BASE_URL=<url> npx playwright test` (the whole suite) and `npm run verify:deployment -- <url> --browser`.
  - The same build started with the placeholder service environment set at `next start` time (`NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com`, `SUPABASE_SERVICE_ROLE_KEY=e2e-placeholder-service-role-key`, `LEAD_IP_HASH_SECRET=e2e-placeholder-hash-secret-0123456789abcdef`, `RESEND_API_KEY=re_e2e_placeholder`, `RESEND_FROM=BIBO Bay <hello@example.com>`, `STAFF_NOTIFICATION_EMAIL=staff@example.com`): run `E2E_CONTACT_OPEN=1 PLAYWRIGHT_BASE_URL=<url> npx playwright test e2e/contact`. Only that directory runs against it.
  - Curls on the keyless copy: GET `/api/contact` gives 405; a non-JSON POST gives 415; `{}` gives 400; a valid body gives 503 with `closed: true`.
  - Screenshots of `/contact` at 390, about 1100 and 1440 px, closed and open, including the error summary and a routed success.
- [ ] **Step 7: Hand back** the paths: `feat(contact): /contact page, footer link, sitemap, legal text and browser specs (R158, R161, R164, R167, R174)`.

### Task 6: Docs, README, CHANGELOG and their pins

**Files:**
- Modify: `README.md` (a status row), `CHANGELOG.md` (a dated entry naming R158–R174), `docs/architecture.md` (the `/contact` and `/api/contact` rows; the contact flow; the worker's three outboxes), `docs/database-security.md` (the `contact_messages` and `contact_message_deliveries` rows; the three functions; the buckets `contact:<hmac>`, `contact:global` and `send:contact_staff_alert`; that the lead outbox is unchanged), `docs/deployment.md` (readiness `contact`; `STAFF_NOTIFICATION_EMAIL` also opens the form; the new budget; the R180 restore sentence, below), `docs/observability.md` (`contact_submitted`; the `contact_*` log events and `contact_route_failed`; the `contact` outbox log channel; the budget), `docs/cms-operations.md` (the Contact page document; the footer label; seeded documents 32 → 33; the redeploy after a schema change), `docs/data-protection.md` (below), `docs/incident-runbook.md` (a parked contact alert: query `contact_message_deliveries` joined to `contact_messages` where `next_attempt_at = 'infinity'`, read the message, reply by hand), `docs/qa-checklist.md` (the contact-open run), `tests/scripts/docs-claims.test.ts`

`docs/data-protection.md` (R174): a row in "Personal data the site handles" for contact messages (name, email, topic, message and time; stored in `contact_messages`, alert records in `contact_message_deliveries`; basis (f) legitimate interest in replying; kept with no period set); under item 8, a question for the legal review naming the privacy sentence that gives that basis; under item 9 (Retention), "how long contact messages are kept (none is set; the code never deletes them)"; under "Handling a request from a person", how to find and delete a person's messages by SQL (their delivery rows cascade).

- [ ] **Step 1: Write the failing pins** (`docs-claims.test.ts`):
  - `:360` and `:375`: the bucket lists come from every outbox (R165 #17), with `toHaveLength(6)`;
  - `deployment.md` contains `` `contact` `` in the readiness row, and the `STAFF_NOTIFICATION_EMAIL` row says it also opens the contact form;
  - `database-security.md` contains `` `contact_messages` ``, `` `contact_message_deliveries` ``, `` `submit_contact_message` ``, `` `claim_contact_deliveries` ``, `` `record_contact_delivery_attempt` `` and `` `contact:global` ``;
  - `observability.md` contains `` `contact_submitted` ``, `` `contact_route_failed` `` and every warning event logged in `lib/contact/submit.ts` (matched as `{ event: "<name>"` and filtered by `/_(failed|unavailable|unconfigured|invalid)$/`, as the O-I5 pin does);
  - `cms-operations.md` contains `` `contactPage` `` and 33 seeded documents;
  - `architecture.md` has rows starting `` | `/contact` `` and `` | `/api/contact` ``;
  - `data-protection.md` contains `` `contact_messages` `` and `` `contact_message_deliveries` ``, and its item 9 names contact messages;
  - `incident-runbook.md` contains `contact_message_deliveries` and `'infinity'`;
  - the R180 restore sentence (`:238`) also names `docs/database-security.md`, and a new case "names every doc that says once a day in the restore sentence": each of `README.md` and `docs/*.md` that matches `/once a day/` appears in that sentence.
- [ ] **Step 2: Run `npx vitest run tests/scripts`.** Expected: FAIL.
- [ ] **Step 3: Write the docs.** Describe only what the code does; never a retention period; no new npm script names. Add `docs/database-security.md` to the R180 restore sentence in `docs/deployment.md` (it already says "once a day on Hobby", pinned at `:252-254`, but the list omits it). In files outside that list, write "the next cron run" with a link, never "once a day".
- [ ] **Step 4: Gate.** Run `npm run typecheck && npm run lint && npx vitest run tests/scripts`, then the full `npx vitest run`. Expected: all pass, including `docs-hygiene.test.ts` once the files are staged (it scans tracked files only).
- [ ] **Step 5: Hand back** the paths: `docs(contact): routes, tables, the contact outbox, readiness, editors' and owner's steps (R158-R174)`. Then the controller runs the whole-slice review and the ship gate, and opens the PR.

## After merge: owner steps

1. **Studio:** from `studio/`, deploy the schema and the Studio with the command in `docs/cms-operations.md` ("The live project"), signed in as the brand account. Confirm that Presentation still opens the site.
2. **The Contact page document:** run `npm --prefix studio run seed` (create-if-missing, so only `contactPage` is added; it needs a temporary Editor token, deleted afterwards), or create it in the Studio. Publish it. The footer label is optional (the fallback is "Contact us").
3. **Supabase (Task 11):** apply `0008_contact_messages.sql` with the rest, and run `supabase test db`, which includes `supabase/tests/0007_contact_messages.sql`.
4. **Resend (Task 11):** a verified domain, `RESEND_API_KEY`, `RESEND_FROM`, and `STAFF_NOTIFICATION_EMAIL`, with `LEAD_IP_HASH_SECRET` already set. After that, `/api/readiness` shows `contact: true` and the footer link appears.
5. **Legal review:** confirm the legitimate-interest basis, and decide on a retention period for contact messages (`docs/data-protection.md`, items 8 and 9).
6. **A live check:** send one message from the live site; it should reach the staff inbox, and a reply should go to the sender. Then delete the test message by SQL (`docs/data-protection.md`); its delivery row goes with it.
