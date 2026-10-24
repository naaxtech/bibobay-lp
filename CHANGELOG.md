# Changelog

All notable changes to the BIBO Bay site. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); newest entries first.

## 2026-10-24 — Google AdSense

### Added

- The AdSense tag for publisher `ca-pub-6883401604924323` in the `<head>` of every public page, exactly as AdSense gives it, plus the request's CSP nonce (R251). Only the Vercel production deployment loads it; previews, local runs and CI never contact Google.
- Never on the staff pages, the private order pages, `/track` or `/studio` (R252): an ad request carries the page address, and an order page's address holds its tracking code. `proxy.ts` forwards the document path in `x-bibobay-pathname`, always overwritten.
- CSP on the pages with the tag (R253): `img-src`, `connect-src` and `frame-src` admit Google's ad hosts (`ADSENSE_CSP_SOURCES`); `script-src` is unchanged (no `'unsafe-eval'`, no host list).
- Privacy text, while ads are on (R254): an Advertising section (Google AdSense, what Google receives, its cookies, Google's partner-sites page and My Ad Center), Google among the services, and the cookie and "advertisers" sentences reworded so they stay true. With ads off the text is unchanged (hash-pinned).
- `verify:deployment --browser` lists console messages from Google's ad script as a warning row, `browser ad script` (R255); the site's own console errors still fail.

### Decisions recorded

- R251 (production only), R252 (private pages), R253 (CSP), R254 (privacy text), R255 (ad-script messages).

## 2026-10-22 — Client address behind Cloudflare

### Added

- The signup, contact, order, order-tracking and staff sign-in rate limits can read the visitor's address from `CF-Connecting-IP` when the site is behind the Cloudflare proxy (R245, R246, R248, R249). Vercel's address for a proxied request is expected to be a Cloudflare server, which would make every visitor share one budget; that premise is not yet observed, and the readiness flags below check it.
- The header is trusted only when the address Vercel saw is inside Cloudflare's 22 published ranges AND the request carries `x-bibobay-origin` equal to the new `CLOUDFLARE_ORIGIN_SECRET`, which a Request Header Transform Rule in the owner's Cloudflare zone adds. A Worker on any Cloudflare account can send a chosen `CF-Connecting-IP` from those ranges, so the range alone proves nothing. A Class E address (Cloudflare's Pseudo IPv4) is never trusted. With the secret unset, nothing changes from before.
- `CLOUDFLARE_ORIGIN_SECRET` (server, Production, optional): in `.env.example`, the env table and the secret-rotation table; set but malformed fails the production build, naming the variable only.
- `/api/readiness` reports `cloudflareEdge` (this request came from a Cloudflare address) and `cloudflareOrigin` (the secret is configured and this request carried it) (R250). Neither is part of `ready`.
- Docs: the owner steps for the Cloudflare zone, the recommended single Free-plan rate-limiting rule, and the rotation order.

### Changed

- The address parsing moved into one leaf module, `lib/leads/client-address.ts`; `clientKeyFromHeaders` takes the origin secret as an optional third argument.

### Decisions recorded

- R245 (range check), R246 (IPv4-mapped edge), R248 (secret header required; R247 reopened), R249 (Class E refused), R250 (readiness flags).

## 2026-10-22 — Bot check (Cloudflare Turnstile)

### Added

- A spam check on the signup, contact and order forms (R214-R223): Cloudflare Turnstile in managed mode, off until `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are both set. With both unset the CSP, every request body, every answer and the privacy text are unchanged.
- Server (R215, R216, R218, R219): `botCheckConfig` (off, misconfigured or on; one key alone, a malformed key or Cloudflare's test keys in Vercel production fail closed with 503 and fail the production build), a siteverify call with a 5 s timeout and one retry that sends Cloudflare no visitor address, and a gate that runs after the honeypot, validation and availability checks and before any rate-limit counter. Statuses: 403 refused, 503 unavailable or unconfigured.
- Client (R217): Cloudflare's script loads only on the first focus or press inside a form, with an interaction-only widget; the token is reset after every request that carried one.
- CSP (R220): `frame-src https://challenges.cloudflare.com`, only while the check is on. `/api/readiness` reports `botCheck`, not part of `ready` (R221).
- Events: `lead_bot_check_*`, `contact_bot_check_*` and `order_bot_check_*`; `_refused` is info and never reaches Sentry, `_unavailable` and `_unconfigured` are warnings and do.
- The privacy fallback text names Cloudflare Turnstile, what it receives, that it never receives what is typed, the legitimate-interest basis and the Turnstile Privacy Addendum link, but only while the check is on (R222, C7).
- Docs: provisioning with wrangler on the brand Cloudflare account, the off-switch, a runbook entry, the pipeline diagrams, the CSP, data-protection (Cloudflare as a processor, legal review owed) and the new CI job `e2e-bot-check` on Cloudflare's test keys (R223).

### Decisions recorded

- R214: Turnstile over hCaptcha (hCaptcha's free plan always shows a challenge). R223: test keys in one CI job only; keys are never chosen per request.

## 2026-10-22 — Activity pack "Coming soon" switch

### Added

- A **Coming soon** switch on each download in the Studio (R240). On: the card shows a Coming soon badge and a note instead of the download button, nobody is given the file (not after signing up, not by email), and the signup section's description and button label switch to coming-soon wording, editable in three fields that appear under the switch. Off: the pack is offered exactly as before.

### Changed

- The seeded FAQ answer "What happens when I join?" says the page shows the download button "whenever the pack is available".

## 2026-10-21 — Contact form

### Added

- The `/contact` page and `POST /api/contact` (R190-R209): a grown-up writes to the BIBO Bay team with a name, an email address, a topic (general, partnerships, press, shop and orders, privacy) and a message of 10 to 3,000 characters. There is no age field and no child data; the copy addresses parents, carers and professionals.
- The page has three states (R190, R193): the form while it is open; otherwise the Studio contact address as a mailto link; otherwise only a closed notice. The first two are indexable (canonical `/contact`, listed in the sitemap) unless the CMS says noindex or the page is a draft preview; the closed notice is `noindex, follow`. The footer shows "Contact us" only while the form is open, and its mailto is unchanged.
- The API (R191-R194, R203): JSON only, 32 KiB at most; a filled honeypot gets the generic 400; then field validation, the open check, and the shared database rate limit of 3 messages per 10 minutes per client (IPv6 per /64) and, in all, as many per hour as the alert's send cap (`LEAD_ACK_SEND_LIMIT_PER_HOUR`, default 60; R212), so intake is capped at the alert's hourly send cap (a cron retry in the same hour, or a burst at a window edge, can defer an alert to the next cron run); a body with any key the form does not send is refused as a whole before any field problem is reported; then one `security definer` function stores the message and its outbox row in one transaction. `persisted: true` only after both exist. While the form is closed it answers 503 with `closed: true`.
- Migration `0008_contact_messages.sql` (R191, R201, R207): `contact_messages` and `contact_message_deliveries`, both with forced row level security, no policy and no privilege for any API role, plus `submit_contact_message`, `claim_contact_deliveries` and `record_contact_delivery_attempt`, executable by `service_role` only. The lead outbox, its table and its functions are not altered. The contact outbox has no `skipped` status.
- Delivery (R192, R202, R204): exactly one staff alert per message, to `STAFF_NOTIFICATION_EMAIL`, with the topic in the subject and Reply-To set to the sender's address (labelled unverified in the body). Nothing is emailed to the sender. It spends its own send budget, `send:contact_staff_alert`, under `LEAD_ACK_SEND_LIMIT_PER_HOUR`. It is attempted right after the answer; the cron worker now drains a third outbox, `contact`, after orders and signups, as the retry net for the next cron run (R206). Unlike signup and order emails, an alert whose send was unconfirmed is retried until its eighth attempt and never parked after 23 hours (R211): a retry made after the provider has forgotten the key is a new send, so at most one extra alert per such attempt, up to the eight-attempt cap, and none is lost. A claim's `delivery_expired` log line now names the `outbox` that parked the rows.
- Availability (R193, R205, R209): the form is open only while Supabase, email sending, `STAFF_NOTIFICATION_EMAIL` and a valid `LEAD_IP_HASH_SECRET` are all configured. `/api/readiness` gains `contact`, reported and not required. If the staff address is removed after messages were queued, their alerts wait (never parked) and the form closes.
- The Contact page document `contactPage` and the footer label `contactPageLabel` in the Studio (R195); the Studio seed now has 33 documents. A success message that claims delivery is refused by the Studio and replaced by the built-in text on the site.
- One consent-gated visit-statistics event, `contact_submitted` (`persisted`, `topic`), after a stored answer only (R198).
- The privacy fallback text names contact messages while the form is open, gives legitimate interest as the basis and states no retention period (R196, R206).
- A rollback path: revert the merge for a normal rollback; `supabase/downs/0008_contact_messages_down.sql` for an emergency schema rollback (it deletes stored messages), tested up, down and up again in the embedded database; a 13-layer walk in the plan.

### Changed

- The deployment verifier fetches `/contact` with the other pages and its browser pass blocks `/api/contact` as well as `/api/leads`.
- CI gains a fourth browser job, `e2e-contact` (R213): the open-form contact specs run against `next start` with placeholder contact settings, so they no longer sit skipped. The browser spec imports the form's chrome copy instead of copying it, and the rate-limited message no longer speaks of the visitor's own connection, since the 429 may come from the overall limit (R210). The form's error summary heading is an `h2`, under the page's `h1`.
- The restore sentence in `docs/deployment.md` now also lists `docs/database-security.md`, and a test pins the list against every doc that names the daily schedule (R208).
- The architecture, database, deployment, observability, CMS, data-protection, runbook and QA docs and the README describe the contact form.
- `/contact` works with live editing in the Studio (merged after it): its text is click-to-edit in Presentation, its draft read honours the Studio's perspective, its metadata and the form's reserved outcome texts carry no edit link, and the Studio names the document "Contact page".

### Decisions recorded

- R200: an admin inbox page for messages is deferred. Trigger: the owner asks, or more than 20 messages arrive in a week. Until then staff read each message in its alert email, or by SQL when an alert is parked (`docs/incident-runbook.md`).
- R206: legitimate interest is the basis for contact messages, no retention period is stated (the legal review owns it), and the retry of an alert is the next cron run.
- Owner steps after merge (Studio deploy, the Contact page document, migration `0008`, Resend and the staff address, the legal review, one live check) are in `docs/deployment.md`.

## 2026-10-21 — Live editing in the Studio

### Added

- Live editing in the Studio's Presentation tool: hover any text on the previewed page to see the field it comes from, click to open it in the form, and watch the page follow each edit before publishing.
- The Studio's address bar and the page stay in step, and Presentation's perspective switch (drafts, published, a release) changes what the page shows.

### Changed

- Draft cookies are set `Partitioned` inside the Studio's frame, so the preview keeps working in browsers that block third-party cookies.
- The "Exit preview" link is hidden inside the Studio, where it would only break the preview; it still shows in a preview opened in its own tab.
- Visitors are unaffected: the overlay code is downloaded only by a draft page inside the Studio, and published pages never carry the invisible edit links.
- The whole hero heading is one click target, not just its last line.
- The Studio names the landing page and the legal settings in its lists and pane titles.

### Fixed (before release)

- The overlay's styles carry the page's CSP nonce: without it the strict style policy blocked them and the preview fell over to the error page. An error boundary now keeps the page if the overlay ever fails.
- The site's CSP lets the Sanity Dashboard frame the preview, since hosted Studios now open inside it.
- No edit link ends up in an `aria-label` or `data-*` attribute.

### Decisions recorded

- R158: `@sanity/visual-editing` directly, not `next-sanity`, which would add the whole Studio to the site's dependencies.
- R159-R161: edit links only in Studio previews; text keeps them, nothing the site decides with or puts in `<head>` does; the overlay code is its own download.
- R162-R165: refresh twice after each burst of edits, honour the Studio's perspective, partitioned cookies in the frame, no exit link inside the Studio, no editing variants.
- R166-R171: the Dashboard may frame the preview; no edit links in attributes; singleton titles; the overlay's style nonce and error boundary; split text keeps one edit link on the whole element; `previewUrl.initial` replaces the deprecated `origin`.

## 2026-10-21 — Email cron back to once a day (Hobby plan)

### Changed

- `vercel.json` runs the email outbox cron once a day (`0 6 * * *`, fires between 06:00 and 06:59 UTC) again, because the site stays on Vercel's Hobby plan (owner ruling R180). This supersedes R134's every-15-minutes schedule, which needs Pro.
- The deployment, observability, architecture and runbook docs and the README say what that means: every email is still attempted right after the API answer; a failed send is retried at the next daily run; a send of unknown outcome may only be retried within 23 hours of the first attempt that left it unconfirmed, so on a daily schedule it gets at most one retry before it is parked as `delivery_expired` for a person. Repeat-signup rows are never sent straight away, and deferred emails drain at most `LEAD_ACK_SEND_LIMIT_PER_HOUR` per kind per day.
- Vercel's Hobby plan is restricted to non-commercial personal use, and its fair-use guidelines count advertising a product sale as commercial. By owner decision R180 the site stays on Hobby for now; a Pro plan is required at the latest before commerce is switched on. The Studio field `commerceEnabled` now says so. Upgrading means restoring `*/15 * * * *` in `vercel.json`, the docs, `lib/outbox/constants.ts`, the Studio field text and the tests in `tests/scripts` (the full list is in `docs/deployment.md`).
- A stuck `sending` row is no longer re-sent after 15 minutes: the next cron run re-sends it if it is within 23 hours of the stuck claim, otherwise it is parked as `stale_unconfirmed`.

## 2026-10-21 — Sanity CMS live

### Added

- The live Sanity project (`k82r18ol`, dataset `production`) under the BIBO Bay account, with the Studio hosted at https://bibobay.sanity.studio and its schema deployed. `/studio` on the site redirects there.
- The 32 claim-safe starter documents are seeded (commerce, tracking and testimonials stay off) and pass the Studio's validation.
- Publishing refreshes the site: a signed webhook calls `/api/revalidate` for every create, update and delete.
- Draft preview is wired end to end for the Studio's Presentation tool: the site checks the preview secret with a Viewer token and lets the Studio frame it.

### Changed

- `studio/sanity.cli.ts` names the hosted Studio (`deployment.appId`), so later deploys replace it without asking, and turns on Sanity's auto-updates.
- The CMS, deployment and architecture docs and the README describe the live project.

## 2026-10-17 — Consent notice and privacy notice

### Changed

- Visit statistics count a visitor only after a "yes": a consent notice ("Can we count your visit?") asks on the first visit, and until the answer nothing is counted and no PostHog code is loaded.
- The answer is kept on the visitor's device and can be changed at any time under Analytics choices; a browser that sends Global Privacy Control or Do Not Track is not asked and not counted, unless the visitor turns statistics on.
- The privacy page's fallback text explains the notice, the legal basis for each use, the visitor's rights (withdrawing consent and complaining to a data-protection authority included), that no decision is automated, that Vercel hosts the site, and everything kept on the device.
- New `docs/data-protection.md`: the personal data the site handles, the consent records, what is kept on the device, the owner's tasks before launch and how to answer a person's request.
- The observability, deployment and QA docs and the README describe the opt-in model.

### Decisions recorded

- R144: visit statistics are opt-in behind a consent notice, overriding R70's "on unless turned off".
- R145: statistics stay cookieless; the visitor's answer is the only thing kept on the device.
- R146: the notice appears only when PostHog is configured, so a deployment without a key shows none.
- R147: a Global Privacy Control or Do Not Track browser is not asked and not counted; a "yes" given on this site still wins.
- R148: the notice is non-modal, never takes focus, offers two equal buttons with nothing chosen in advance, and links to the privacy page.
- R149: the privacy text gains the legal bases, the rights, no automated decisions and the host; the controller's identity, data regions and processor agreements stay with the owner.
- R150: the browser specs run on keyless and keyed production builds after every task lands.
- R151: consent is the basis for a signup only while the person is on the list; the record kept after a withdrawal rests on a legitimate interest in respecting it.
- R152: the browser specs prove that no PostHog code is downloaded before a "yes", not only that no request is sent.
- R153: after an answer, focus moves to the page's skip link, so a keyboard or screen-reader user is not left nowhere.

## 2026-10-16 — Free activity pack behind the signup

### Changed

- The free activity pack can be downloaded only after joining the founding-family list.
- The signup answer and the acknowledgement email carry signed download links (24 hours and 30 days).
- The site no longer serves the PDF at a public address; it is downloaded only through the signed route.

### Decisions recorded

- R140: the pack sits behind the email signup, overriding R66's "the link is the file"; the signing key is derived from the existing address-hashing secret, so there is no new setting.
- R141: download links are signed tokens that name only the file and an expiry, never a visitor.
- R142: the privacy page states that the confirmation email also carries the download link; every other legal wording item stays with the owner.
- R143: the repository is public and holds the PDF; the gate collects emails, it is not copy protection.

## 2026-10-16 — Production platform (branch `feat/bibobay-production-ready`)

Replaces the Vite prototype with a CMS-driven Next.js platform. Every task of the production-platform
plan (`docs/superpowers/plans/2026-10-02-bibobay-production-platform.md`) that can be built without
the owner's provider accounts is complete, reviewed and verified locally; provisioning and the
preview QA pass follow once those accounts exist (see `docs/deployment.md`).

### Added
- Next.js 16 App Router site with the sunlit-reef landing page: channel story, friends, real videos,
  YouTube calls to action and the free Activity Pack, every section editable in Sanity with a
  claim-safe built-in fallback. Reduced-motion-safe GSAP narrative motion.
- Sanity Studio under `studio/` with content contracts, claim-safe seed, signed revalidation
  webhook and draft preview.
- Founding-family signup with consent record, email outbox, shared rate limit and forced-RLS
  database policy; privacy and terms pages with plain-language fallback text.
- Metadata, Open Graph image, robots, sitemap, manifest, structured data, nonce Content-Security-Policy,
  security headers, `/api/health` and `/api/readiness`.
- Commerce behind CMS switches (`commerceEnabled`, `trackingEnabled`, both off by default): order
  pad, shop catalogue and product pages, order request and tracking APIs, order and tracking pages,
  idempotent order requests.
- Staff access: sign-in, staff order APIs (quote, status, tracking link) and the staff pages for the
  order list and a single order.
- Email outbox worker on a Vercel cron (every 15 minutes), order acknowledgement, staff alert and
  quote emails with per-kind send budgets.
- Sentry error reports (scrubbed, off until a DSN is set) and cookieless PostHog visit statistics.
- Pinned CI on Node 24 with keyless, commerce-on and keyed browser jobs; client-bundle secret scan;
  deployment verifier; repository and operations docs (architecture, CMS, database security,
  deployment, incident runbook, manual checkout, QA checklist and report).
- Browser specs for the public route crawl, responsive layout, accessibility, ops endpoints,
  admin security and the staff pages.

### Changed
- The same-origin rule for staff requests uses Fetch Metadata first, then the Origin header against
  the forwarded host, never the request URL.
- Lead capture stores a signup only where a removal channel exists (email sending or a contact
  address in the Studio); otherwise it answers "not open yet".
- Gated server reads revalidate every 300 seconds as a backstop to the webhook.

### Decisions recorded
- Every provider account for this site belongs to the brand's own account; a Vercel Pro plan is
  required (commercial use, 15-minute cron).
- Migrations 0006 and 0007 were edited in place before any database had been provisioned; from the
  first applied migration on, every schema change is a new migration.
- Parked for the owner: an audit table for webhook events and the lead retention period; enforcing
  the payment-host allowlist inside the database as well as the API.
- The old GitHub Pages prototype on `gh-pages` stays frozen until the Vercel site is live.
