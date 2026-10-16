# Changelog

All notable changes to the BIBO Bay site. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); newest entries first.

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
