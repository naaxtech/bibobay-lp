# Deployment

How the site is configured, deployed and checked. The Sanity project is live (2026-10-21, project
`k82r18ol`, dataset `production`, Studio https://bibobay.sanity.studio; see
[cms-operations.md](cms-operations.md#the-live-project)). The Supabase project and the production
Vercel project are not provisioned yet (Task 11). Every provider account is **the BIBO Bay owner
account** (never a personal or another product's account). Secret values are entered only in the
providers' secret stores, never in the repository, logs or documents.

## Environment variables

`.env.example` lists every name with no value. Locally, copy it to `.env.local` (git-ignored).
On Vercel, set values per environment (Preview and Production separately where they differ).

**Scope:** *public* names are compiled into the browser bundle and must hold nothing secret;
*server* names are read only on the server. `scripts/verify-env.ts` holds the allow-list of public
names: any other `NEXT_PUBLIC_` name fails `npm run verify:env` and the build, and so does a public
name holding the value of a server secret. **Owner:** who supplies the value.

| Name | Scope | Needed | Owner | What it does |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | public | production, once the domain is verified | BIBO Bay owner (domain) | Canonical origin (https) for canonical tags, sitemap and structured data, when the Studio has no verified canonical URL. Without it: no canonical, empty sitemap, a `metadataBase` build warning. |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | public | every deployed environment | Sanity project | Sanity project. Without it the site serves the repository fallback content. |
| `NEXT_PUBLIC_SANITY_DATASET` | public | every deployed environment | Sanity project | Dataset name (e.g. `production`). |
| `NEXT_PUBLIC_SANITY_API_VERSION` | public | optional | Sanity project | API date, `YYYY-MM-DD`; default `2026-03-01`. |
| `NEXT_PUBLIC_SUPABASE_URL` | public | for lead storage and staff sign-in | Supabase project | Project URL (https; http only for a local stack). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | for staff sign-in | Supabase project | Lets the server sign staff in and act as them, under row level security (Task 8b). Read on the server only; the browser never talks to Supabase. Without it the staff API answers 503. A secret key here is refused. |
| `NEXT_PUBLIC_POSTHOG_KEY` | public | for visit statistics | PostHog project (BIBO Bay owner account) | Project key (`phc_…`). Set: every new visitor sees the consent notice (except a browser that sends GPC/DNT), and nothing is counted before a "yes" (ruling R144). Empty: no analytics, no request to PostHog, no consent notice and no "Analytics choices" link. A personal API key (`phx_…`) is refused. See `docs/observability.md`. |
| `NEXT_PUBLIC_SENTRY_DSN` | public | for error monitoring | Sentry project (BIBO Bay owner account) | Project DSN (https, public key only). Empty: no Sentry, no request, no SDK download in the browser. The ingest host is added to CSP `connect-src`. See `docs/observability.md`. |
| `SENTRY_AUTH_TOKEN` | server | optional (build) | Sentry organisation | Uploads source maps at build time, then removes them from the deployment. Without it nothing is uploaded and no browser source maps are published. Never public. |
| `SENTRY_ORG` | server | with `SENTRY_AUTH_TOKEN` | Sentry organisation | Organisation slug for the upload. |
| `SENTRY_PROJECT` | server | with `SENTRY_AUTH_TOKEN` | Sentry project | Project slug for the upload. |
| `NEXT_PUBLIC_POSTHOG_HOST` | public | optional | PostHog project | Exact https origin events go to; default `https://us.i.posthog.com` (EU: `https://eu.i.posthog.com`, the one to use where EU or UK visitors are expected: see `docs/data-protection.md`). Added to CSP `connect-src` only. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | public | Production only, with the secret | Cloudflare Turnstile widget "BIBO Bay forms" (brand account) | The widget's site key. Public by design. Set it together with `TURNSTILE_SECRET_KEY`; both unset means no spam check. Not on Preview: preview hostnames are not on the widget's domain list. See [Bot check](#bot-check-cloudflare-turnstile). |
| `TURNSTILE_SECRET_KEY` | server | Production only, with the site key | Cloudflare Turnstile widget "BIBO Bay forms" (brand account) | The widget's secret, used only by the server to check a form's token. Sensitive: add it with `--sensitive`, never print it. One key without the other, a malformed key, or Cloudflare's test keys in Vercel production make every form answer 503 and fail the production build. |
| `SANITY_API_READ_TOKEN` | server | for Studio draft preview | Sanity project (Viewer token) | Lets `/api/draft-mode/enable` check the preview secret and read drafts. Without it that route answers 503. |
| `SANITY_WRITE_TOKEN` | server | only to run the Studio seed | Sanity project (Editor token) | Used by `npm --prefix studio run seed`, never by the website. Do not set it on Vercel. |
| `SANITY_REVALIDATE_SECRET` | server | production (readiness requires it) | BIBO Bay owner (random) | Shared with the Sanity webhook that calls `/api/revalidate`. |
| `SANITY_STUDIO_ORIGIN` | server | for Studio Presentation | Sanity project | Exact https origin of the deployed Studio, allowed to frame the site (CSP `frame-ancestors`, with the Sanity Dashboard `https://www.sanity.io`, where hosted Studios open). Also turns on the click-to-edit links in draft previews. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | for lead storage | Supabase project | Calls the lead functions. Never public; a publishable key here is refused. |
| `RESEND_API_KEY` | server | optional (email) | Resend account | Sends acknowledgements and staff alerts. Without it they wait in the outbox. |
| `RESEND_FROM` | server | with `RESEND_API_KEY` | Resend account | Sender on a verified domain, e.g. `BIBO Bay <hello@example.com>`. No fallback sender. |
| `RESEND_REPLY_TO` | server | optional | BIBO Bay owner | Where replies (removal requests) go; default: the sender. The contact staff alert ignores it: its Reply-To is the sender's address (R204). |
| `STAFF_NOTIFICATION_EMAIL` | server | optional | BIBO Bay owner | Inbox for new-signup alerts (queued even before Resend is set up) and for each contact message's alert. It also opens the contact form: without it the form is closed (R205). |
| `LEAD_IP_HASH_SECRET` | server | for lead storage | BIBO Bay owner (random, 32+ characters) | Keys the rate-limit hash of client addresses. Without it leads are not stored (503); a production build fails with a shorter one. Also keys the signed links for the free download (lib/freebies/token.ts); rotating it invalidates every download link already emailed (up to 30 days) and the one on any open page. The contact form is open only with a valid one, and its rate limit is keyed by it too. |
| `LEAD_ACK_SEND_LIMIT_PER_HOUR` | server | optional | BIBO Bay owner | Hourly cap on emails sent straight away, applied PER MESSAGE KIND (final review D-I1): the lead acknowledgement, lead staff alert, order acknowledgement and order staff alert each have their own bucket (`send:lead_acknowledgement`, `send:lead_staff_alert`, `send:order_acknowledgement`, `send:order_staff_alert`), staff quotes their own (`send:quote`), and the contact staff alert its own (`send:contact_staff_alert`), all with this cap (1 to 10000, default 60). A full bucket defers only its own kind: a flood of signups cannot hold back a quote. |
| `PAYMENT_HOST_ALLOWLIST` | server | for staff quotes | BIBO Bay owner | Comma-separated exact host names of the payment providers a quote's payment link may point to, e.g. `pay.example.com,checkout.example.net` (no `https://`, no wildcards; a subdomain needs its own entry). Empty: staff cannot save any quote. An entry that is not one exact host fails `verify-env` (Task 8b). |
| `CRON_SECRET` | server | for email retries | BIBO Bay owner (random, 32+ characters) | Authorises the email outbox worker: Vercel Cron sends it as `Authorization: Bearer <secret>`. Without it (or with a shorter one) the worker answers 503 and failed emails are not retried; a production build fails with a shorter one. |

Set by the platform, not by you: `VERCEL_ENV` (only `production` is indexable and gets HSTS),
`VERCEL_GIT_COMMIT_SHA` (shown as `version` by `/api/health`).

Studio variables (set where the Studio is built or deployed, not on the website):
`SANITY_STUDIO_PROJECT_ID`, `SANITY_STUDIO_DATASET`, optional `SANITY_STUDIO_PREVIEW_URL` (the website's origin;
without it the Studio has no Presentation tool and no draft preview).

Generate random secrets with, for example, `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.

Visit statistics (PostHog) need one switch in the PostHog project as well as the two variables
above: **Cookieless server hash mode** (Project settings → Web analytics). See
[observability.md](observability.md).

Before launch, work through the owner's list in
[data-protection.md](data-protection.md#before-launch-owner): who the controller is and how to reach
them in the privacy text, the processor agreements with each provider, the data regions (the PostHog
host, the Supabase and Sentry regions), the Sentry and PostHog privacy switches, a retention decision
for signups, and the lawyer's review of the privacy and terms text.

## Vercel project

Not created yet (Task 11). Settings to use:

- Framework Next.js, root directory = repository root. `vercel.json` pins `installCommand: npm ci`
  and `buildCommand: npm run build && npm run verify:bundle`, so Vercel never installs from
  `bun.lock` and every deployment's client bundle is scanned with its own secret values.
- **Node.js 24** on Vercel and in CI (final review O-I1, ruling R133). Vercel offers 24.x (its default)
  and 22.x, and takes the version from the project's Node.js setting or `package.json` `engines`,
  never from `.nvmrc`. `engines` (`^22.22.2 || ^24.15.0 || >=26.0.0`) resolves to 24.x there, and
  `.nvmrc` says `24` so every CI job runs the production runtime. Node 26 is accepted locally (the
  local gates ran on it); check again when Vercel lists 26.
- The site runs on the Hobby plan by owner decision (ruling R180, 2026-10-21), which supersedes
  R134's "Pro required" for now. Vercel's Hobby plan is restricted to non-commercial personal use; its
  fair-use guidelines (https://vercel.com/docs/limits/fair-use-guidelines) count advertising the sale
  of a product as commercial. By owner decision R180 the site stays on Hobby for now, and a Pro plan
  is required at the latest before commerce is switched on (`commerceEnabled`). To upgrade, restore `*/15 * * * *` (R134) in `vercel.json` together with the tests and
  docs: change every file that says once a day, which are `vercel.json`, `README.md`,
  `docs/deployment.md`, `docs/architecture.md`, `docs/database-security.md`, `docs/observability.md`, `docs/incident-runbook.md`,
  `lib/outbox/constants.ts`, `studio/schemaTypes/documents/singletons.ts` and the tests in
  `tests/scripts`.
- The build runs `npm run verify:env -- production` first; it fails on a forbidden public name (Vercel's own
  `NEXT_PUBLIC_VERCEL_*` names are allowed) or a short `LEAD_IP_HASH_SECRET` or `CRON_SECRET`.
- Production branch: keep the feature branch until review; choose the production branch deliberately
  after approval.
- Add the variables above per environment. Keep Preview and Production Supabase projects or at least
  their secrets separate where possible.
- After each deployment run the verifier against its URL (below).

## Email outbox worker (Task 8a)

Every email (signup acknowledgement and staff alert, order acknowledgement and staff order alert,
and later quotes) is written to a database outbox first, then attempted right after the API answer
(ruling R88). The cron worker is the retry net for what that attempt could not send: a provider
failure, the hourly send cap, or Resend not yet configured.

- `vercel.json` schedules `/api/cron/email-outbox` at `0 6 * * *`, once a day (ruling R180, the
  original schedule of R88), because the site stays on the Hobby plan (see
  [Vercel project](#vercel-project)). Per
  [Vercel's cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) (last updated
  2026-07-15) Hobby allows a cron at most once a day with hourly precision, so this job fires between
  06:00 and 06:59 UTC; a more frequent expression fails the deployment. On Pro the schedule goes back
  to `*/15 * * * *` (R134), together with the tests and docs.
- The cron is only the retry net: every email is still attempted right after the API answer (R88),
  except repeat-signup rows for an already-listed lead, which are never sent straight away. On
  a daily schedule a failed send is retried at the next daily run, up to 8 attempts in all
  (`OUTBOX_LIMITS.maxAttempts`, which counts the first send). A send whose outcome is unknown (a
  timeout, a provider server error) may only be retried within 23 hours of the claim of the first
  attempt that left it unconfirmed (`idempotencyWindowHours`, `unconfirmed_since`). On a daily
  schedule that leaves at most one retry: after the send right after the answer, the next daily run
  is usually inside the window, so the row gets one retry under the same idempotency key; a send
  still unconfirmed after that retry, or left unconfirmed by a daily run, is parked at the next run
  as `delivery_expired` for a human (nothing is claimed as sent; see
  [incident-runbook.md](incident-runbook.md#parked-emails)). The worker needs no other change,
  since every run claims only rows that are due. Contact staff alerts are the exception (R211): an
  unconfirmed contact alert is never parked for its age. It is retried at every run under the same
  idempotency key (once the provider has forgotten the key, as a new send) until its eighth
  attempt, because staff receiving an alert twice is harmless and a lost alert leaves a stored
  message nobody reads.
- Vercel Cron calls the route with `Authorization: Bearer <CRON_SECRET>`. Set `CRON_SECRET`
  (32+ characters) in the Production environment. The route answers 503 without it, 401 to any
  other caller, 503 while Supabase or Resend is unconfigured, and otherwise counts only:
  `{ sent, failed, skipped, deferred }`.
- One run stops claiming 40 seconds after the request started, or after 100 rows per outbox, and
  every send spends one unit of the hourly bucket of its own message kind
  (`send:<kind>`, cap `LEAD_ACK_SEND_LIMIT_PER_HOUR`; quotes use `send:quote`). Rows the budget did
  not cover stay due for the next run. With one run a day, emails deferred by the hourly per-kind
  cap, and repeat-signup rows that are never sent straight away, drain at most
  `LEAD_ACK_SEND_LIMIT_PER_HOUR` (default 60) per kind per day (and at most 100 rows per outbox per run).
- The worker drains three outboxes in this order: orders (quotes first), then signups, then contact
  alerts (`send:contact_staff_alert`). It claims no contact alert while `STAFF_NOTIFICATION_EMAIL` is
  unset: those rows wait and are never parked. It needs no `LEAD_IP_HASH_SECRET` for them; only the
  contact form does.
- To run it by hand (for example after setting up Resend): `curl -H "Authorization: Bearer <secret>"
  https://<site>/api/cron/email-outbox`, from a machine you trust, with the secret from the Vercel
  secret store; never paste the secret into a document or a chat.
- A row the worker gave up on (8 attempts, a provider answer that the message's key was used for
  another message, or, for a signup or order email, an unconfirmed send older than 23 hours, ruling
  R91) stays `failed` with `next_attempt_at` set to infinity, and is reported as `delivery_expired`
  ([observability.md](observability.md)), with the `outbox` whose claim parked it. See
  [database-security.md](database-security.md#outbox-states).

## Staff access (Task 8b)

The staff APIs (`/api/admin/...`) need `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
migration `0007_staff_access.sql`, and for sign-in also `SUPABASE_SERVICE_ROLE_KEY` and
`LEAD_IP_HASH_SECRET` (the sign-in rate limit; without them sign-in answers 503 rather than run
unthrottled). Quotes need `PAYMENT_HOST_ALLOWLIST`; the quote email needs Resend like every email.

- In the Supabase dashboard (Authentication settings), switch off public sign-ups; the owner adds
  each staff user from the dashboard instead. A sign-up would grant nothing (access needs an
  active `staff_users` row), but nobody needs an account they cannot use.
- Create each staff member and their `staff_users` row as described in
  [manual-checkout-operations.md](manual-checkout-operations.md#staff-access).
- `/admin` and `/api/admin` are private (`Cache-Control: private, no-store`, `noindex`, no referrer)
  and disallowed in `robots.txt`. The staff pages (`/admin/login`, `/admin/orders`) are built (Task 8c) and need those Supabase settings; without them they show a notice and nothing else.

## Sanity webhook and Studio origin

- Webhook: URL `https://<site>/api/revalidate`, POST, on create/update/delete of all documents,
  projection `{_type, _id}`, secret = `SANITY_REVALIDATE_SECRET`. The live project has one for
  `https://www.bibobay.com`. The route answers 503 while the
  secret is unset, 413 for a body over 256 KiB, 401 for a bad or old (over 5 minutes) signature, 400
  for a signed body that is not a `{_type}` JSON object, and 200 otherwise (`revalidated: false`
  when the document type maps to no cache tag).
- CORS origins in Sanity: only the verified local, preview, production and Studio origins.
- `SANITY_STUDIO_ORIGIN` on the site, and `SANITY_STUDIO_PREVIEW_URL` (the website's origin) where the Studio
  is built or run: the Studio's `presentationTool` then opens `/api/draft-mode/enable` with a one-time
  secret (`previewMode.enable` is wired in `studio/sanity.config.ts`). Details: [cms-operations.md](cms-operations.md#preview-draft-mode).
- Studio deploys (`npx sanity deploy` in `studio/`, with the Studio variables above) are run by the
  owner, not by CI. The exact command is in [cms-operations.md](cms-operations.md#the-live-project).

## Security headers and HSTS

The per-request CSP and the other headers are described in
[architecture.md](architecture.md#security-headers-and-why-pages-are-dynamic). HSTS
(`max-age=63072000; includeSubDomains`) is sent only when `VERCEL_ENV=production`, without
`preload`. Add `preload` only after the custom domain is verified and every subdomain serves https.

## Health and readiness

| Route | Answers | Use |
|---|---|---|
| `GET /api/health` | Always `200 {"status":"ok","version":"<commit sha or local>","time":"…"}`, `no-store`. No configuration detail, no dependency call. | Uptime checks. |
| `GET /api/readiness` | `200` when Sanity, lead storage (Supabase URL, service-role key, a 32+ character hash secret), revalidation and a signup removal channel (below) are configured, else `503`. Body: booleans only: `ready`, `sanity`, `supabase`, `email`, `revalidation`, `legalReviewed`, `leadRemovalChannel`, `contact`, `botCheck`. | Release gate. `email`, `contact`, `botCheck` and `legalReviewed` are reported, not required; `leadRemovalChannel` is required (see below). |

Neither route ever returns a configuration value.

**Signups need a way to be removed (ruling R125).** `/api/leads` answers 503 with "signups are not
open yet" and stores nothing unless a removal channel exists: email sending is configured
(`RESEND_API_KEY` and `RESEND_FROM`, so the acknowledgement email can be replied to) or the Studio's
`siteSettings.contactEmail` is set. `leadRemovalChannel` in `/api/readiness` reports whether one
exists, and readiness is 503 without it. The consent sentence, the privacy and terms fallbacks and `/thank-you` name the channel that
exists ("reply to the acknowledgement email", or "write to <the contact address>") and promise nothing
when there is none; the signup form then shows the 503 message. Set one of the two before launch.
Handling a request: [incident-runbook.md](incident-runbook.md#removal-requests).

## Bot check (Cloudflare Turnstile)

The signup, contact and order forms ask Cloudflare Turnstile whether a person is filling them in
(R214-R223). It is off until both `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set; with
both unset the CSP, every request and answer and the privacy text are exactly as before. The script loads
only once someone starts filling in a form, and the widget is usually invisible.

**Provisioning (brand Cloudflare account only, wrangler 4.151.3).** Log in with the three scopes the widget
needs, then create the widget, which is bound to `bibobay.com` (that covers `www`) and nothing else:

```bash
npx wrangler@4.151.3 login --device --scopes account:read user:read challenge-widgets.write
npx wrangler@4.151.3 whoami
npx wrangler@4.151.3 turnstile widget create "BIBO Bay forms" --domain bibobay.com --mode managed --json
```

Write the JSON to a temporary file outside the repository, pipe its `sitekey` into
`vercel env add NEXT_PUBLIC_TURNSTILE_SITE_KEY production` and its `secret` into
`vercel env add TURNSTILE_SECRET_KEY production --sensitive`, then delete the file. Print neither value.
If the widget's domain list holds `localhost` or `127.0.0.1`, remove them.

- **Production only.** Preview hostnames are not on the widget's domain list, so a preview with the keys
  would fail every check. Previews run with both unset.
- **Test keys are refused in Vercel production.** Cloudflare's published test secret accepts any token
  (probed on 2026-10-22), so `botCheckConfig` reports the state misconfigured when `VERCEL_ENV=production`
  and a test key is set: forms answer 503, `*_bot_check_unconfigured` is reported, and
  `scripts/verify-env.ts` fails the build, naming the variables and never their values.
- **Order of go-live.** Merge with the keys unset (a no-op live), set both on Production, redeploy the
  CURRENT production deployment (R188), then check `/api/readiness` shows `botCheck: true`, a `POST
  /api/contact` without a token answers 403, and a real browser on www loads the widget on first focus
  inside the form with no CSP violation.
- **Off-switch.** Remove both variables from Production and redeploy the CURRENT production deployment
  (never an older one: R188). See the [incident runbook](incident-runbook.md#bot-check-cloudflare-turnstile).
  Code rollback is `git revert -m 1 <merge-sha>`.
- **CSP.** Only while the check is on, the page policy gains `frame-src https://challenges.cloudflare.com`.
  `connect-src` is unchanged ([architecture.md](architecture.md#security-headers-and-why-pages-are-dynamic)).
- **CI.** The job `e2e-bot-check` (name "Playwright, bot check (Cloudflare test keys)", port 3400) builds
  and starts with `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`,
  `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` and `E2E_BOT_CHECK=1` (the same values at build
  and at start, plus the contact job's placeholders) and runs `npx playwright test e2e/bot-check` against
  the real Cloudflare script. Every other job keeps both keys unset, and keys are never chosen per request.

## Contact form

`/contact` and `POST /api/contact` (rulings R190-R209) take messages only while the contact form is open,
and the contact form is open only when Supabase is configured (the project URL and a server key that is
not a publishable one), email sending is configured (`RESEND_API_KEY` and `RESEND_FROM`),
`STAFF_NOTIFICATION_EMAIL` is set and `LEAD_IP_HASH_SECRET` is a valid secret of 32+ characters (R205).
It adds no environment name. `/api/readiness` reports the answer as `contact`; `contact` never changes
`ready`.

- **Closed.** `/contact` shows the Studio contact address as a mailto link when one is set, otherwise a
  closed notice, and is `noindex` in the second case. The footer link is hidden, the sitemap leaves the
  page out when it is the closed notice, and the API answers 503 `{ "ok": false, "persisted": false,
  "closed": true }` and stores nothing.
- **Removed later (R209).** If `STAFF_NOTIFICATION_EMAIL` is removed after messages were queued, their
  alerts wait (the worker claims no contact alert without a staff address, so none is parked), readiness
  shows `contact: false` and the form closes. Removing the Resend key does the same: the worker answers
  503 while Resend is unconfigured, so the alerts wait. Setting them again lets the next cron run send
  them ([Email outbox worker](#email-outbox-worker-task-8a)).
- **Limits and budget.** 3 messages per 10 minutes per client and, in all, as many per hour as the
  alert's send cap (`LEAD_ACK_SEND_LIMIT_PER_HOUR`, default 60; R212), in the buckets `contact:<hmac>`
  and `contact:global`; the alert spends `send:contact_staff_alert`, capped by the same value, so the
  form's intake is capped at the alert's hourly send cap; a cron retry in the same hour, or a burst at
  a window edge, can defer an alert to the next cron run. The alert is attempted
  right after the answer; the cron worker is only the retry net, and retries an unconfirmed alert
  until its eighth attempt rather than parking it (R211).
- **Reading a message.** In the alert email (Reply-To is the sender, labelled unverified), or by SQL when
  an alert is parked, which happens only after its eighth attempt or on `invalid_idempotent_request`
  (R211; [incident-runbook.md](incident-runbook.md#contact-messages)).

## Contact form: steps after merge

1. **Studio:** from `studio/`, deploy the schema and the Studio with the command in
   [cms-operations.md](cms-operations.md#the-live-project), signed in as the brand account. Confirm that
   Presentation still opens the site.
2. **The Contact page document:** run `npm --prefix studio run seed` (it creates only what is missing, so
   only `contactPage` is added; it needs a temporary Editor token, deleted afterwards), or create the
   document in the Studio. Publish it. The footer label is optional (the fallback is "Contact us").
3. **Supabase (Task 11):** apply `0008_contact_messages.sql` with the rest, and run `supabase test db`,
   which includes `supabase/tests/0007_contact_messages.sql`.
4. **Resend (Task 11):** a verified domain, `RESEND_API_KEY`, `RESEND_FROM` and
   `STAFF_NOTIFICATION_EMAIL`, with `LEAD_IP_HASH_SECRET` already set. After that `/api/readiness` shows
   `contact: true` and the footer link appears.
5. **Legal review:** confirm the legitimate-interest basis and decide on a retention period for contact
   messages ([data-protection.md](data-protection.md#before-launch-owner), items 8 and 9).
6. **A live check:** send one message from the live site. It should reach the staff inbox, and a reply
   should go to the sender. Then delete the test message by SQL
   ([data-protection.md](data-protection.md#handling-a-request-from-a-person)); its delivery row goes
   with it.

## Contact form: rollback

**Normal rollback: revert the code.** Revert the merge commit of PR #8 on `main`, then push:

```bash
git revert -m 1 <merge-sha>
git push origin main
```

The next deployment closes the form and removes `/contact`, `/api/contact` and the footer link. The
tables stay, unused: migration 0008 only adds objects, and nothing reads or writes `contact_messages`
or `contact_message_deliveries` without the reverted code. That includes the worker: once the revert is
live, an alert that is not `sent` is never sent. Before reverting, list those messages and reply by
hand ([incident-runbook.md](incident-runbook.md#contact-messages)); never paste a result into a chat, a
ticket or a document:

```sql
select message.created_at, message.topic, message.name, message.email, message.message
from public.contact_messages as message
join public.contact_message_deliveries as delivery on delivery.message_id = message.id
where delivery.status in ('pending', 'sending', 'failed')
order by message.created_at;
```

To stop new messages before the revert is deployed, use **Instant Rollback** to the last production
deployment before the merge ([incident-runbook.md](incident-runbook.md#rollback)); the next deployment
from `main` brings the form back until the revert lands. Afterwards, verify the site as after any
rollback.

**Emergency schema rollback: the down script.** Only when the schema itself has to go, for example if
the legal review rules that contact messages must not be stored. It deletes every stored contact
message and every alert row, for good: nothing but a database backup brings them back. Revert the code
first, so nothing writes to the tables while they are dropped. Then, from the repository root, with
the Supabase CLI linked to the project, as the project owner:

```bash
npx supabase@2.121.0 db query --linked -f supabase/downs/0008_contact_messages_down.sql
```

It drops the three contact functions, then `contact_message_deliveries`, then `contact_messages`, in
one transaction, and nothing else: no lead, order, staff or rate-limit object. No drop cascades, so if
anything else depends on a contact table it drops nothing at all. It is not a migration:
`supabase db push` reads only `supabase/migrations/`, never `supabase/downs/`. The migration history
still lists 0008 afterwards, so to apply it again later, mark it reverted and push:

```bash
npx supabase@2.121.0 migration repair 0008 --status reverted --linked
npx supabase@2.121.0 db push --linked
```

`tests/contact/migration-rollback.test.ts` runs 0001-0007, 0008, the down script and 0008 again in an
embedded Postgres: the down script leaves the schema exactly as 0001-0007 left it, every earlier pgTAP
file stays green, a second run changes nothing, and 0008 applies cleanly again.

## Verifying a deployment

```bash
npm run verify:deployment -- https://<deployment-url>
npm run verify:deployment -- https://<deployment-url> --browser --require-ready
```

Fetch checks (no browser needed): home page 200; a real `<title>` (not a framework or error
default); at least 200 characters of visible text and an `<h1>`; every same-origin script,
stylesheet and icon the page references answers 200 with a matching content type; a CSP with a
script nonce and no `'unsafe-eval'`; `X-Content-Type-Options: nosniff`; a `Referrer-Policy`;
`/api/health` ok; `/api/readiness` reported (a 503 is a warning unless `--require-ready`);
`robots.txt` reachable; and for a non-production URL a `noindex` signal (pass `--production` for
the indexable site, which then fails on any `noindex` meta tag or `X-Robots-Tag`, or a robots.txt
group for `User-agent: *` that disallows `/`). `--expect-heading "<text>"` also requires that exact `<h1>`.

Redirects are followed only within the starting origin: a home page that redirects to another
origin fails, and the checks never run against a host you did not name. Printed URLs drop the query
string and fragment, and a URL carrying a user name or password is refused, so a protection-bypass
token cannot reach a CI log.

The client-payload check fetches `/`, `/privacy`, `/terms`, `/thank-you` and `/contact` as HTML and as the
React Server Components payload (`RSC: 1`) and runs the bundle scan's rules (below) over both.
Pages that exist only behind a CMS switch (`/shop`, while commerce is on) are scanned the same way
when they answer 200; switched off they must answer 404, and a server error or a redirect fails.
Pages are rendered per request, so this is the only check that sees what the server actually sends,
for example a server value passed to a client component as a prop. Contact addresses are allowed
there, because the pages publish the address editors choose.

`--browser` loads the page in Chromium (`npx playwright install chromium` once), scrolls it, and
fails on console errors, uncaught errors, CSP violations or same-origin responses of 400 or more.
It blocks and fails any request to `/api/leads` or `/api/contact`, so a verification never stores a lead or a message.

Exit codes: 0 pass, 1 a check failed, 2 usage or network error. These checks fail the old GitHub
Pages blank page (its only script, `/src/main.tsx`, answered 404); a unit test pins that case.

## Client bundle secret scan

`npm run verify:bundle` runs after `npm run build` and fails (exit 1) if the client output
(`.next/static`, prerendered `.html`, `.rsc` and `.body` files, and `public/`) contains:

- any server name from `.env.example` (everything without the `NEXT_PUBLIC_` prefix), so a new
  name is covered as soon as it is added there;
- a `NEXT_PUBLIC_` name not on `scripts/verify-env.ts`'s allow-list;
- strings only server code contains (`submit_lead`, `consume_rate_limit`, `api.resend.com`,
  `createHmac`, the lead table names, …);
- the configured value of any credential-like server variable, or the sender and staff addresses
  (read from the environment and `.env*` files of the machine running the scan);
- token-shaped strings: a three-part JWT whose role is not `anon`, Resend `re_…`, `sk_…` and
  Sanity tokens, Supabase `sb_secret_…`, private-key blocks.

Findings name the file and the rule, never the secret. With no build output it exits 2 instead of
passing.

Every page is rendered per request (the CSP nonce is per request), so the build output holds no
page HTML or RSC payload: this scan covers the client JavaScript and `public/`, and
`npm run verify:deployment` scans the rendered pages of a running site. The secret-value rule only
has real values where the real environment is: the Vercel build runs `npm run build && npm run
verify:bundle` (`vercel.json`), so a deployment whose client output carries a configured secret
fails to build. CI has no secrets and checks names, strings and token shapes only.

## Continuous integration

`.github/workflows/ci.yml` runs on every push (except to `gh-pages`) and on pull requests, with
`contents: read` only, no secrets (so forks behave the same), and cancels superseded runs.

| Job | Steps |
|---|---|
| `verify` | `npm ci`, `npm --prefix studio ci` (root typecheck and tests import the Studio schema), `npm run verify:env`, typecheck, lint, `npm run test:run`, `npm run build`, `npm run verify:bundle`, `npm audit --omit=dev --audit-level=high` (blocking), full `npm audit --audit-level=high` (reported in the job summary and kept as an artifact, not blocking) |
| `studio` | `npm --prefix studio ci`, typecheck, build with placeholder `SANITY_STUDIO_PROJECT_ID=ci-placeholder` / `SANITY_STUDIO_DATASET=production`, Studio audit (reported, not blocking) |
| `e2e` (after `verify`) | `npm ci` only, as Vercel installs (so it proves the site builds without the Studio: `next build` type-checks `tsconfig.build.json`, which leaves tests out), Playwright Chromium, `npm run build`, `next start` on 127.0.0.1:3000 with a wait on `/api/health`, `npx playwright test` with `E2E_PRODUCTION=1`, then `npm run verify:deployment -- http://127.0.0.1:3000 --browser`; the Playwright report and traces are uploaded on failure |
| `e2e-commerce` (after `verify`) | The commerce-on browser run (ruling R130): copies the checkout without `.git` and `node_modules` to `../commerce-copy`, `node scripts/e2e/enable-commerce-fixture.mjs ../commerce-copy` (the script refuses any folder inside a git work tree), then in the copy `npm ci`, Playwright Chromium, `npm run build`, `next start -p 3100 -H 127.0.0.1` with a wait on `/api/health`, and `E2E_PRODUCTION=1 E2E_COMMERCE=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/shop e2e/commerce`; the report is uploaded on failure as `playwright-report-commerce` |
| `e2e-keyed` (after `verify`) | The analytics and Sentry browser run (ruling R130): `npm ci`, Playwright Chromium, `npm run build` with the placeholder `NEXT_PUBLIC_POSTHOG_KEY=phc_e2eplaceholder0000000000000000000000000`, `NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com` and `NEXT_PUBLIC_SENTRY_DSN=https://0123456789abcdef0123456789abcdef@o0.ingest.example.com/1`, `next start -p 3200 -H 127.0.0.1` with the placeholder `CRON_SECRET=e2e-placeholder-cron-secret-0123456789abcdef`, and `E2E_PRODUCTION=1 E2E_ANALYTICS=1 E2E_SENTRY=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/analytics e2e/observability`; the report is uploaded on failure as `playwright-report-keyed` |
| `e2e-contact` (after `verify`) | The contact form open (ruling R213), so the open-form contact specs never sit skipped: `npm ci`, Playwright Chromium, `npm run build`, `next start -p 3300 -H 127.0.0.1` with the placeholder contact environment `NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com`, `SUPABASE_SERVICE_ROLE_KEY=service-role-fixture-value`, `LEAD_IP_HASH_SECRET=e2e-placeholder-hash-secret-0123456789abcdef`, `RESEND_API_KEY=re_fixture`, `RESEND_FROM="BIBO Bay <hello@example.com>"` and `STAFF_NOTIFICATION_EMAIL=staff@example.com` (no secret; every page renders per request, so the form's open condition is read at start), and `E2E_PRODUCTION=1 E2E_CONTACT_OPEN=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300 npx playwright test e2e/contact`; every `/api/contact` call is answered by Playwright; the report is uploaded on failure as `playwright-report-contact` |

The end-to-end tests never reach a real service: every lead, contact and order request is mocked or
answered by the fixture, every PostHog and Sentry request goes to a reserved example domain that
Playwright answers itself, and no configuration or secret is present in CI (the values above are
placeholders). `e2e-commerce`, `e2e-keyed` and `e2e-contact` run the commands in
[qa-checklist.md](qa-checklist.md#2-browser-tests-against-a-production-build) (the ports aside). They were
written from the commands the controller ran by hand on Windows; the first push proves them on
Linux, and a red first run is fixed forward. A fifth browser job, `e2e-bot-check`, runs the spam check on Cloudflare's test keys; it is described under [Bot check](#bot-check-cloudflare-turnstile), and its commands are in qa-checklist.md section 2b-bis.

Pinned actions (full commit SHA, version in a comment), checked on 2026-10-13 with
`gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (each tag points directly at the commit) and
`gh api repos/<owner>/<repo>/commits/<sha>`:

| Action | Version | Commit |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

To update one, look up the new tag's commit the same way, change the SHA and the comment together,
and update the table in `tests/scripts/ci-workflow.test.ts`, which rejects any unpinned or unknown action.

## Known dependency advisories

Checked on 2026-10-13.

**Website, shipped dependencies:** `npm audit --omit=dev --audit-level=high` reports
0 vulnerabilities. This is the blocking CI gate.

**Website, development tooling:** `npm audit --audit-level=high` reports 5 high advisories, all one
issue: `braces` (GHSA-vfj7-8cjw-p6xm, stack-exhaustion denial of service on deeply nested patterns),
reached through `eslint-config-next@16.3.8` → `@next/eslint-plugin-next` → `fast-glob` →
`micromatch` → `braces`. `braces@3.0.3` is the latest release and has no fix. It is lint tooling
only and never ships to the site. `npm audit fix --force` would install `eslint-config-next@14`,
an incompatible major, so it is not used, and no override is forced. CI reports this audit without
blocking. Re-check when Next ships an `eslint-config-next` update.

**Studio:** `npm --prefix studio audit --omit=dev --audit-level=high` reports 17 advisories
(7 high, 10 moderate). The high ones are the same `braces` chain reached through the Sanity CLI
(`@sanity/cli`, `@sanity/codegen`, `chokidar`, `globby`, `fast-glob`, `micromatch`, `braces`); the
moderate ones include `uuid` (GHSA-w5hq-g745-h8pq), `smol-toml` (GHSA-r4xh-jqrq-34v2) and
`sprintf-js` (GHSA-hp3w-g68c-fv3c) in build and CLI tooling. The Studio is an editors' tool,
deployed separately to Sanity hosting by the owner, and is not part of the public site bundle. CI
reports this audit without blocking. The upgrade path is a newer `sanity` release
(`npm --prefix studio install --save-exact sanity@<version>`, then the Studio typecheck and build);
`studio/package.json` already overrides the transitive packages that have compatible fixes.

## The old GitHub Pages site

GitHub Pages serves the `gh-pages` branch: the built `dist/` of the original Vite prototype. That
branch is frozen: nothing in this repository builds or republishes it (`package.json` has no Vite),
and the prototype's files stay at the root, unbuilt. At launch, retire the Pages site or redirect it
to the Vercel URL (Task 11). See the [README](../README.md#the-old-github-pages-site).
