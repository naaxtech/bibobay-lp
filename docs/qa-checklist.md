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
npm run verify:deployment -- http://127.0.0.1:3200 --browser --expect-heading "Where bright little adventures begin."
```

Stop the server afterwards. `E2E_PRODUCTION=1` turns on the checks that only hold for a production
build (no `'unsafe-eval'` in the CSP). The expected heading is the repository fallback's; against a
deployment with Sanity content, use the published hero heading or leave the flag out.

**End-to-end tests never call the real `/api/leads`.** Every lead request in `e2e/` is answered by
`page.route`, and a context guard fails the test on any unrouted call. The deployment verifier also
blocks `/api/leads`. Keep it that way: once Supabase is configured, a real call writes a real row and
may send a real email.

## 3. Against the deployed preview, then production

```bash
npm run verify:deployment -- https://<preview-url> --browser --require-ready
E2E_PRODUCTION=1 PLAYWRIGHT_BASE_URL=https://<preview-url> npx playwright test
npm run verify:deployment -- https://<production-url> --browser --require-ready --production
```

`--require-ready` fails while `/api/readiness` answers 503 (Sanity, lead storage and revalidation
must all be configured). No deployment exists yet (Task 11).

## 4. Acceptance criteria (specification section 17)

| # | Criterion | How to check | State today |
|---|---|---|---|
| 1 | Root page renders meaningful content on the verified Vercel URL | `npm run verify:deployment -- <url> --browser` | Locally yes; no Vercel URL yet (Task 11) |
| 2 | Typecheck, lint, tests, build, dependency scan and Playwright pass | Sections 1 and 2 | Yes locally and in CI |
| 3 | All visible landing content is editable in Sanity with safe fallbacks | `tests/content/`, `tests/landing/`; edit a section in the Studio preview | Yes in code; no live dataset yet |
| 4 | One canonical logo matching the reference's sticker treatment | `tests/brand/`, `e2e/visual/logo.spec.ts` | Yes |
| 5 | Signup persists to Supabase and never fabricates delivery | `tests/leads/`; one real signup on the preview after provisioning, labelled as QA (below) | Code yes; no live database yet |
| 6 | Commerce disabled by default and server-enforced | Feature-default tests | Default off; commerce routes not built yet (Tasks 6 and 7) |
| 7 | Manual ordering works end to end in a controlled test environment | Task 12 | Not built yet (Tasks 6 to 8) |
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
