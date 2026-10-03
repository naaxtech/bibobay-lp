# Bibo Bay Production Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken Vite skeleton with a production-ready, CMS-driven Bibo Bay platform: a polished GSAP landing page, truthful lead capture, hidden-by-default manual ordering, protected Supabase data, standalone Sanity Studio, verified Vercel deployment, and full automated QA.

**Architecture:** A root Next.js App Router application renders Sanity-managed content and hosts secure server routes, order/admin surfaces, and preview/revalidation. A standalone `studio/` app owns editorial workflows. Supabase stores private leads/orders under forced RLS; Resend handles optional transactional mail; GSAP powers reduced-motion-safe storytelling.

**Tech Stack:** Next.js 16.3.8, React 19.3, TypeScript, Tailwind CSS, GSAP 3.15, Sanity 6.17 / next-sanity 13.3, Supabase JS 2.117, Zod 4.6, Resend 6.32, Vitest 5, Playwright 1.63, Vercel.

**Spec:** `docs/superpowers/specs/2026-10-02-bibobay-production-platform-design.md`

## Global Constraints

- `commerceEnabled`, `trackingEnabled`, and `testimonialsEnabled` default to `false` in Sanity and repository fallbacks.
- Public copy must not claim delivery, users, testimonials, experts, partners, releases, research findings, or social profiles without verified source material.
- Forms address adults/guardians and do not collect child names, birthdays, photos, voice, health, school, or precise location.
- Sanity stores editorial content only; Supabase stores leads, consent, staff identities, orders, tracking state, email/outbox state, and audit events.
- No service-role, Sanity write token, Resend key, signing secret, cron secret, or payment credential may use a public environment prefix or enter the client bundle.
- Commerce-disabled behavior is enforced server-side, not only through hidden UI.
- Manual ordering never captures card or bank credentials and never treats a human reference as authentication.
- Supabase RLS is enabled and forced; internal security-definer helpers revoke execution from `PUBLIC`, `anon`, and `authenticated` unless explicitly intended.
- All new behavior follows RED → GREEN → REFACTOR; each task records the failing test output before implementation.
- Motion respects `prefers-reduced-motion`, never hides core content, and disposes GSAP timelines/ScrollTriggers.
- The canonical BIBO logo retains separate irregular white sticker outlines around each letter.
- Production test data uses a `QA test ... - delete me` label and is removed and verified absent.

## Review Focus

1. **CMS unavailable or malformed:** the public site must render safe fallback content without unsupported claims; Task 2 tests this.
2. **Feature flag tampering:** direct requests to order/tracking endpoints while disabled must fail generically; Tasks 6 and 7 test this.
3. **Client-tampered catalogue items:** submission must reload canonical Sanity products and reject missing/unlisted IDs; Task 7 tests this.
4. **Private-data access:** anonymous and non-staff roles must not select leads/orders or execute internal payload functions; Tasks 5 and 7 test this.
5. **Partial operational failures:** durable persistence must not be reported as failed solely because email/webhook delivery failed; Tasks 5 and 8 test outbox/error behavior.

---

## File structure map

### Application foundation

- `app/` — Next.js routes, metadata, API handlers, legal, commerce, tracking, and admin pages.
- `components/landing/` — one component per CMS section plus section renderer.
- `components/brand/` — canonical logo renderer and decorative Bay artwork.
- `components/forms/` — accessible lead, order, tracking, and auth forms.
- `components/shop/` — product cards, order-pad provider, and add/review controls.
- `components/admin/` — protected order workflow controls.
- `lib/content/` — content contracts, fallbacks, normalization, section ordering.
- `lib/sanity/` — clients, GROQ queries, images, preview, revalidation contracts.
- `lib/supabase/` — browser/server/admin clients, auth, lead/order repositories.
- `lib/leads/` — schemas and submission orchestration.
- `lib/orders/` — pad rules, schemas, state transitions, canonical product resolution, tracking.
- `lib/email/` — Resend adapters and templates.
- `lib/security/` — environment validation, feature gates, rate limiting, URL allowlists.
- `studio/` — standalone Sanity configuration, schema, structure, presentation, and seed tooling.
- `supabase/migrations/` — schema/RLS/functions in dependency order.
- `tests/` — Vitest unit/integration tests.
- `e2e/` — Playwright end-to-end and crawl tests.
- `scripts/` — environment verification, content seed, bundle-secret scan, deployment checks.

---

### Task 1: Next.js foundation and deterministic quality gates

**Files:**
- Replace: `package.json`
- Create: `package-lock.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`
- Create: `tests/smoke/app-foundation.test.tsx`
- Create: `scripts/verify-env.ts`
- Create: `.env.example`
- Preserve legacy Vite entry/config files unchanged as audit history; the Next.js runtime ignores them.

**Interfaces:**
- Produces: root scripts `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:run`, `test:e2e`, `verify:env`, `verify:bundle`.
- Produces: `EnvReport` and `verifyEnvironment(env, phase)` from `scripts/verify-env.ts`.

- [ ] **Step 1: Write failing foundation tests**

Create tests asserting the root page renders a meaningful BIBO heading, unsupported skeleton metadata is absent, and `verifyEnvironment` rejects server secrets placed under `NEXT_PUBLIC_`.

- [ ] **Step 2: Run tests and capture RED**

Run: `npm test -- tests/smoke/app-foundation.test.tsx`  
Expected: FAIL because the Next app and environment verifier do not exist.

- [ ] **Step 3: Replace the Vite skeleton with the minimal Next.js foundation**

Pin the versions in this plan, set Node engine compatibility, remove unused Google AI/Express/Vite packages, add deterministic npm scripts, and create the smallest server-rendered BIBO page that satisfies the tests.

- [ ] **Step 4: Install dependencies and run targeted GREEN**

Run: `npm install && npm test -- tests/smoke/app-foundation.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Run baseline gates**

Run: `npm run typecheck && npm run lint && npm run build`  
Expected: exit 0 for all commands.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts playwright.config.ts app scripts/verify-env.ts .env.example tests/smoke
git commit -m "feat: establish Bibo Bay production foundation"
```

### Task 2: Content contracts, fallbacks, Sanity Studio, and complete CMS control

**Files:**
- Create: `lib/content/types.ts`
- Create: `lib/content/fallback.ts`
- Create: `lib/content/normalize.ts`
- Create: `lib/sanity/env.ts`
- Create: `lib/sanity/client.ts`
- Create: `lib/sanity/queries.ts`
- Create: `lib/sanity/fetch.ts`
- Create: `lib/sanity/image.ts`
- Create: `lib/sanity/presentation.ts`
- Create: `studio/package.json`
- Create: `studio/sanity.config.ts`
- Create: `studio/sanity.cli.ts`
- Create: `studio/structure.ts`
- Create: `studio/presentation/resolve.ts`
- Create: `studio/schemaTypes/index.ts`
- Create: `studio/schemaTypes/documents/*.ts`
- Create: `studio/schemaTypes/objects/*.ts`
- Create: `studio/scripts/seed.ts`
- Create: `tests/content/content-normalization.test.ts`
- Create: `tests/content/content-fallback.test.ts`
- Create: `tests/content/feature-defaults.test.ts`

**Interfaces:**
- Produces: `LandingPageContent`, `SiteSettings`, `LegalSettings`, `Character`, `EpisodePreview`, `BrandPillar`, `EcosystemEntry`, `Testimonial`, `FaqItem`, `LeadMagnet`, `ProductCategory`, `Product`.
- Produces: `getLandingPage(options?)`, `getSiteSettings(options?)`, `getLegalSettings(options?)`, `getListedProducts(options?)`, `getProductBySlug(slug, options?)`.
- Produces: `normalizeLandingContent(raw) -> LandingPageContent` and `SAFE_FALLBACK_CONTENT`.

- [ ] **Step 1: Write failing content tests**

Cover malformed/missing CMS data, safe section ordering, hidden testimonials, hidden commerce/tracking, missing social URLs, required image alt text normalization, and fallback copy that contains none of the unsupported claims identified in the spec.

- [ ] **Step 2: Run tests and capture RED**

Run: `npm test -- tests/content`  
Expected: FAIL because contracts and fallbacks do not exist.

- [ ] **Step 3: Implement contracts, safe fallbacks, Sanity clients, and queries**

Use fixed singleton IDs `siteSettings`, `landingPage`, and `legalSettings`. Published requests use tags; preview requests use a server-only read token and no-store behavior. Sanity absence must return fallbacks rather than crash.

- [ ] **Step 4: Implement the standalone Studio and schemas**

Model every visible landing sentence, list, CTA, section order/visibility choice, image, FAQ, character, episode concept, lead message, SEO field, social URL, legal block, product/category field, and the three initial-false flags. Enforce singleton structure and environment-driven project configuration.

- [ ] **Step 5: Add claim-safe seed data derived from `brandfoundation.md`**

The seed preserves brand doctrine, six current character concepts, and the wider ecosystem while labelling episodes as concepts and omitting fake testimonials/counts/expert claims.

- [ ] **Step 6: Run targeted and Studio verification**

Run: `npm test -- tests/content && npm --prefix studio install && npm --prefix studio run typecheck && npm --prefix studio run build`  
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/content lib/sanity studio tests/content
 git commit -m "feat: add complete Sanity content platform"
```

### Task 3: Canonical logo and brand design system

**Files:**
- Replace: `public/bibo-logo.svg`
- Create: `public/brand/bibo-mark.svg`
- Create: `public/brand/bibo-logo-monochrome.svg`
- Create: `components/brand/BiboLogo.tsx`
- Create: `components/brand/BayBackdrop.tsx`
- Create: `lib/brand/tokens.ts`
- Modify: `app/globals.css`
- Create: `app/icon.svg`
- Create: `tests/brand/logo.test.tsx`
- Create: `e2e/visual/logo.spec.ts`

**Interfaces:**
- Produces: `BiboLogo({ variant, showTagline, priority, className })` sourced from canonical SVG geometry.
- Produces: CSS variables and typed `brandTokens` for color, radius, shadow, spacing, and motion duration.

- [ ] **Step 1: Write failing structural logo tests**

Assert four separate white sticker outlines, the three sun rays, separate colored letter groups, one navy smile, accessible title/label behavior, and no duplicate inline approximation.

- [ ] **Step 2: Run tests and capture RED**

Run: `npm test -- tests/brand/logo.test.tsx`  
Expected: FAIL against the current shared silhouette logo.

- [ ] **Step 3: Redraw one canonical production SVG from the reference image**

Preserve irregular letter shapes, individual die-cut outlines, soft paper shadows, intentionally uneven baselines, sun-dot/rays, and smile. Derive React and icon usage from the canonical source rather than copying paths.

- [ ] **Step 4: Implement design tokens and backdrop primitives**

Create the cream/navy/teal/yellow/orange/purple/ocean system, typography, paper/felt shadows, focus rings, responsive spacing, and reduced-motion variables.

- [ ] **Step 5: Run tests and visual capture**

Run: `npm test -- tests/brand/logo.test.tsx && npx playwright test e2e/visual/logo.spec.ts`  
Expected: pass with screenshots at mobile and desktop widths.

- [ ] **Step 6: Commit**

```bash
git add public components/brand lib/brand app/globals.css app/icon.svg tests/brand e2e/visual/logo.spec.ts
git commit -m "feat: establish canonical Bibo visual identity"
```

### Task 4: CMS-driven landing page and GSAP narrative motion

**Files:**
- Modify: `app/page.tsx`
- Create: `components/landing/LandingPage.tsx`
- Create: `components/landing/SectionRenderer.tsx`
- Create: `components/landing/{Navbar,Hero,TrustStrip,Promise,Characters,Episodes,OfflineLoop,Pillars,Ecosystem,Testimonials,LeadCapture,Faq,FinalCta,Footer}.tsx`
- Create: `components/motion/GsapProvider.tsx`
- Create: `components/motion/useSectionReveal.ts`
- Create: `components/motion/useReducedMotion.ts`
- Create: `components/ui/Dialog.tsx`
- Create: `tests/landing/section-renderer.test.tsx`
- Create: `tests/landing/accessibility-contracts.test.tsx`
- Create: `tests/motion/reduced-motion.test.tsx`
- Create: `e2e/landing/interactions.spec.ts`

**Interfaces:**
- Consumes: `LandingPageContent`, `SiteSettings`, and brand components from Tasks 2–3.
- Produces: `LandingPage({ content, settings })` and ordered `SectionRenderer` keyed by Sanity section IDs/types.
- Produces: `useSectionReveal(scope, options)` with cleanup and reduced-motion fallback.

- [ ] **Step 1: Write failing rendering, accessibility, and reduced-motion tests**

Cover CMS order/visibility, semantic headings, keyboard-operated character/episode selectors, FAQ ARIA state, dialog focus lifecycle, anchor offset behavior, disabled testimonials, and motion-disabled rendering.

- [ ] **Step 2: Run tests and capture RED**

Run: `npm test -- tests/landing tests/motion`  
Expected: FAIL because the section system does not exist.

- [ ] **Step 3: Build the full responsive narrative**

Implement the thirteen-section sequence from the spec, using server-rendered content and client interaction only where needed. Avoid stock testimonial photography and unsupported proof copy.

- [ ] **Step 4: Add scoped GSAP animation**

Add calm hero parallax, section reveals, character/episode transitions, offline-loop path reveal, and tactile CTA feedback. Use transform/opacity, `gsap.context()` cleanup, and no content-blocking initial states.

- [ ] **Step 5: Run component tests and Playwright interactions**

Run: `npm test -- tests/landing tests/motion && npx playwright test e2e/landing/interactions.spec.ts`  
Expected: pass on Chromium mobile and desktop projects.

- [ ] **Step 6: Run build and commit**

Run: `npm run typecheck && npm run lint && npm run build`  
Then commit the landing implementation.

### Task 5: Truthful lead capture, consent, email outbox, and database policy

**Files:**
- Create: `lib/leads/schema.ts`
- Create: `lib/leads/submit.ts`
- Create: `lib/security/rate-limit.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Create: `lib/supabase/leads.ts`
- Create: `lib/email/client.ts`
- Create: `lib/email/lead-emails.tsx`
- Create: `components/forms/LeadForm.tsx`
- Create: `app/api/leads/route.ts`
- Create: `supabase/migrations/0001_leads_and_security.sql`
- Create: `supabase/tests/0001_leads_rls.sql`
- Create: `tests/leads/lead-schema.test.ts`
- Create: `tests/leads/lead-submit.test.ts`
- Create: `tests/leads/lead-copy.test.tsx`

**Interfaces:**
- Produces: `leadSubmissionSchema`, `submitLead(input, dependencies) -> LeadSubmissionResult`.
- Produces: `POST /api/leads` returning `{ok, persisted, acknowledgementQueued, message}` without false delivery claims.
- Produces database RPC `submit_lead(...)` with bounded inputs and duplicate-safe consent update.

- [ ] **Step 1: Write failing validation and orchestration tests**

Cover required adult email/consent, optional age band, honeypot rejection, shared rate limit, duplicate normalized email, persistence succeeding while email fails, and truthful user messages.

- [ ] **Step 2: Write failing SQL security assertions**

Assert forced RLS, no anonymous selects, narrow RPC execution, explicit search path, and revoked retention/internal helper execution.

- [ ] **Step 3: Run RED**

Run: `npm test -- tests/leads`  
Expected: FAIL because lead infrastructure does not exist.

- [ ] **Step 4: Implement migration, repository, API, outbox-aware email adapter, and accessible form**

The browser receives only public Supabase configuration. Server-side persistence is durable before acknowledgement is reported. Resend absence queues or records unsent state rather than faking delivery.

- [ ] **Step 5: Run targeted tests and static SQL checks**

Run: `npm test -- tests/leads && npm run typecheck && npm run lint`  
Expected: pass.

- [ ] **Step 6: Commit**

Commit lead, database, and email infrastructure as one independently testable slice.

### Task 6: Commerce feature gate and order-pad core

**Files:**
- Create: `lib/commerce/gate.ts`
- Create: `lib/orders/pad.ts`
- Create: `lib/orders/constants.ts`
- Create: `components/shop/OrderPadProvider.tsx`
- Create: `components/shop/AddToOrder.tsx`
- Create: `components/shop/OrderPadSummary.tsx`
- Create: `tests/commerce/gate.test.ts`
- Create: `tests/orders/pad.test.ts`
- Create: `tests/orders/status-transitions.test.ts`

**Interfaces:**
- Consumes: `SiteSettings.commerceEnabled` and `trackingEnabled`.
- Produces: `assertCommerceEnabled(settings)`, `isCommerceEnabled(settings)`, `OrderPadLine`, `readOrderPad(storage)`, `addOrderPadLine`, `updateOrderPadQuantity`, `clearOrderPad`.
- Storage contract: `orderpad.v1`, maximum 40 lines, maximum quantity 999, corrupt payload discarded.

- [ ] **Step 1: Write failing feature-gate and pad tests**

Cover false/missing flags, corrupted local storage, duplicate merging, line/quantity limits, stale/unlisted client data, and one-way status transitions.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/commerce tests/orders/pad.test.ts tests/orders/status-transitions.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement minimal gate, pad, and provider**

Do not mount provider or persist order-pad state while commerce is disabled.

- [ ] **Step 4: Run GREEN and commit**

Run targeted tests, typecheck, lint, and commit.

### Task 7: Catalogue, order submission, tracking, and hardened Supabase orders

**Files:**
- Create: `app/shop/page.tsx`
- Create: `app/shop/[slug]/page.tsx`
- Create: `app/order/page.tsx`
- Create: `app/track/page.tsx`
- Create: `app/orders/[token]/page.tsx`
- Create: `components/forms/OrderForm.tsx`
- Create: `components/forms/TrackOrderForm.tsx`
- Create: `lib/orders/schema.ts`
- Create: `lib/orders/catalogue.ts`
- Create: `lib/orders/submit.ts`
- Create: `lib/orders/track.ts`
- Create: `lib/supabase/orders.ts`
- Create: `app/api/orders/route.ts`
- Create: `app/api/orders/track/route.ts`
- Create: `supabase/migrations/0002_orders.sql`
- Create: `supabase/migrations/0003_order_tracking.sql`
- Create: `supabase/migrations/0004_lock_tracking_payload.sql`
- Create: `supabase/migrations/0005_shared_rate_limits_and_token_rotation.sql`
- Create: `supabase/tests/0002_orders_rls.sql`
- Create: `supabase/tests/0003_tracking_grants.sql`
- Create: `tests/orders/order-schema.test.ts`
- Create: `tests/orders/canonical-products.test.ts`
- Create: `tests/orders/order-submit.test.ts`
- Create: `tests/orders/tracking.test.ts`

**Interfaces:**
- Produces: `resolveCanonicalOrderLines(submittedIds)`, `submitOrder(input, dependencies)`, `trackOrderByToken`, `trackOrderByReferenceAndEmail`.
- Produces DB RPCs `submit_order`, `lookup_order_by_token`, `lookup_order_by_reference_email`, `rotate_order_tracking_token`.

- [ ] **Step 1: Write failing order and tracking tests**

Cover disabled commerce, product ID tampering, missing/unlisted products, no public prices, required consent, bounded addresses/notes, atomic persistence, generic lookup failure, reference-plus-email matching, token expiry/rotation, and no anonymous direct reads.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/orders/order-schema.test.ts tests/orders/canonical-products.test.ts tests/orders/order-submit.test.ts tests/orders/tracking.test.ts`  
Expected: FAIL.

- [ ] **Step 3: Implement hardened migrations and server orchestration**

Reload every product from Sanity before persistence. Snapshot canonical fields. Revoke internal function execution explicitly from public roles and set explicit search paths.

- [ ] **Step 4: Build accessible public routes and forms**

Disabled routes return controlled unavailable/not-found states. Enabled routes never collect payment credentials.

- [ ] **Step 5: Run tests, build, and commit**

Run targeted tests, typecheck, lint, and build before committing.

### Task 8: Protected staff order administration, quote outbox, and payment URL safety

**Files:**
- Create: `lib/supabase/auth.ts`
- Create: `lib/orders/admin.ts`
- Create: `lib/security/payment-url.ts`
- Create: `lib/email/order-emails.tsx`
- Create: `app/admin/login/page.tsx`
- Create: `app/admin/orders/page.tsx`
- Create: `app/admin/orders/[reference]/page.tsx`
- Create: `components/admin/OrderControls.tsx`
- Create: `app/api/admin/orders/[reference]/quote/route.ts`
- Create: `app/api/admin/orders/[reference]/status/route.ts`
- Create: `app/api/cron/email-outbox/route.ts`
- Create: `supabase/migrations/0006_order_events_and_email_outbox.sql`
- Create: `tests/admin/staff-auth.test.ts`
- Create: `tests/admin/payment-url.test.ts`
- Create: `tests/admin/quote-idempotency.test.ts`
- Create: `tests/admin/order-controls.test.ts`

**Interfaces:**
- Produces: `requireStaffUser()`, `validatePaymentUrl(url, allowedHosts)`, `saveOrderQuote`, `queueQuoteEmail`, `advanceOrderStatus`.
- Quote email idempotency key: order UUID plus quote revision/event type.

- [ ] **Step 1: Write failing staff, URL, transition, and idempotency tests**

Cover unauthenticated, authenticated non-staff, inactive staff, disallowed HTTPS hosts, repeated quote-send requests, email success plus status-update failure, and terminal-state transitions.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/admin`  
Expected: FAIL.

- [ ] **Step 3: Implement RLS-preserving staff access and admin routes**

Use Supabase `auth.getUser()` and active `staff_users`. Prefer authenticated/RLS clients for ordinary staff operations; limit service-role use to outbox/operational jobs.

- [ ] **Step 4: Implement quote outbox and payment host allowlist**

Saving a quote does not notify. Sending queues one idempotent event. Worker delivery records attempts/results and never duplicates a successful quote message.

- [ ] **Step 5: Run tests, build, and commit**

### Task 9: Legal, metadata, revalidation, health, and browser security

**Files:**
- Create: `app/privacy/page.tsx`
- Create: `app/terms/page.tsx`
- Create: `app/thank-you/page.tsx`
- Create: `app/robots.ts`
- Create: `app/sitemap.ts`
- Create: `app/manifest.ts`
- Create: `app/opengraph-image.tsx`
- Create: `app/api/revalidate/route.ts`
- Create: `app/api/health/route.ts`
- Create: `app/api/readiness/route.ts`
- Create: `lib/security/revalidation.ts`
- Modify: `next.config.ts`
- Create: `tests/security/revalidation.test.ts`
- Create: `tests/security/headers.test.ts`
- Create: `tests/seo/metadata.test.ts`
- Create: `tests/ops/health-readiness.test.ts`

**Interfaces:**
- Produces HMAC request verification with a five-minute replay window.
- Produces health JSON at HTTP 200 and readiness HTTP 200/503 based on required dependencies.

- [ ] **Step 1: Write failing security, metadata, and health tests**

Cover invalid/replayed signatures, commerce-disabled sitemap, absent social metadata, noindex behavior for incomplete legal content, CSP/security headers, and readiness 503 when production dependencies are missing.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/security tests/seo tests/ops`  
Expected: FAIL.

- [ ] **Step 3: Implement routes, metadata, revalidation, and headers**

Use canonical brand assets and verified URLs only. Product metadata contains no Offer/price schema.

- [ ] **Step 4: Run tests, build, and commit**

### Task 10: CI, secret scanning, deployment verification, and repository documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/verify-bundle-secrets.ts`
- Create: `scripts/verify-deployment.ts`
- Replace: `README.md`
- Create: `AGENTS.md`
- Create: `docs/architecture.md`
- Create: `docs/cms-operations.md`
- Create: `docs/database-security.md`
- Create: `docs/deployment.md`
- Create: `docs/manual-checkout-operations.md`
- Create: `docs/qa-checklist.md`
- Keep but mark as deprecated/audit-only: `references/test.md`, stale Google AI boilerplate files, and archive-only references
- Preserve and document as source material: `brandfoundation.md`, `styleprompt.md`, `bibo-skeleton-1`, and the logo reference asset

**Interfaces:**
- CI runs install, environment contract tests, typecheck, lint, unit/integration tests, Studio build, app build, bundle secret scan, dependency audit, and Playwright smoke where environment allows.
- `verify-deployment.ts <url>` checks status, title, meaningful body, assets, health, metadata, and console/network failures.

- [ ] **Step 1: Write failing verifier tests**

Test secret-name detection, public-prefix rejection, HTML source/script exposure, and deployment response classification.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/scripts`  
Expected: FAIL.

- [ ] **Step 3: Implement CI, verifiers, and accurate documentation**

Document exact local setup, environment ownership, Studio workflow, migrations, feature toggles, staff workflow, incident-safe production rules, and all commands.

- [ ] **Step 4: Run local CI equivalent and commit**

Run: `npm ci && npm run verify:env && npm run typecheck && npm run lint && npm run test:run && npm --prefix studio ci && npm --prefix studio run build && npm run build && npm run verify:bundle && npm audit --audit-level=high`.

### Task 11: Provision/link Sanity, Supabase, and Vercel; seed and verify infrastructure

**Files:**
- Modify only non-secret project metadata as required by official CLIs.
- Create: `docs/production-readiness.md` with verified project identifiers/URLs and no secrets.

**Interfaces:**
- External outputs: Sanity project/dataset and Studio URL, Supabase project URL/ref, Vercel project and preview URL.

- [ ] **Step 1: Verify authenticated CLI/account context without exposing tokens**

Check Vercel, Sanity, Supabase, and GitHub account/team/project state. Stop only if authentication requires a user-owned login/2FA action that tools cannot complete.

- [ ] **Step 2: Create or link dedicated Bibo Bay projects**

Use the Naaxtech-owned team/accounts. Do not reuse unrelated production databases or datasets.

- [ ] **Step 3: Configure environment variables with explicit preview/production scope**

Public identifiers and server secrets are entered through provider secret stores. Never print secret values to logs or documentation.

- [ ] **Step 4: Apply and verify Supabase migrations**

Apply in order, inspect resulting tables/policies/functions/grants, and run role-based verification. Do not insert real customer data.

- [ ] **Step 5: Deploy and seed Sanity Studio**

Seed claim-safe content, verify singleton flags are false, configure CORS/webhook origins, and read content back from the live dataset.

- [ ] **Step 6: Deploy Vercel preview**

Verify build logs, environment detection, route rendering, health/readiness behavior, and linked Git commit.

- [ ] **Step 7: Read back external state and document verified links**

A successful CLI response is insufficient; fetch project configuration and live URLs before claiming completion.

### Task 12: Full Playwright crawl, end-to-end order test, accessibility, performance, and release review

**Files:**
- Create: `e2e/crawl/public-routes.spec.ts`
- Create: `e2e/landing/responsive.spec.ts`
- Create: `e2e/landing/accessibility.spec.ts`
- Create: `e2e/leads/lead-flow.spec.ts`
- Create: `e2e/commerce/disabled.spec.ts`
- Create: `e2e/commerce/manual-order.spec.ts`
- Create: `e2e/admin/admin-security.spec.ts`
- Create: `e2e/ops/health.spec.ts`
- Create: `docs/qa-report-2026-10-02.md`

**Interfaces:**
- Consumes verified preview URLs and controlled QA credentials/configuration.
- Produces screenshots, traces on failure, route/error inventory, test-data cleanup evidence, and final readiness report.

- [ ] **Step 1: Write failing end-to-end expectations before enabling each flow**

Cover root content, navigation, modal focus, selectors, FAQ, forms, legal, 404, console/network errors, overflow, metadata, reduced motion, and commerce-disabled behavior.

- [ ] **Step 2: Run preview crawl and capture failures**

Run: `PLAYWRIGHT_BASE_URL=<preview> npx playwright test e2e/crawl e2e/landing e2e/leads e2e/commerce/disabled.spec.ts e2e/ops`.

- [ ] **Step 3: Fix release-blocking findings through test-first cycles**

Every bug receives a reproducing failing test before code changes.

- [ ] **Step 4: Exercise manual checkout in a controlled non-production state**

Temporarily enable commerce only in the controlled preview/test dataset, create `QA test ... - delete me` product/order records, verify staff quote/payment-host validation/tracking/status flow, then disable commerce and remove test records. Read back the dataset to verify cleanup.

- [ ] **Step 5: Run complete final verification**

Run: `npm ci && npm run verify:env && npm run typecheck && npm run lint && npm run test:run && npm --prefix studio ci && npm --prefix studio run build && npm run build && npm run verify:bundle && npm audit --audit-level=high && PLAYWRIGHT_BASE_URL=<verified-preview> npm run test:e2e`.

- [ ] **Step 6: Perform independent whole-branch review**

Review the complete merge-base-to-HEAD diff for spec compliance, security, data privacy, accessibility, performance, and operational correctness. Fix all Critical/Important findings and re-run affected checks.

- [ ] **Step 7: Commit final QA evidence**

Commit the QA report and production-readiness document only after outputs are fresh and verified.
