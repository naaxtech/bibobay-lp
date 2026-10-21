# Changelog

All notable changes to the BIBO Bay site. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); newest entries first.

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
