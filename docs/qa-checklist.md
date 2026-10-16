# QA checklist

Run before every release. Each item maps to a release acceptance criterion in the design
specification (`docs/superpowers/specs/`, section 17). Commands are run from the repository root.

## 1. Local gates (all must pass)

```bash
npm ci                                        # package-lock.json must not change
npm --prefix studio ci                        # before typecheck, tests and build: they read the Studio schema
npm run verify:env
npm run typecheck
npm run lint
npm run test:run
npm --prefix studio run typecheck
SANITY_STUDIO_PROJECT_ID=ci-placeholder SANITY_STUDIO_DATASET=production npm --prefix studio run build
npm run build
npm run verify:bundle
npm audit --omit=dev --audit-level=high
```

Also run and record (reported, not blocking; see [deployment.md](deployment.md#known-dependency-advisories)):

```bash
npm audit --audit-level=high
npm --prefix studio audit --omit=dev --audit-level=high
```

The same steps run in CI (`.github/workflows/ci.yml`) on every push and pull request.

## 2. Browser tests against a production build

```bash
npm run build
npx next start -p 3200 -H 127.0.0.1 &        # pick a free port
curl -fsS http://127.0.0.1:3200/api/health    # wait until this answers
E2E_PRODUCTION=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test
npm run verify:deployment -- http://127.0.0.1:3200 --browser --expect-heading "Bright minds. Kind hearts. Big adventures."
```

Stop the server afterwards. `E2E_PRODUCTION=1` turns on the checks that only hold for a production
build (no `'unsafe-eval'` in the CSP). The expected heading is the repository fallback's; against a
deployment with Sanity content, use the published hero heading or leave the flag out.

This keyless run skips the commerce-on, analytics and Sentry specs, which need a differently built
server. CI runs them as two more jobs (`e2e-commerce` and `e2e-keyed`, ruling R130;
[deployment.md](deployment.md#continuous-integration)); run them by hand like this when you want them
locally. Both use a free port in place of 3260 and 3261, and both need `npm ci` in the folder they build.

**2a. Commerce switched on.** The fixture script works on a scratch COPY of the repository, outside any
git work tree (it refuses the repository itself, a folder inside it and a copy with a `.git` entry):

```bash
node scripts/e2e/enable-commerce-fixture.mjs <copy>   # <copy>: the checkout copied without .git and node_modules
cd <copy>
npm ci && npm run build
npx next start -p 3260 -H 127.0.0.1 &
E2E_PRODUCTION=1 E2E_COMMERCE=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3260 npx playwright test e2e/shop e2e/commerce
```

**2b. Analytics and Sentry keys present (placeholders; every PostHog and Sentry request is answered by
Playwright, none leaves the machine):**

```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_e2eplaceholder0000000000000000000000000 NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com NEXT_PUBLIC_SENTRY_DSN=https://0123456789abcdef0123456789abcdef@o0.ingest.example.com/1 npm run build
CRON_SECRET=e2e-placeholder-cron-secret-0123456789abcdef npx next start -p 3261 -H 127.0.0.1 &
E2E_PRODUCTION=1 E2E_ANALYTICS=1 E2E_SENTRY=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3261 npx playwright test e2e/analytics e2e/observability
```

**End-to-end tests never call the real `/api/leads`.** Every lead request in `e2e/` is answered by
`page.route`, and a context guard fails the test on any unrouted call. The deployment verifier also
blocks `/api/leads`. Keep it that way: once Supabase is configured, a real call writes a real row and
may send a real email.

## 3. Against the deployed preview, then production

```bash
export VERCEL_AUTOMATION_BYPASS_SECRET=<the project's Protection Bypass for Automation secret>   # only if the preview is protected
npm run verify:deployment -- https://<preview-url> --browser --require-ready
E2E_PRODUCTION=1 E2E_CONFIGURED=1 PLAYWRIGHT_BASE_URL=https://<preview-url> npx playwright test
npm run verify:deployment -- https://<production-url> --browser --require-ready --production
```

`--require-ready` fails while `/api/readiness` answers 503 (Sanity, lead storage, revalidation and a
signup removal channel, that is email sending or a Studio contact address, must all be configured). No deployment exists yet (Task 11).

- **`E2E_CONFIGURED=1`** tells the suite the server has Supabase, Sanity, the revalidation secret and a removal channel configured (readiness 200). The specs written for the
  keyless server (the unconfigured notice, "not configured" 503s, readiness 503) then expect what a
  configured server answers: a signed-out visit to a staff page redirects to sign-in, staff APIs answer
  401 or 400 instead of 503, readiness is 200 (`e2e/ops/environment.ts` and the four specs that read
  it). Without the flag the same commands go red on a preview by design. Keep commerce switched off in
  the Studio for this run: the shop specs assert the commerce-off answers, and the order flow itself
  is the manual Task 12 pass.
- **`VERCEL_AUTOMATION_BYPASS_SECRET`**: Vercel protects new previews, and the verifier and Playwright
  use the project's "Protection Bypass for Automation" secret, and neither sends it to any other host.
  The verifier sends it as the `x-vercel-protection-bypass` header on requests to the named origin only
  (`scripts/lib/protection-bypass.ts`). Playwright spends it once, in a global setup
  (`e2e/support/vercel-bypass.setup.ts`) that requests the preview's root with
  `x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`, keeps the cookies the preview
  sets for its own host as a storage state file in the OS temp folder (never in the repository), and
  loads that cookie in the browser; the browser sends no bypass header, so YouTube, Sanity and PostHog
  never see the secret. Set it in the shell or the CI secret store only; nothing prints it, and
  Playwright keeps no trace while it is set, because a trace records cookies.

## 4. Acceptance criteria (specification section 17)

| # | Criterion | How to check | State today |
|---|---|---|---|
| 1 | Root page renders meaningful content on the verified Vercel URL | `npm run verify:deployment -- <url> --browser` | Locally yes; no Vercel URL yet (Task 11) |
| 2 | Typecheck, lint, tests, build, dependency scan and Playwright pass | Sections 1 and 2 | Yes locally and in CI |
| 3 | All visible landing content is editable in Sanity with safe fallbacks | `tests/content/`, `tests/landing/`; edit a section in the Studio preview | Yes in code; no live dataset yet |
| 4 | One canonical logo matching the reference's sticker treatment | `tests/brand/`, `e2e/visual/logo.spec.ts` | Yes |
| 5 | Signup persists to Supabase and never fabricates delivery | `tests/leads/`; one real signup on the preview after provisioning, labelled as QA (below) | Code yes; no live database yet |
| 6 | Commerce disabled by default and server-enforced | Feature-default tests; `tests/shop/`; `e2e/shop/commerce-off.spec.ts`; `e2e/commerce/disabled.spec.ts` (over HTTP) | Default off; `/shop`, `/shop/<slug>`, `/order`, `/track`, `/orders/<token>` and the order APIs answer 404 before any catalogue or database read, no shop link or sitemap entry; the commerce-on pages are proven by the `e2e-commerce` job |
| 7 | Manual ordering works end to end in a controlled test environment | Task 12 | Built (Tasks 6 to 8c: order pad, order and tracking APIs and pages, email outbox, staff sign-in, staff APIs and pages); proven in Vitest (PGlite with real roles) and in browsers against the commerce fixture with mocked APIs; **not yet tried end to end on a live preview with real staff accounts and mail (Task 12)** |
| 8 | RLS and function grants prevent anonymous/private data reads | `tests/leads/migration-database.test.ts` (pgTAP in PGlite); `supabase test db` on the real project | PGlite yes; real project not yet (Task 11) |
| 9 | No service-role or secret value in the client bundle or repository | `npm run verify:bundle` (client JavaScript); `npm run verify:deployment -- <url>` (the rendered pages, which the build output does not hold); `npm run verify:env` | Yes locally; secret values are checked for real on the first Vercel build (Task 11) |
| 10 | No unsupported social proof or unverifiable claims on the published page | Review the page; `tests/content/feature-defaults.test.ts` | Fallback content yes; review the live dataset |
| 11 | Legal routes have reviewed text or stay noindex with a reported blocker | `/api/readiness` `legalReviewed`; `<meta name="robots">` on `/privacy`, `/terms` | Fallback text, noindex; legal review outstanding |
| 12 | Vercel, Studio and Supabase identifiers and links verified, no secrets exposed | Task 11 records them | Not provisioned yet |
| 13 | Production test data never created, or named, removed and verified absent | Below | Applies from Task 11 |

## 5. Manual checks on a deployment

- Header, footer and every in-page anchor lead somewhere; the mobile menu opens, traps focus and
  closes with Escape.
- Keyboard only: reach and operate the friend and story tabs, the FAQ, the form; focus is always visible.
- With "reduce motion" switched on in the operating system, nothing parallaxes or slides; all
  content is visible.
- The signup form at 390 px and 1440 px: empty submit shows the error summary; the consent box is
  required; the success message appears only after the server confirms the signup was stored.
- `/privacy`, `/terms` and `/thank-you` are `noindex` until reviewed legal text with a version is
  published; `robots.txt` disallows everything on previews.
- `/api/health` answers ok; `/api/readiness` shows the expected booleans and no values.

## 6. Test data

On any environment connected to a real database or mailbox:

- Label every QA record `QA test <what> - delete me` (for example, first name `QA test signup - delete me`),
  and use an address you control at a domain such as `example.com` only where no mail must arrive.
- Remove each QA record afterwards and check that it is gone. Never run cleanup that could touch a
  record QA did not create.
- Never use a real family's details.
