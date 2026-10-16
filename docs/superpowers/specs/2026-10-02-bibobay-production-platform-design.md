# Bibo Bay Production Platform Design

**Date:** October 2, 2026  
**Status:** Approved for autonomous execution by the user's explicit instruction to complete the project end-to-end without intermediate approval pauses.  
**Repository:** the public `bibobay-lp` repository (the workspace path is omitted on purpose)  
**Implementation branch/worktree:** `feat/bibobay-production-ready`, built in a separate git worktree of the same repository

## 1. Product intent

BIBO is the trusted master brand. BIBO Bay is its entertainment and character universe: a warm, imaginative place where stories entertain first and quietly reinforce curiosity, kindness, emotional literacy, capable independence, imagination, and care for the planet.

The landing page must earn parent trust before asking for an email. It must feel like a premium children's story world rather than a generic SaaS page or a hyper-stimulating children's site. The page should make three truths immediately clear:

1. Children should want to enter BIBO Bay.
2. Parents should understand what makes the content worthwhile.
3. Every public claim must be supportable, editable, and safe to publish.

The primary launch conversion is a founding-family email signup. The manual shop/order system will be complete but disabled by default until operations, catalogue, email delivery, and payment-link procedures are ready.

## 2. Verified current-state constraints

- The current GitHub Pages deployment is blank because it serves source files instead of a Vite build.
- The repository has no CMS, database, API, checkout, email delivery, Playwright suite, or Vercel configuration.
- Both current signup forms simulate success and claim delivery without persisting data or sending email.
- No official BIBO Bay social profile or custom domain was verified on October 2, 2026.
- No final character art, episode media, starter-pack file, verified testimonials, named educational experts, or public research citations exist in the repository.
- The current logo SVG is an approximation and is duplicated in two files.
- Two earlier private projects by the same owner provide the reference manual-order architecture; the later one is the more reusable baseline.

## 3. Binding product rulings

1. **Truth over social proof.** Remove or hide unsupported counts, testimonials, expert endorsements, distribution promises, and delivery claims. Sanity may contain testimonial and proof sections, but they remain disabled until verified content is entered.
2. **No child data.** Forms collect adult/guardian information only. Child age interest is optional and limited to broad bands; no child name, birthday, photo, voice, health, school, or precise location is collected.
3. **No fake delivery.** Signup success means the record was accepted. The UI must distinguish “joined the list” from “email delivered.” If no starter pack exists, copy must not promise an attachment.
4. **Commerce defaults off.** `commerceEnabled` is `false` in Sanity and server fallback configuration. Hiding links is not security; order submission independently rejects requests while disabled.
5. **No card handling.** Manual checkout is an order-request and staff-issued payment-link workflow. BIBO never collects card numbers or bank credentials.
6. **No invented social links.** Social icons render only for verified URLs configured in Sanity.
7. **No invented production domain.** Use the verified Vercel URL until DNS is supplied and verified.
8. **One canonical logo.** A single production SVG drives the header, footer, favicon, metadata image composition, and reusable React component.
9. **Separate content and private data.** Sanity owns editorial content and presentation flags. Supabase owns leads, consent, orders, staff authorization, tracking tokens, delivery events, and audit events.
10. **Production data is deny-by-default.** Supabase RLS is enabled and forced. Browser clients never receive a service-role key. Administrative writes are authenticated, audited, and permission checked.

## 4. Chosen architecture

Migrate the root web application from Vite to **Next.js 16.3.8 App Router**, React 19.3, TypeScript, and Tailwind CSS. This is preferred over extending the Vite SPA because the project now requires server rendering, secure server actions/routes, previews, revalidation, SEO, protected admin surfaces, and Vercel deployment. It also aligns with the proven implementation in those two earlier projects.

The repository will contain:

- A root Next.js web application for the public site, shop/order routes, tracking, admin, APIs, and preview rendering.
- A standalone Sanity Studio in `studio/`, configured entirely through environment variables and deployable independently.
- Versioned Supabase migrations in `supabase/migrations/`.
- Unit/integration tests with Vitest and browser tests with Playwright.
- Vercel configuration only where platform defaults are insufficient; security headers and predictable build settings remain explicit.

### Runtime boundaries

- **Next server components:** fetch published Sanity content, generate metadata, render the page shell, and gate commerce routes.
- **Client components:** GSAP motion, character/episode interactions, accordion, modal, order pad, and forms.
- **Route handlers/server actions:** lead submission, order submission, tracking lookup, admin order changes, Sanity revalidation, health/readiness, and preview control.
- **Sanity:** public/editorial content, section ordering and visibility, assets, SEO, social URLs, downloads, and feature flags.
- **Supabase:** private/user-generated and operational data.
- **Resend:** transactional email only when configured and verified.

## 5. Information architecture

### Public routes

- `/` — CMS-driven landing page.
- `/privacy` — privacy notice editable in Sanity with a safe repository fallback.
- `/terms` — terms editable in Sanity with a safe repository fallback.
- `/thank-you` — confirmed signup state without false email claims.
- `/shop` — catalogue; returns not found or “coming soon” while commerce is disabled.
- `/shop/[slug]` — product detail, no public price.
- `/order` — review order pad and submit request.
- `/track` — reference plus email lookup form.
- `/orders/[token]` — private status link.

### Staff routes

- `/admin/login`
- `/admin/orders`
- `/admin/orders/[reference]`

Staff access requires Supabase Auth plus an active row in `staff_users`. Being authenticated alone grants no order access.

### Studio

The Studio remains a standalone app under `studio/`. Production may use Sanity-hosted Studio or a dedicated Vercel project. The website exposes a safe `/studio` redirect only after a verified Studio URL is configured.

## 6. Landing-page narrative and visual system

### Creative direction

The experience is an **organic editorial storybook world**: calm ocean light, cut-paper forms, rounded tactile surfaces, generous breathing room, and character-led discovery. It should feel hand-shaped and warm, not glossy, synthetic, or frenetic.

Visual principles:

- Cream paper background rather than pure white.
- Deep navy for trust and legibility.
- BIBO logo colors as accents: sea teal, sun yellow, warm orange, and soft purple.
- Ocean cyan and seagrass green as secondary system colors.
- Large rounded display type paired with a highly readable body face.
- Layered paper, felt, shell, ripple, and sun motifs used sparingly.
- Photography is not used as fake proof. Until real art exists, illustrations are abstract world-building forms and honest character placeholders.

### Section sequence

The default CMS seed preserves the strongest existing ideas but rewrites unsupported claims:

1. **Navigation** — logo, story anchors, founding-family CTA, optional commerce link.
2. **Hero: “Where bright little adventures begin.”** — brand idea, concise parent promise, two CTAs, animated Bay horizon.
3. **Trust strip** — factual principles only: story-first, gentle pacing, screen-to-real-life, parent-guided.
4. **The BIBO Bay promise** — explains “Entertain first. Enrich always.”
5. **Meet the Bay friends** — six CMS characters with art-ready asset fields and accessible selector behavior.
6. **Story previews** — episode concepts clearly labelled as previews/concepts until real media exists.
7. **From screen to real life** — watch, wonder, make, explore loop.
8. **What children can practise** — curiosity, kindness, feelings, capable action, imagination, planet care.
9. **The wider BIBO world** — Academy, Lab, Play, Planet, Makes, Books, at Home, Shop; statuses controlled in CMS.
10. **Evidence/testimonials** — hidden by default; renders only verified, enabled entries.
11. **Founding families signup** — real submission, explicit adult consent, honest success/failure states.
12. **FAQ** — CMS-driven and claim-safe.
13. **Footer** — legal routes, verified socials only, contact only when configured.

### Logo specification

The production mark must preserve the reference image's character:

- Four individually irregular, hand-cut letter stickers rather than one shared blob.
- First `B`: broad, left-leaning turquoise form with uneven counters.
- `I`: yellow rounded stem; the dot is a sun with three separate rays in orange, coral, and teal.
- Second `B`: warm orange-red, slightly taller and heavier than the first.
- `O`: purple, rounded but asymmetrical with an off-centre vertical counter.
- Each letter has its own thick white die-cut border and soft down-right paper shadow.
- A deep navy smile sits below the word with rounded endpoints.
- Letter baselines and rotations remain intentionally imperfect.

Responsive simplification may reduce shadow blur and omit the tagline; it may not merge the four sticker outlines or regularize the letterforms.

## 7. Motion system

Use GSAP 3.15 with `@gsap/react`-style scoped lifecycle handling or an equivalent `gsap.context()` wrapper.

Motion is narrative, not decorative noise:

- Hero: slow parallax between sun, waves, paper clouds, and logo; content remains readable before animation initializes.
- Section entrances: short opacity/vertical reveals with staggered children.
- Character selector: crossfade/slide with no layout jump.
- Episode previews: timeline-style progress and calm transitions.
- Screen-to-life loop: sequential path reveal on scroll.
- CTA feedback: tactile scale/press motion under 180 ms.

Rules:

- Respect `prefers-reduced-motion`; disable parallax, scrubbed timelines, confetti, and nonessential movement.
- Never hide content solely for animation.
- Kill timelines and ScrollTriggers on unmount.
- Avoid infinite motion except extremely subtle ambient hero drift that also stops under reduced motion.
- Maintain 60 fps on a mid-tier mobile device by animating transform and opacity rather than layout.

## 8. Sanity content model

### Singleton documents

- `siteSettings`
  - site title, short description, canonical URL
  - `commerceEnabled` (initial `false`)
  - `trackingEnabled` (initial `false`)
  - `testimonialsEnabled` (initial `false`)
  - Studio/public contact configuration
  - verified social links
  - default SEO
  - navigation and footer settings
- `landingPage`
  - ordered array of typed section references/objects
  - hero, trust strip, promise, characters, episode previews, offline loop, pillars, ecosystem, testimonials, lead capture, FAQ, final CTA
- `legalSettings`
  - privacy and terms portable text, version dates, consent-copy version

### Collection documents

- `character`
- `episodePreview`
- `brandPillar`
- `ecosystemEntry`
- `testimonial`
- `faqItem`
- `leadMagnet`
- `productCategory`
- `product`

### Shared objects

- `seo`
- `imageWithAlt`
- `cta`
- `socialLink`
- `sectionTheme`
- `portableContent`
- `commerceNotice`

Every visible landing-page sentence, image, list, status, CTA, section ordering choice, and visibility flag must be represented in Sanity. Repository fallbacks exist only to keep the site operational when Sanity is unavailable; editors control the live published experience.

Singletons use fixed document IDs. GROQ queries target those IDs directly. Studio structure prevents duplicate singleton creation. Presentation resolves landing, legal, shop, and product routes. Preview uses drafts without caching; published requests use tags and revalidation.

## 9. Lead capture design

### Data collected

- Adult email (required)
- Adult first name (optional)
- Broad child age interest band (optional)
- Explicit consent to receive BIBO updates (required for marketing)
- Consent copy version, source, UTM data, locale, and server timestamp
- Honeypot and abuse metadata stored only as needed for security

### Submission behavior

1. Client validates for immediate feedback.
2. Server validates independently with Zod.
3. Shared durable rate limit runs in Supabase, not process memory.
4. Server inserts through a security-definer RPC or protected route using minimum privilege.
5. Duplicate email submissions update consent metadata safely rather than creating uncontrolled duplicates.
6. If Resend is configured, send a truthful acknowledgement and optional verified download link.
7. If email fails after persistence, mark delivery status for retry; do not tell the user the database write failed.
8. UI reports “You're on the list” only after durable persistence.

## 10. Manual checkout design

### Customer flow

1. Sanity catalogue contains products and categories with no public prices.
2. A product must be `listed == true` and commerce must be enabled.
3. Customer adds products to local `orderpad.v1`; duplicates merge, malformed data is discarded, and limits are enforced.
4. `/order` collects adult contact, delivery address, notes, consent, and product quantities. It explicitly states that no payment is taken.
5. The server reloads every submitted `sanityId` from Sanity and snapshots canonical title, SKU, variant, and pack information. Client-provided product names are never trusted.
6. Supabase atomically creates the order and lines, then records an audit event.
7. Staff receives an operational notification and the buyer receives an acknowledgement without prices.
8. Staff sets subtotal, freight, currency, and a payment URL whose hostname must match an environment allowlist.
9. A separate, explicit action sends the quote/payment link. This action is idempotent through an outbox/event key.
10. Staff manually advances one-way statuses: `new → confirmed → paid → dispatched → closed`; cancellation is allowed before terminal completion.
11. Customer tracks by private rotating token or reference plus matching email. References alone reveal nothing.

### Server gating

When commerce is disabled:

- Public shop/order/track navigation and sitemap entries disappear.
- Public catalogue/product/order/tracking routes return a controlled unavailable state or not found.
- Order submission rejects with a non-enumerating response.
- Order-pad providers are not mounted.
- Admin remains available to authorized staff.

## 11. Supabase data model and security

### Tables

- `lead_submissions`
- `lead_delivery_events`
- `rate_limit_buckets`
- `staff_users`
- `orders`
- `order_items`
- `order_events`
- `order_email_outbox`
- `webhook_events`

### Critical columns

`lead_submissions`: normalized email, adult first name, age band, consent state/version/time, source/UTM, delivery status, created/updated timestamps.

`orders`: UUID, human reference, private tracking token hash/current token metadata, contact and delivery fields, consent timestamp/version, status, currency, subtotal/freight totals, approved payment URL, quote-sent timestamp, retention metadata, created/updated timestamps.

`order_items`: order FK, canonical Sanity ID, SKU, title, variant/pack snapshot, quantity.

`order_events`: actor, event type, old/new status, metadata, timestamp.

### Database controls

- RLS enabled and forced on all private tables.
- Anonymous browser users have no direct select access to leads or orders.
- Public submissions use narrow RPCs with bounded arguments and explicit `search_path`.
- Internal payload builder functions are revoked from `PUBLIC`, `anon`, and `authenticated`.
- Staff RLS checks `auth.uid()` against active `staff_users` rows.
- Service role is server-only and used only where ordinary authenticated RLS cannot satisfy the operation.
- Tracking functions return generic failure responses and compare normalized email.
- Tracking tokens support expiry/rotation.
- Rate limiting is database-backed and shared across serverless instances.
- Retention functions are not executable by public roles.
- Migration tests assert policy and function grants.

## 12. Email and operational integrations

Resend is the default transactional provider because the reference implementation already establishes its pattern. Required messages:

- Lead acknowledgement
- Staff lead alert (optional)
- Order received acknowledgement
- Staff order alert
- Quote/payment-link email
- Status update email (optional by state)

All messages are branded but plain enough to render safely. Email failures are persisted for retry. No secrets, API tokens, or payment details appear in Sanity.

## 13. Accessibility and content safety

- WCAG 2.2 AA target.
- Semantic landmarks and heading order.
- Fully keyboard-operable navigation, tabs/selectors, accordions, dialogs, shop, order pad, tracking, and admin controls.
- Modal focus trap, Escape close, focus restoration, labelled controls, and body scroll lock.
- Live regions for validation and submission results.
- Minimum target sizes and visible focus states.
- Alt text required for CMS images; decorative images have empty alt.
- Reduced-motion behavior is tested.
- No manipulative scarcity, fake counts, or pressure directed at children.
- CTAs address parents/guardians, not children.

## 14. SEO, metadata, and trust

- Server-rendered metadata from Sanity with repository defaults.
- Canonical URL only after the production URL is verified.
- Open Graph and Twitter images generated from canonical brand assets.
- `robots.txt`, sitemap, web manifest, favicons, and Organization/Brand/Website structured data.
- Product structured data omits price/Offer because the catalogue is enquiry-based.
- Legal routes are indexed only after non-placeholder content exists.
- Broken or absent social accounts never render.
- Contact details render only when verified.

## 15. Deployment architecture

### Vercel

- Link the root Next.js application to a dedicated Bibo Bay Vercel project.
- Production branch remains a feature branch until review; final production-branch selection is set deliberately after approval/merge.
- Preview and production environments use separate values where appropriate.
- Public variables: Sanity project ID/dataset/api version, Supabase URL/publishable key, app URL.
- Server-only variables: Sanity read token if private, Sanity revalidation secret, Supabase service role, Resend key, staff notification address, payment host allowlist, cron/outbox secret.
- Security headers include CSP, frame restrictions, referrer policy, permissions policy, and HSTS on production HTTPS.
- `/api/health` reports configuration; `/api/readiness` returns 503 when required production dependencies are unavailable.

### Sanity

- Create or link a dedicated Bibo Bay project and production dataset.
- Deploy standalone Studio under a verified Studio URL.
- Seed the brand doctrine and rewritten claim-safe content.
- Configure CORS only for verified local, preview, production, and Studio origins.
- Configure signed revalidation webhooks.

### Supabase

- Create or link a dedicated project.
- Apply migrations only after local/static review.
- Verify RLS and grants against the live project.
- Create staff identities through Supabase Auth; never commit credentials.
- Protect production data through least privilege, backups/platform defaults, and no destructive test cleanup outside records explicitly created by QA.

## 16. Testing strategy

### Unit and integration

- Content normalization and fallback selection.
- Sanity section ordering/visibility.
- Lead validation, consent, duplicate handling, and truthful result messages.
- Order-pad parsing, limits, duplicate merging, and corruption recovery.
- Server canonical product resolution.
- Commerce-disabled enforcement.
- Status transition rules.
- Payment URL hostname allowlist.
- Tracking token/reference-email authorization.
- Rate limiting and non-enumerating failures.

### Database verification

- Migration lint/application in a disposable or linked development environment.
- RLS tests for anon, authenticated non-staff, staff, and service roles.
- Function grant tests, especially internal tracking payload functions.
- Atomic order creation and audit event creation.
- Retention function permission tests.

### Playwright

- Crawl all public, legal, commerce-disabled, tracking, error, and 404 routes.
- Desktop 1440×900, tablet, and mobile 390×844.
- Navigation anchors and mobile menu.
- Character, episode, FAQ, modal, and form interactions.
- Keyboard-only and reduced-motion paths.
- Lead success/failure with isolated QA records.
- CMS section visibility and ordering.
- Commerce hidden by default; enabled test against controlled preview configuration.
- Unauthorized API and admin access rejection.
- Order creation, staff quote flow, tracking, and cleanup in a non-production dataset.
- Console errors, unhandled rejections, failed network requests, missing assets, horizontal overflow, broken links, metadata, and screenshots.

## 17. Release acceptance criteria

The project is production-ready only when all are true:

1. Root page renders meaningful content on the verified Vercel URL.
2. Typecheck, lint, unit/integration tests, production build, dependency/security scan, and Playwright pass.
3. All visible landing content is editable in Sanity and has safe fallbacks.
4. The logo has one canonical source and matches the reference's individual sticker treatment.
5. Signup persists to Supabase and never fabricates email delivery.
6. Commerce is disabled by default and server-enforced.
7. Manual ordering works end-to-end in the controlled test environment.
8. RLS and function grants prevent anonymous/private data reads.
9. No service-role or secret value is exposed to the client bundle or repository.
10. Unsupported social proof and unverifiable claims are absent from the published page.
11. Legal routes contain explicit non-placeholder text or remain non-indexed with a clearly reported legal-review blocker.
12. Vercel, Sanity Studio, and Supabase project identifiers/links are verified and reported without exposing secrets.
13. Production test data is either never created or is explicitly named, removed, and verified absent.

## 18. Non-goals for this implementation

- Producing final animated episodes, audio, or character illustration assets.
- Inventing testimonials, expert endorsements, research citations, social profiles, contact details, or release partnerships.
- Collecting or processing children's personal data.
- Taking card payments directly.
- Purchasing or configuring an unowned custom domain without account/DNS access.

The site will be complete and operational without pretending those external brand assets or business approvals already exist.
