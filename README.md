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
| Founding-family signup (`/api/leads`), consent record, email outbox, shared rate limit | built |
| Privacy and terms pages with plain-language fallback text, `/thank-you` | built (legal text not yet reviewed, so these pages are noindex) |
| Metadata, Open Graph image, robots, sitemap, manifest, structured data | built |
| Signed Sanity revalidation webhook, Studio draft preview | built (needs secrets; see [docs/deployment.md](docs/deployment.md)) |
| Nonce Content-Security-Policy and security headers, `/api/health`, `/api/readiness` | built |
| CI, client-bundle secret scan, deployment verifier | built |
| Commerce gate (`commerceEnabled`, `trackingEnabled`, both off by default) and order pad | built (Task 6; the `app/(commerce)` layout mounts the pad only while commerce is on) |
| Order tables, order request and tracking APIs (`/api/orders`, `/api/orders/track`), gated by `commerceEnabled` | built (Task 7a) |
| Shop catalogue and product pages (`/shop`, `/shop/[slug]`), no prices, 404 while commerce is off | built (Task 7b) |
| Order and tracking pages (`/order`, `/track`, `/orders/[token]`), idempotent order requests, order consent and countries from the CMS | built (Task 7c) |
| Staff order administration, quote emails, outbox worker | not built yet (Task 8) |
| Error reports (Sentry) and cookieless visit statistics (PostHog), each off until its key is set | built (see [docs/observability.md](docs/observability.md)) |
| Live Sanity, Supabase and Vercel projects | not provisioned yet (Task 11) |

"Task N" refers to the numbered tasks in the implementation plan under `docs/superpowers/plans/`.

## Requirements

- Node.js 26 (the version in [`.nvmrc`](.nvmrc); `package.json` `engines` also accepts `^22.22.2` and `^24.15.0`).
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
- [docs/observability.md](docs/observability.md): cookieless visit statistics (PostHog): what is counted, what never is, setup.
- [docs/manual-checkout-operations.md](docs/manual-checkout-operations.md): the manual ordering workflow: what exists and what is still to come.
- [docs/qa-checklist.md](docs/qa-checklist.md): release checklist with exact commands.
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

The `main` branch still holds the original Vite prototype (`index.html`, `src/`, `vite.config.ts`).
GitHub Pages serves the **`gh-pages` branch**, which contains only the built `dist/` output of
`main`. Pages does not build Vite projects: serving `main` directly gives a blank page, because
`index.html` loads `/src/main.tsx`, which the browser cannot run.

To republish the old site after `main` changes:

1. Check out `main` in a separate folder and build it with that branch's own tooling (its lockfile
   is bun's; `vite build` writes `dist/`).
2. Commit the contents of `dist/` to the `gh-pages` branch (only the build output lives there).
3. Request a Pages build, e.g. `gh api -X POST repos/<owner>/<repo>/pages/builds`. Changing the
   Pages source alone does not start a build.
4. Check the result: `npm run verify:deployment -- https://<owner>.github.io/<repo>/` must show no
   failing asset (it fails if any script, such as `/src/main.tsx`, does not load).

The new Next.js site replaces it once it is deployed to Vercel (Task 11). The old prototype still
shows claims the new site deliberately removed (stock-photo testimonials, a promised activity pack).
