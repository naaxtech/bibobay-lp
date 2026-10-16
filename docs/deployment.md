# Deployment

How the site is configured, deployed and checked. No live Sanity, Supabase or Vercel project
exists yet: provisioning is Task 11, done under **the BIBO Bay owner account** (never a personal or
another product's account). Secret values are entered only in the providers' secret stores, never
in the repository, logs or documents.

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
| `NEXT_PUBLIC_SUPABASE_URL` | public | for lead storage | Supabase project | Project URL (https; http only for a local stack). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | not used yet | Supabase project | Reserved for staff sign-in (Task 8); nothing reads it today. A secret key here is refused. |
| `NEXT_PUBLIC_POSTHOG_KEY` | public | for visit statistics | PostHog project (BIBO Bay owner account) | Project key (`phc_…`). Empty: no analytics, no request to PostHog, no "Analytics choices" link. A personal API key (`phx_…`) is refused. See `docs/observability.md`. |
| `NEXT_PUBLIC_SENTRY_DSN` | public | for error monitoring | Sentry project (BIBO Bay owner account) | Project DSN (https, public key only). Empty: no Sentry, no request, no SDK download in the browser. The ingest host is added to CSP `connect-src`. See `docs/observability.md`. |
| `SENTRY_AUTH_TOKEN` | server | optional (build) | Sentry organisation | Uploads source maps at build time, then removes them from the deployment. Without it nothing is uploaded and no browser source maps are published. Never public. |
| `SENTRY_ORG` | server | with `SENTRY_AUTH_TOKEN` | Sentry organisation | Organisation slug for the upload. |
| `SENTRY_PROJECT` | server | with `SENTRY_AUTH_TOKEN` | Sentry project | Project slug for the upload. |
| `NEXT_PUBLIC_POSTHOG_HOST` | public | optional | PostHog project | Exact https origin events go to; default `https://us.i.posthog.com` (EU: `https://eu.i.posthog.com`). Added to CSP `connect-src` only. |
| `SANITY_API_READ_TOKEN` | server | for Studio draft preview | Sanity project (Viewer token) | Lets `/api/draft-mode/enable` check the preview secret and read drafts. Without it that route answers 503. |
| `SANITY_WRITE_TOKEN` | server | only to run the Studio seed | Sanity project (Editor token) | Used by `npm --prefix studio run seed`, never by the website. Do not set it on Vercel. |
| `SANITY_REVALIDATE_SECRET` | server | production (readiness requires it) | BIBO Bay owner (random) | Shared with the Sanity webhook that calls `/api/revalidate`. |
| `SANITY_STUDIO_ORIGIN` | server | for Studio Presentation | Sanity project | Exact https origin of the deployed Studio, allowed to frame the site (CSP `frame-ancestors`). |
| `SUPABASE_SERVICE_ROLE_KEY` | server | for lead storage | Supabase project | Calls the lead functions. Never public; a publishable key here is refused. |
| `RESEND_API_KEY` | server | optional (email) | Resend account | Sends acknowledgements and staff alerts. Without it they wait in the outbox. |
| `RESEND_FROM` | server | with `RESEND_API_KEY` | Resend account | Sender on a verified domain, e.g. `BIBO Bay <hello@example.com>`. No fallback sender. |
| `RESEND_REPLY_TO` | server | optional | BIBO Bay owner | Where replies (removal requests) go; default: the sender. |
| `STAFF_NOTIFICATION_EMAIL` | server | optional | BIBO Bay owner | Inbox for new-signup alerts (queued even before Resend is set up). |
| `LEAD_IP_HASH_SECRET` | server | for lead storage | BIBO Bay owner (random, 32+ characters) | Keys the rate-limit hash of client addresses. Without it leads are not stored (503); a production build fails with a shorter one. |
| `LEAD_ACK_SEND_LIMIT_PER_HOUR` | server | optional | BIBO Bay owner | Global hourly cap on emails sent straight from the form (1 to 10000, default 60). |
| `PAYMENT_HOST_ALLOWLIST` | server | not used yet | BIBO Bay owner | Reserved for manual checkout payment links (Task 8). Nothing reads it today. |
| `CRON_SECRET` | server | for email retries | BIBO Bay owner (random, 32+ characters) | Authorises the email outbox worker: Vercel Cron sends it as `Authorization: Bearer <secret>`. Without it (or with a shorter one) the worker answers 503 and failed emails are not retried; a production build fails with a shorter one. |

Set by the platform, not by you: `VERCEL_ENV` (only `production` is indexable and gets HSTS),
`VERCEL_GIT_COMMIT_SHA` (shown as `version` by `/api/health`).

Studio variables (set where the Studio is built or deployed, not on the website):
`SANITY_STUDIO_PROJECT_ID`, `SANITY_STUDIO_DATASET`, optional `SANITY_STUDIO_PREVIEW_URL`.

Generate random secrets with, for example, `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.

Visit statistics (PostHog) need one switch in the PostHog project as well as the two variables
above: **Cookieless server hash mode** (Project settings → Web analytics). See
[observability.md](observability.md).

## Vercel project

Not created yet (Task 11). Settings to use:

- Framework Next.js, root directory = repository root. `vercel.json` pins `installCommand: npm ci`
  and `buildCommand: npm run build && npm run verify:bundle`, so Vercel never installs from
  `bun.lock` and every deployment's client bundle is scanned with its own secret values.
- Node.js 26 (matches `.nvmrc`).
- The build runs `npm run verify:env -- production` first; it fails on a forbidden public name or a
  short `LEAD_IP_HASH_SECRET` or `CRON_SECRET`.
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

- `vercel.json` schedules `/api/cron/email-outbox` at `0 6 * * *` (once a day, 06:00 UTC). A Vercel
  **Hobby** plan accepts at most one run a day, so a failed email can wait up to a day for its
  retry, and Vercel may start a Hobby run anywhere in its hour. A send whose outcome is unknown (a
  timeout, a provider server error) is retried only within 23 hours of that attempt, so on Hobby it
  gets at most one retry, and one made in the hour after a run is parked for a human before any
  retry (reported as `delivery_expired`; nothing is claimed as sent). On **Pro**, raise the schedule in `vercel.json` (for example `*/15 * * * *`); the worker
  needs no other change, since every run claims only rows that are due.
- Vercel Cron calls the route with `Authorization: Bearer <CRON_SECRET>`. Set `CRON_SECRET`
  (32+ characters) in the Production environment. The route answers 503 without it, 401 to any
  other caller, 503 while Supabase or Resend is unconfigured, and otherwise counts only:
  `{ sent, failed, skipped, deferred }`.
- One run stops claiming 40 seconds after the request started, or after 100 rows per outbox, and every send spends one unit of
  the same hourly budget as the forms (`LEAD_ACK_SEND_LIMIT_PER_HOUR`). Rows the budget did not
  cover stay due for the next run.
- To run it by hand (for example after setting up Resend): `curl -H "Authorization: Bearer <secret>"
  https://<site>/api/cron/email-outbox`, from a machine you trust, with the secret from the Vercel
  secret store; never paste the secret into a document or a chat.
- A row the worker gave up on (8 attempts, a provider answer that the message's key was used for
  another message, or an unconfirmed send older than 23 hours, ruling R91) stays `failed` with
  `next_attempt_at` set to infinity, and is reported as `delivery_expired`
  ([observability.md](observability.md)). See [database-security.md](database-security.md#outbox-states).

## Sanity webhook and Studio origin

- Webhook: URL `https://<site>/api/revalidate`, POST, on create/update/delete of all documents,
  projection `{_type, _id}`, secret = `SANITY_REVALIDATE_SECRET`. The route answers 503 while the
  secret is unset, 413 for a body over 256 KiB, 401 for a bad or old (over 5 minutes) signature, 400
  for a signed body that is not a `{_type}` JSON object, and 200 otherwise (`revalidated: false`
  when the document type maps to no cache tag).
- CORS origins in Sanity: only the verified local, preview, production and Studio origins.
- `SANITY_STUDIO_ORIGIN` on the site, and `previewMode.enable: "/api/draft-mode/enable"` in the
  Studio's `presentationTool` config (still to do, Task 11). Details: [cms-operations.md](cms-operations.md#preview-draft-mode).
- Studio deploys (`npx sanity deploy` in `studio/`) are run by the owner, not by CI.

## Security headers and HSTS

The per-request CSP and the other headers are described in
[architecture.md](architecture.md#security-headers-and-why-pages-are-dynamic). HSTS
(`max-age=63072000; includeSubDomains`) is sent only when `VERCEL_ENV=production`, without
`preload`. Add `preload` only after the custom domain is verified and every subdomain serves https.

## Health and readiness

| Route | Answers | Use |
|---|---|---|
| `GET /api/health` | Always `200 {"status":"ok","version":"<commit sha or local>","time":"…"}`, `no-store`. No configuration detail, no dependency call. | Uptime checks. |
| `GET /api/readiness` | `200` when Sanity, lead storage (Supabase URL, service-role key, a 32+ character hash secret) and revalidation are configured, else `503`. Body: booleans only: `ready`, `sanity`, `supabase`, `email`, `revalidation`, `legalReviewed`. | Release gate. `email` and `legalReviewed` are reported, not required. |

Neither route ever returns a configuration value.

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

The client-payload check fetches `/`, `/privacy`, `/terms` and `/thank-you` as HTML and as the
React Server Components payload (`RSC: 1`) and runs the bundle scan's rules (below) over both.
Pages that exist only behind a CMS switch (`/shop`, while commerce is on) are scanned the same way
when they answer 200; switched off they must answer 404, and a server error or a redirect fails.
Pages are rendered per request, so this is the only check that sees what the server actually sends,
for example a server value passed to a client component as a prop. Contact addresses are allowed
there, because the pages publish the address editors choose.

`--browser` loads the page in Chromium (`npx playwright install chromium` once), scrolls it, and
fails on console errors, uncaught errors, CSP violations or same-origin responses of 400 or more.
It blocks and fails any request to `/api/leads`, so a verification never stores a lead.

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

The end-to-end tests never reach a real service: every lead request is mocked, and no
configuration is present in CI.

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

GitHub Pages serves the `gh-pages` branch: the built `dist/` of the old Vite prototype on `main`.
How to republish it is in the [README](../README.md#the-old-github-pages-site). The new site
replaces it once Vercel is live (Task 11).
