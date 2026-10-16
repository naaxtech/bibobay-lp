# Changelog

All notable changes to the BIBO Bay site. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); newest entries first.

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
