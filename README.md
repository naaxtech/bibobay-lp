# BIBO Bay

The website for **BIBO Bay**, the story world of the BIBO children's brand: a CMS-driven landing
page with a founding-family email signup for adults, plus a standalone Sanity Studio for editors.

- **Site:** Next.js 16.3.8 App Router, React 19.3, TypeScript, Tailwind CSS 4, GSAP 3.15.
- **Content:** Sanity. The Studio lives in [`studio/`](studio/) and is installed and deployed on its own.
- **Private data:** Supabase (Postgres with forced row level security), reached only from server routes.
- **Email:** Resend, optional. Without it, acknowledgements wait in a database outbox.
- **Tests:** Vitest (unit, integration, and pgTAP in embedded Postgres) and Playwright.

What exists today and what does not:

| Area | State |
|---|---|
| Landing page, every section editable in Sanity, with a safe built-in fallback | built |
| Founding-family signup (`/api/leads`), consent record, email outbox, shared rate limit | built (stores signups only where a removal channel exists: email sending or a contact address in the Studio; otherwise it answers "not open yet") |
| Privacy and terms pages with plain-language fallback text, `/thank-you` | built (legal text not yet reviewed, so these pages are noindex) |
| Metadata, Open Graph image, robots, sitemap, manifest, structured data | built |
| Signed Sanity revalidation webhook, Studio draft preview | built (needs secrets; see [docs/deployment.md](docs/deployment.md)) |
| Nonce Content-Security-Policy and security headers, `/api/health`, `/api/readiness` | built |
| CI, client-bundle secret scan, deployment verifier | built |
| Commerce gate (`commerceEnabled`, `trackingEnabled`, both off by default) and order pad | built (Task 6; the `app/(commerce)` layout mounts the pad only while commerce is on) |
| Order tables, order request and tracking APIs (`/api/orders`, `/api/orders/track`), gated by `commerceEnabled` | built (Task 7a) |
| Shop catalogue and product pages (`/shop`, `/shop/[slug]`), no prices, 404 while commerce is off | built (Task 7b) |
| Order and tracking pages (`/order`, `/track`, `/orders/[token]`), idempotent order requests, order consent and countries from the CMS | built (Task 7c) |
| Staff sign-in and the staff order APIs (`/api/admin/session`, `/api/admin/orders/[reference]/{quote,status,tracking-link}`): staff access rules, quotes, status changes, new tracking links | built (Task 8b; needs Supabase Auth accounts, `staff_users` rows and `PAYMENT_HOST_ALLOWLIST`) |
| Staff order administration pages (`/admin/login`, `/admin/orders`, `/admin/orders/[reference]`): sign in, the order list, an order with its quote, status and tracking-link controls | built (Task 8c; needs Supabase Auth accounts and `staff_users` rows; the signed-in pages are proven in unit tests, a live pass on a preview waits for Task 12) |
| Email outbox worker (`/api/cron/email-outbox`, Vercel cron once a day), order acknowledgement, staff order alert and quote emails, retries for signup emails | built (Task 8a; needs `CRON_SECRET`, Supabase, Resend; the cron is the retry net and runs once a day on Hobby, R180) |
| Contact form (`/contact`, `/api/contact`): a grown-up writes to the team; the message is stored in Supabase and announced by one staff alert email through its own outbox; nothing is emailed to the sender | built (R190-R209; open only while Supabase, email sending, `STAFF_NOTIFICATION_EMAIL` and the hash secret are all configured, otherwise `/contact` shows the Studio contact address or a closed notice; needs migration `0008` and the Contact page document, see [docs/deployment.md](docs/deployment.md#contact-form-steps-after-merge)) |
| Error reports (Sentry) and consent-first, cookieless visit statistics (PostHog), each off until its key is set | built (see [docs/observability.md](docs/observability.md)) |
| Live Sanity project (Studio https://bibobay.sanity.studio, project `k82r18ol`, dataset `production`), seeded with the claim-safe starter content; publishing refreshes the site through the signed webhook | live (2026-10-21; [docs/cms-operations.md](docs/cms-operations.md#the-live-project)) |
| Live Supabase and Vercel projects | not provisioned yet (Task 11); Vercel stays on Hobby (R180, 2026-10-21), which is restricted to non-commercial personal use (its [fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines) count advertising a product sale as commercial); a Pro plan is required at the latest before commerce is switched on |

"Task N" refers to the numbered tasks in the implementation plan under `docs/superpowers/plans/`.

## Requirements

- Node.js 24 (the version in [`.nvmrc`](.nvmrc), which CI runs and Vercel resolves from `package.json` `engines`; `engines` also accepts `^22.22.2` and `>=26.0.0`, so 26 works locally).
- npm. The repository's lockfile is `package-lock.json`. `bun.lock` is kept for history only; do not use bun.

## Run it locally

```bash
npm ci
npm run dev            # http://localhost:3000
```

No settings are needed for a first run. Without Sanity, the page renders the repository's fallback
content. Without Supabase, the signup form answers "We could not save your request" (HTTP 503) and
stores nothing. To connect services, copy `.env.example` to `.env.local` and fill in the values;
every variable is explained in [docs/deployment.md](docs/deployment.md#environment-variables).
Never commit `.env.local` (it is git-ignored).

The Studio is a separate project:

```bash
npm --prefix studio ci
SANITY_STUDIO_PROJECT_ID=<project id> SANITY_STUDIO_DATASET=production npm --prefix studio run dev
```

See [docs/cms-operations.md](docs/cms-operations.md) and [studio/README.md](studio/README.md).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Next.js development server |
| `npm run build` | Checks the production environment (`npm run verify:env -- production`), then `next build` |
| `npm start` | Serves the production build (`next start`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm test` / `npm run test:run` | Vitest, all unit and integration tests, once (no watch mode) |
| `npm run test:e2e` | Playwright (starts `npm run dev` unless `PLAYWRIGHT_BASE_URL` is set) |
| `npm run verify:env` | Refuses server-only names under `NEXT_PUBLIC_` and secret values copied into public names |
| `npm run verify:bundle` | Scans the built client output for secrets (run after `npm run build`) |
| `npm run verify:deployment -- <url>` | Checks a running deployment; add `--browser` for a Chromium pass |
| `npm run brand:generate` | Regenerates the derived logo assets from `public/bibo-logo.svg` |
| `uv run scripts/freebie/build_activity_pack.py` | Rebuilds the free activity pack PDF and its previews (needs [uv](https://docs.astral.sh/uv/); see `docs/cms-operations.md`) |
| `npm --prefix studio run dev` / `build` / `typecheck` / `seed` | Studio commands |

The full pre-release list, including running Playwright against a production build, is in
[docs/qa-checklist.md](docs/qa-checklist.md).

## Documentation

- [docs/architecture.md](docs/architecture.md): routes, server and client boundary, content flow, lead flow, security headers, legacy files.
- [docs/cms-operations.md](docs/cms-operations.md): working in the Studio, feature toggles, publishing and preview.
- [docs/database-security.md](docs/database-security.md): tables, row level security, functions and grants, migrations.
- [docs/deployment.md](docs/deployment.md): environment variables, Vercel, webhooks, health checks, CI, known advisories.
- [docs/observability.md](docs/observability.md): consent-first, cookieless visit statistics (PostHog): what is counted, what never is, setup.
- [docs/data-protection.md](docs/data-protection.md): the personal data the site handles, the legal basis and consent record for each use, what is kept on the device, the owner's tasks before launch, and handling a request from a person.
- [docs/manual-checkout-operations.md](docs/manual-checkout-operations.md): the manual ordering workflow: what exists and what is still to come.
- [docs/qa-checklist.md](docs/qa-checklist.md): release checklist with exact commands.
- [docs/incident-runbook.md](docs/incident-runbook.md): removal requests, parked emails, rollback, switching commerce off, secret rotation.
- [AGENTS.md](AGENTS.md): instructions for coding agents working in this repository.
- `docs/superpowers/`: the design specification and implementation plan the work follows.

## Source material kept in the repository

- The Bibo Bay YouTube channel ([@bibobay-tv](https://www.youtube.com/@bibobay-tv)) is the brand authority: its
  name, mark, colours, cast (Tula, Bob and Lumi) and videos. Where the documents below disagree with it, the channel wins.
- `references/bibo-channel-mark.jpg`: the channel's mark, which the canonical logo (`public/bibo-logo.svg`) is traced from.
- `public/brand/art/`: stills cut from the channel's own videos and their thumbnails, registered with alt text and
  source in `lib/content/brand-art.ts`. They fill every image slot the CMS leaves empty.
- `brandfoundation.md` and `styleprompt.md`: the earlier brand foundation and visual style brief.
- `references/bibo-logo.jpg`: the earlier reference artwork, kept for history; it is no longer the logo's source.
- `bibo-skeleton-1`: a zip archive (no file extension) of the original prototype export, kept for reference.

## The old GitHub Pages site

GitHub Pages serves the **`gh-pages` branch**, which contains only the built `dist/` output of the
original Vite prototype. That branch is frozen: this branch is the Next.js site, `package.json` has no
Vite, and nothing here builds or republishes the prototype. Its source files (`index.html`, `src/`,
`vite.config.ts`) stay at the repository root, unbuilt and unused, kept for history. Pages does not
build Vite projects, so serving the root directly would show a blank page: `index.html` loads
`/src/main.tsx`, which the browser cannot run.

The prototype still shows claims the new site deliberately removed (stock-photo testimonials, a
promised activity pack), so do not republish it. At launch (Task 11) retire the Pages site or redirect
it to the Vercel URL. If it must ever be rebuilt, do it in a separate checkout of the last commit
before the Next.js migration, with that commit's own tooling (its lockfile is bun's), commit only the
build output to `gh-pages`, request a Pages build (`gh api -X POST repos/<owner>/<repo>/pages/builds`;
changing the Pages source alone does not start one) and check
`npm run verify:deployment -- https://<owner>.github.io/<repo>/`, which fails if any script, such as
`/src/main.tsx`, does not load.
