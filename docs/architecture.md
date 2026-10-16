# Architecture

How the BIBO Bay site is put together today. Planned parts are marked "not built yet (Task N)",
where Task N is a task in the implementation plan under `docs/superpowers/plans/`.

## Stack

| Part | Choice |
|---|---|
| Web app | Next.js 16.3.8 App Router, React 19.3, TypeScript 6, Tailwind CSS 4 |
| Motion | GSAP 3.15 with ScrollTrigger, scoped per section in `gsap.context()` (`components/motion/`) |
| Content | Sanity, read with `@sanity/client` (no `next-sanity`, which pulls the Sanity CLI into production dependencies) |
| Studio | Sanity Studio 6.17 in `studio/`, a separate npm project with its own lockfile |
| Private data | Supabase Postgres, called from server routes with the server-only service-role key |
| Email | Resend 6.32, optional |
| Validation | Zod 4.6 on the server; shared field rules in `lib/leads/fields.ts` for the browser |
| Tests | Vitest (jsdom) with PGlite + pgTAP for the database; Playwright (Chromium) for the browser |
| Hosting | Vercel (`vercel.json` pins `npm ci`); not provisioned yet (Task 11) |

## Folders

| Folder | Holds |
|---|---|
| `app/` | Routes, metadata files, API route handlers |
| `components/landing/` | One component per landing section, the section renderer, `ui-copy.ts` (interface labels not held in Sanity) |
| `components/brand/` | The logo renderer and the drawn scenery: `ReefBackdrop` (sunbeams, bubbles and the sandy sea floor behind the hero and the closing scene) and `BayBackdrop` (the earlier paper horizon, kept for a slot with no art at all) |
| `components/forms/` | The founding-family form (`LeadForm.tsx`) and its copy |
| `components/shop/` | The shop (Task 7b): product card and picture, catalogue grouping, `ShopFrame`, `shop.css`; the order pad (`OrderPadProvider`, mounted by the `app/(commerce)` layout through `OrderPadMount` only while commerce is on, so no other page downloads it), `AddToOrder` and `OrderPadSummary` |
| `components/admin/` | The staff pages' parts (Task 8c): `AdminFrame` (the plain frame `app/admin/layout.tsx` renders), `LoginForm`, `SignOutButton`, `OrdersTable`, `AdminNotice`, and the order controls (`OrderControls` with `QuoteForm`, `StatusControls`, `TrackingLinkControl`, `useOrderAction`), their copy (`page-copy.ts`; the API's own answers are `admin-copy.ts`) and `admin.css` |
| `components/legal/`, `components/preview/` | `SiteFrame` (header, main, footer for every page but the landing page), privacy, terms and thank-you page shells; the draft-preview notice |
| `components/motion/` | GSAP provider, reduced-motion hook, section reveals |
| `lib/content/` | Content types, normalisation, repository fallback content, fallback legal text, and `lib/content/brand-art.ts`: the registry of repository brand art (each still's size, srcset, alt text and source video) |
| `public/brand/art/` | Stills cut from the Bibo Bay channel's own videos and their thumbnails, each pre-sized at standard widths for a srcset; static files, never resized at request time |
| `lib/sanity/` | Client, queries, cached fetches, image URLs, draft mode |
| `lib/leads/`, `lib/email/`, `lib/supabase/` | Lead submission, Resend adapter and emails, Supabase adapters |
| `lib/security/` | Security headers and CSP, rate limiter, webhook signature check |
| `lib/privacy/` | Private-link masking: the token of a `/orders/<token>` link never reaches statistics or error reports (Task 7b) |
| `lib/seo/`, `lib/ops/` | Metadata, robots, sitemap, structured data; readiness checks |
| `proxy.ts` | Per-request CSP nonce (Next 16 "proxy", formerly middleware) |
| `scripts/` | `verify-env.ts`, `verify-bundle-secrets.ts`, `verify-deployment.ts`, `generate-brand-assets.ts` |
| `studio/` | Studio schema, desk structure, Presentation routes, seed script |
| `supabase/migrations/`, `supabase/tests/` | SQL migration and its pgTAP tests |
| `tests/`, `e2e/` | Vitest and Playwright suites |

## Routes

From the production build's route table (`ƒ` renders per request, `○` is static):

| Route | Kind | What it is |
|---|---|---|
| `/` | ƒ | The landing page (CMS sections, founding-family form) |
| `/privacy`, `/terms` | ƒ | Legal pages: Sanity text, or the plain-language repository fallback (then noindex) |
| `/thank-you` | ƒ | Neutral page explaining the list; never claims a signup happened; noindex |
| `/shop`, `/shop/[slug]` | ƒ | Catalogue and product pages, with no price anywhere; 404 unless commerce is enabled in the CMS, decided before the catalogue is read (Task 7b). A sold-out product keeps its page, marked sold out and noindex; a draft or unknown slug is a 404 |
| `/order` | ƒ | Order request: the order pad with names from the CMS catalogue, how paying works (nothing is charged here), and the order form; 404 unless commerce is enabled, decided before anything else is read; noindex (Task 7c) |
| `/track`, `/orders/[token]` | ƒ | Order tracking by reference plus email, and by private link; 404 unless commerce and tracking are enabled; noindex. A malformed or unknown token is the same 404; `/orders/*` sends `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow` (Task 7c) |
| `/_not-found` | ƒ | 404 page |
| `/studio` | ƒ | 307 to the Studio URL from site settings when it is https; 404 otherwise |
| `/api/leads` | ƒ | POST: founding-family signup |
| `/api/orders` | ƒ | POST: order request; 404 unless commerce is enabled in the CMS (Task 7a) |
| `/api/orders/track` | ƒ | POST: order tracking by token or reference plus email; 404 unless commerce and tracking are enabled (Task 7a) |
| `/api/cron/email-outbox` | ƒ | GET: the email outbox worker, run once a day by Vercel Cron (`vercel.json`); `Authorization: Bearer <CRON_SECRET>` or 401; answers counts only (Task 8a) |
| `/api/admin/session` | ƒ | POST: staff sign-in (email and password, Supabase Auth; rate-limited; one generic refusal); DELETE: sign-out. Same-origin JSON only; 503 without Supabase (Task 8b) |
| `/api/admin/orders/[reference]/quote` | ƒ | POST: active staff save a quote (`intent: "save"`, never notifies) or send one saved revision (`intent: "send"`, queued once, emailed after the answer) (Task 8b) |
| `/api/admin/orders/[reference]/status` | ƒ | POST: active staff move an order one step, naming the status they saw (`{from, to}`); 409 if it moved on (Task 8b) |
| `/api/admin/orders/[reference]/tracking-link` | ƒ | POST: active staff issue a new private tracking link, shown once; the old one stops working (Task 8b) |
| `/admin` | ƒ | Redirects to `/admin/orders` (Task 8c) |
| `/admin/login`, `/admin/orders`, `/admin/orders/[reference]` | ƒ | The staff pages (Task 8c): sign in, the order list with a `?status=` filter, and one order with its quote, status and tracking-link controls. Server components that read through the signed-in member's own Supabase client; a visitor who is signed out is sent to `/admin/login`; without Supabase they show a notice; `noindex`, titled "Staff"; a malformed or unknown reference is a 404 |
| `/api/health` | ƒ | GET: liveness, `{status, version, time}` |
| `/api/readiness` | ƒ | GET: configuration booleans; 200 when ready, 503 otherwise |
| `/api/revalidate` | ƒ | POST: signed Sanity webhook that expires cache tags |
| `/api/draft-mode/enable`, `/api/draft-mode/disable` | ƒ | Studio draft preview on and off |
| `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/icon.svg`, `/opengraph-image` | ○ | Metadata files |

The robots rules keep crawlers out of the private and transactional paths (`/order`, `/orders/`,
`/track`, `/admin`; `ROBOTS_DISALLOW` in `lib/seo/metadata.ts`), and the sitemap never lists them.
The header and footer show the shop link (the CMS label `navigation.commerceLabel`) only while
commerce is enabled, the footer's "Track an order" link only while tracking is enabled too, and the
sitemap lists `/shop` and the listed product pages only while commerce is on.

## Server and client boundary

- Pages and sections are React Server Components by default. Client components are only:
  `LeadForm`, `Navbar` (mobile menu), `Characters` and `Episodes` (tab selectors), `SectionShell`
  (reveals), `GsapProvider` and `Dialog`, plus the shop's `OrderPadProvider`, `AddToOrder`,
  `OrderPadSummary` and `OrderRequest` (with `OrderForm`), which do nothing unless the
  `app/(commerce)` layout mounted the pad (commerce on), and `TrackOrderForm` and `LocalTime` on the
  tracking pages. The staff pages' client components are `LoginForm`, `SignOutButton` and
  `OrderControls` (with its `QuoteForm`, `StatusControls`, `TrackingLinkControl` and
  `useOrderAction`): they call the staff APIs with same-origin JSON and may not import
  `components/admin/admin-copy.ts`, because that file names a server setting (the build-time
  bundle scan and `tests/admin/page-copy.test.ts` both enforce it). The order status view (`components/orders/OrderStatusView.tsx`) renders on the
  server for `/orders/[token]` and in the browser for `/track`.
- Every module that reads a server setting or talks to Sanity with a token, Supabase or Resend
  imports `server-only`, so importing it from a client component is a build error:
  `lib/sanity/{client,fetch,image}.ts`, `lib/leads/{submit,dependencies,http}.ts`,
  `lib/orders/{catalogue,submit,track,dependencies}.ts`,
  `lib/email/client.ts`, `lib/supabase/{admin,auth,leads,orders,server}.ts`, `lib/security/rate-limit.ts`,
  `lib/ops/readiness.ts`, and the staff modules `lib/admin/{dependencies,http,orders,session}.ts` and
  `lib/orders/admin.ts` (Task 8b) and `lib/admin/access.ts` (the staff pages' access check, Task 8c). `lib/supabase/staff-session.ts` (the staff cookie rules) is not
  server-only because `proxy.ts` imports it; it holds nothing secret, only the public Supabase URL
  and publishable key. (`lib/sanity/env.ts` reads only the public project id, dataset and API
  version; `lib/sanity/draft-mode.ts` is used only by server routes and pages.)
- The browser form imports only `lib/leads/fields.ts` (no Zod, no `process.env`); a test walks its
  import graph (`tests/leads/env-boundary.test.ts`). The order and tracking forms likewise import
  only `lib/orders/fields.ts`, `lib/orders/constants.ts` and `lib/orders/countries.ts` (and types).
- The browser never calls Supabase or Resend. The CSP's `connect-src 'self'` enforces this.
- `npm run verify:bundle` scans the built client output for server names, secret values and
  token-shaped strings; see [deployment.md](deployment.md#client-bundle-secret-scan).

## Content flow

```
Sanity (published)  ->  lib/sanity/fetch.ts  ->  lib/content/normalize.ts  ->  page
                         cached under tags        validates every field        |
                         (no CDN)                 or uses the fallback          v
                                                                       components/landing/*
Sanity unreachable / unconfigured  ->  lib/content/fallback.ts (claim-free repository content)
```

- `getSiteSettings`, `getLandingPage` and `getLegalSettings` read fixed singleton IDs
  (`siteSettings`, `landingPage`, `legalSettings`) with `perspective: "published"` and
  `next: { tags, revalidate: false }`: the result stays in Next's Data Cache until a tag is expired.
- Any error (no project configured, permissions, network) returns the repository fallback, so the
  page never fails because the CMS is down.
- Normalisation drops anything malformed: unsafe links, images without an asset, unverified social
  links, testimonials without the `verified` flag, a canonical URL not marked verified.
- Section order and visibility come from `landingPage.sections`. A missing or malformed list uses
  the fallback order; an editor's explicit list is authoritative, including omissions. Testimonials
  render only when `testimonialsEnabled` is on and at least one verified entry exists.
- CMS images render through `CmsArt` with a server-resolved Sanity CDN URL that applies the
  editor's crop and keeps the hotspot in view; decorative images get `alt=""`.

## Lead flow

```
LeadForm (browser)  --POST JSON-->  /api/leads  ->  lib/leads/submit.ts
  client checks                       415 / 413 / 400 for bad requests
                                      1 honeypot filled  -> 400, nothing counted or stored
                                      2 Zod validation   -> 400 with field codes
                                      3 storage configured?  no -> 503
                                      4 rate limit (DB, 5 per 10 min per hashed client) -> 429 / 503 if the limiter fails
                                      5 submit_lead()    -> 500 if the write fails
                                      6 outbox rows (acknowledgement, staff alert), unclaimed
                                      7 200 {ok, persisted: true, acknowledgementQueued}
                                      8 after the response, for a new signup: claim each row
                                        (claim_lead_deliveries), spend the global send cap, send
                                        if Resend is configured, record the outcome
                                      9 later: /api/cron/email-outbox retries what is still due
```

- Steps 8 and 9 use the same claim, budget, send and record step (`lib/outbox/attempt.ts`), so a
  row is never sent by both, and nothing that differs between a new and a listed address happens
  before the answer (Task 8a). Order requests follow the same pattern for the buyer acknowledgement
  and the staff order alert (`lib/outbox/orders.ts`).

- Success is shown only for `ok && persisted === true`. A mail failure after the write never turns
  the answer into an error, and no message claims an email was delivered.
- A repeat submission for a listed (or withdrawn) address changes nothing about that person and
  gets the same answer as a new one, so the form cannot reveal who is on the list.
- No raw IP address is stored. The rate-limit key is an HMAC of the client address (IPv6 bucketed
  per /64) under `LEAD_IP_HASH_SECRET`.
- The database side (tables, functions, grants) is in [database-security.md](database-security.md).

## Staff flow (Task 8b)

```
staff browser  --same-origin JSON + session cookies-->  /api/admin/...  ->  lib/admin/orders.ts
                                      1 cross-site or not JSON         -> 403, no detail, session not read
                                      2 Supabase unconfigured          -> 503
                                      3 auth.getUser() (Auth verifies the token; 5 s bound)
                                          no or refused session -> 401 · Auth unreachable -> 503
                                      4 own staff_users row, read under RLS: not active -> 403
                                      5 reference malformed -> 404 · body unreadable or invalid -> 400
                                      6 staff RPC as the signed-in user (migration 0007)
                                          not found 404 · stale 409 · not possible now 409
                                      7 200; a newly queued quote is emailed after the answer
                                        (Task 8a's claim, service role)
```

- Staff sign in with an email and password the owner created in Supabase Auth (`signInWithPassword`
  through `@supabase/ssr`). The session lives in cookies only the server writes: httpOnly, Secure
  outside localhost, SameSite=Lax, path `/`. There is no sign-up, reset or magic-link route.
- Sign-in attempts are counted per hashed client address and per keyed digest of the email (the
  Task 5 limiter, service role), before Auth is asked. A wrong password and a correct password on
  an account with no active `staff_users` row get the same 401; the second is signed out at once.
- Being signed in grants nothing: reads and writes run as the user, and the database lets them
  through only while their `staff_users` row is active. The service role is used for the sign-in
  limiter and the quote email only. Details in [database-security.md](database-security.md#staff-access-migration-0007).
- Quote payment links must be https on a host listed exactly in `PAYMENT_HOST_ALLOWLIST`
  (`lib/security/payment-url.ts`). Copy: `components/admin/admin-copy.ts`; no answer says an email
  was delivered or a payment taken.

## Staff pages (Task 8c)

- `lib/admin/access.ts` (`staffPageAccess`) answers once per request with one of four outcomes:
  `staff` (an Auth-verified user with an active `staff_users` row, plus a database client that
  reads as that user under row level security), `signed_out` (no or refused session, or a signed-in
  user who is not active staff), `unconfigured` (no Supabase settings) or `unavailable` (Auth or
  the database did not answer in time). A page may only read cookies, so the session refresh stays
  in `proxy.ts`.
- `/admin/orders` and `/admin/orders/[reference]` send `signed_out` to `/admin/login` (no `next`
  parameter: after signing in staff always land on the orders) and show a notice for the other two.
  `/admin/login` always shows the form, because the sign-in API words every refusal itself.
- Every action is a same-origin JSON `fetch` to the staff APIs above. After a 200 or a 409 the
  page calls `router.refresh()`, so every figure, revision, status, email row and event on screen
  comes from the server; a 401 loads the sign-in page. Quote money is typed in the currency's main
  unit and converted to whole minor units with integer string arithmetic (`lib/orders/quote-money.ts`;
  the currency list is fixed there).
- Quotes can be saved and queued only while an order is `new` or `confirmed`; the status buttons
  offer only the steps `nextOrderStatuses` allows and cancelling asks first; a new tracking link is
  shown once, in the page's memory only.

## Security headers and why pages are dynamic

`proxy.ts` makes a fresh nonce for every document request and sends this policy (production build):

```
default-src 'self';
script-src 'self' 'nonce-<per request>' 'strict-dynamic';
style-src-elem 'self' 'nonce-<per request>';
style-src-attr 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://cdn.sanity.io;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'self' [SANITY_STUDIO_ORIGIN when set];
upgrade-insecure-requests            (Vercel deployments only)
```

- `next dev` adds `'unsafe-eval'` (React's debugging aids) and a plain `style-src`; a production
  build never sends `'unsafe-eval'` (tested, and checked by `npm run verify:deployment`).
- API routes get `default-src 'none'; frame-ancestors 'none'` (`next.config.ts`).
- Every response also carries `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Content-Type-Options: nosniff`, a restrictive `Permissions-Policy`,
  `Cross-Origin-Opener-Policy: same-origin`, and no `X-Powered-By`. HSTS
  (`max-age=63072000; includeSubDomains`, no `preload`) is sent only by the production Vercel deployment.
- `/orders/*` (the private order pages, Task 7c) sends `Referrer-Policy: no-referrer` instead, so
  the tracking token in their address never leaves them, plus `Cache-Control: private, no-store` and
  `X-Robots-Tag: noindex, nofollow` (`PRIVATE_LINK_HEADER_RULE`).
- `/admin/*` and `/api/admin/*` (staff, Task 8b) send the same three headers
  (`ADMIN_HEADER_RULES`), and every staff API answer sets them itself too.
- On `/admin` and `/api/admin` requests only, and only when a Supabase session cookie is present,
  `proxy.ts` refreshes an expired staff session before the page or route runs, and hands the new
  cookies to both the browser and the route (a refresh token can be used once). It waits at most
  5 seconds for Supabase Auth (`STAFF_AUTH_TIMEOUT_MS`). `/api/admin` gets no page policy.
- **Why every page is rendered per request:** the HTML carries inline React Server Components
  scripts, and Next can stamp the nonce on them only when it renders the page for that request.
  The root layout awaits `connection()`; that keeps the Sanity reads in the Data Cache, so a request
  costs a render, not a CMS call. Removing the nonce to make pages static would need
  `'unsafe-inline'` scripts, which this project does not accept.

## Revalidation and draft preview

- **Publishing:** a Sanity webhook POSTs `{_type, _id}` to `/api/revalidate`, signed with
  `SANITY_REVALIDATE_SECRET` (header `sanity-webhook-signature`, HMAC-SHA256, checked before the
  body is parsed, ±5 minute window, constant-time compare). The route maps the document type to
  cache tags (`REVALIDATION_TAGS` in `lib/security/revalidation.ts`) and calls
  `revalidateTag(tag, { expire: 0 })`. `leadMagnet` maps to the `landingPage` tag because the
  landing query dereferences it. An unknown type answers `200 {revalidated: false}`.
- **Draft preview:** the Studio's Presentation tool opens `/api/draft-mode/enable` with a
  short-lived secret; `@sanity/preview-url-secret` checks it with the server-only
  `SANITY_API_READ_TOKEN`. On success Next's draft-mode cookie is set and the browser is sent to a
  same-origin path only. Pages then read drafts without caching, show a "draft preview" notice and
  become `noindex`. `/api/draft-mode/disable` turns it off. The Studio side still needs
  `previewMode.enable` wired in `studio/sanity.config.ts` (Task 11).

## Metadata and indexing

- Only the production Vercel deployment (`VERCEL_ENV=production`) is indexable. Every other server
  sends `noindex` and a robots.txt that disallows everything.
- The canonical origin is the Studio's canonical URL when an editor marked it verified, else
  `NEXT_PUBLIC_APP_URL`, else none (no canonical tag, empty sitemap).
- Legal pages are indexed only when their Sanity text carries a version; with the fallback text
  they stay noindex and `/api/readiness` reports `legalReviewed: false`.
- Structured data is Organization and WebSite only; never Product, Offer or a price.

## Legacy and archived files

Kept on purpose and never deleted. They are excluded from typecheck, lint and tests.

| File | What it is |
|---|---|
| `index.html`, `src/`, `vite.config.ts` | The original Vite prototype. `main` still builds the old GitHub Pages site from them (see the README). Not used by the Next.js app; left unedited because the Pages build uses `index.html`. |
| `metadata.json` | Prototype metadata from the tool that generated the prototype. Unused. JSON cannot carry a comment, so it is left as it is. |
| `bibo-skeleton-1` | A zip archive (no extension) of the original prototype export. Reference only. |
| `bun.lock` | The prototype's bun lockfile. npm and `package-lock.json` are canonical; do not run bun. |
| `references/test.md` | An archived placeholder note, marked audit-only. |
| `references/bibo-channel-mark.jpg` | Source material: the YouTube channel's mark, which the canonical logo `public/bibo-logo.svg` is traced from. The channel is the brand authority. |
| `references/bibo-logo.jpg` | Earlier reference artwork, kept for history; no longer the logo's source. |
| `brandfoundation.md`, `styleprompt.md` | Source material: brand foundation and visual style brief. |
| `CLAUDE.md` | A one-line pointer to `AGENTS.md`, written by `next dev`. |
