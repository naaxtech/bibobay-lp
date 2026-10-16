# Gated activity pack — the free download only after an email signup

Spec: `docs/superpowers/specs/2026-10-02-bibobay-production-platform-design.md` (§8 lead capture, §9 leads) as amended by the owner on 2026-10-16: "They should only be able to download the free pack once they sign up with their email, we need to collect their emails." This overrides ruling R66 ("no sign-up: the link is the file"). Ruling R140 in the ledger records the override.

## Outcome

A visitor cannot fetch the activity pack without joining the founding-family list. After the website confirms the signup was stored, the page shows a download button for the pack, and the acknowledgement email carries a download link. The PDF leaves `public/` and is served only by a signed-token route.

## Global constraints

- Nothing a visitor typed is echoed back; the token carries no email, no lead id, no personal data: only the file name and an expiry.
- Secrets never in code, tests, logs or analytics. The token's signing key is derived from `LEAD_IP_HASH_SECRET` (HKDF), which configured deployments already have (the rate limiter needs it). No new environment variable.
- A download link is shown or emailed only after the database confirmed the write (`persisted: true`), never optimistically.
- Analytics never receive the token: the `freebie_downloaded` event's `file` property is a pathname, never a query string.
- Public repository hygiene: no local paths, no owner emails, no private project names in tracked files.
- Every non-obvious dependency fact carries `// src: <path or url> · <version> · <date>` (research-protocol). Installed: next 16.3.8, react 19.3, vitest 5, playwright 1.63, Node 24 on CI/Vercel (local 26).
- No feature is deleted: the card keeps its previews, title, description and size; the form keeps every field and every outcome; the email keeps every line and gains the link wording.
- TDD: each task writes its failing tests first and watches them fail before implementing.

## Shared interfaces (fixed here; tasks do not renegotiate them)

```ts
// lib/content/freebie-path.ts (added by the controller before dispatch)
/** The signed-download route. Never a public file: the pack is served only through it. */
export const DOWNLOAD_ROUTE = "/api/freebies/download";

// lib/freebies/token.ts  (Task 1, "server-only")
export const IMMEDIATE_DOWNLOAD_TTL_SECONDS = 24 * 60 * 60;        // the link the form shows
export const EMAIL_DOWNLOAD_TTL_SECONDS = 30 * 24 * 60 * 60;        // the link in the acknowledgement
export const TOKEN_QUERY = "t";
export function signDownloadToken(input: { fileUrl: string; ttlSeconds: number }, env?: Record<string, string | undefined>, nowMs?: number): string | null;
export type TokenVerdict = { ok: true; fileUrl: string } | { ok: false; reason: "unconfigured" | "malformed" | "signature" | "expired" };
export function verifyDownloadToken(token: string | null | undefined, env?: Record<string, string | undefined>, nowMs?: number): TokenVerdict;
/** `/api/freebies/download?t=<token>` */
export function downloadPath(token: string): string;

// lib/freebies/file.ts  (Task 1, "server-only")
export const FREEBIE_CONTENT_DIR = "content/freebies";
/** The repository file for a FREEBIE_PATH url (e.g. "/freebies/bibo-bay-activity-pack.pdf" → "<cwd>/content/freebies/bibo-bay-activity-pack.pdf"), or null for anything else. */
export function freebieFilePath(fileUrl: string, cwd?: string): string | null;

// POST /api/leads 200 body (Task 3 adds the optional member; Task 2 reads it)
interface LeadApiBody { ok: boolean; persisted: boolean; acknowledgementQueued: boolean; message: string; fieldErrors?: …;
  /** Present only on a persisted signup when a download is configured: a same-origin signed path or an https file. */
  download?: { url: string; title: string } }

// lib/leads/dependencies.ts (Task 3)
export function leadMagnetFrom(lead, settings, env): LeadMagnetLink | null;   // for the email: absolute https signed link, EMAIL ttl
export function immediateDownloadFrom(lead, env): { url: string; title: string } | null; // for the answer: downloadPath(token), IMMEDIATE ttl
// LeadSubmissionDependencies gains `download: { url: string; title: string } | null`
```

Token format (Task 1): `base64url(JSON {f: fileUrl, e: expiryUnixSeconds}) + "." + base64url(HMAC-SHA256(key, payloadBase64url))`. Key = `hkdfSync("sha256", LEAD_IP_HASH_SECRET, "" (salt), "bibobay freebie download v1" (info), 32)`. Secret read through `hashSecretFrom(env)` from `lib/leads/dependencies.ts` (null when missing or shorter than 32 → `unconfigured`). Signature compare with `timingSafeEqual` after a length check. `f` must match `FREEBIE_PATH`; anything else is `malformed`.

Route (Task 1): `GET /api/freebies/download?t=…` →
- 200 with the PDF bytes, headers `content-type: application/pdf`, `content-disposition: attachment; filename="<name>.pdf"`, `content-length`, `cache-control: private, no-store`, `x-robots-tag: noindex, nofollow`, `referrer-policy: no-referrer`;
- 404 (text/plain "Not found") when the token is missing, malformed, has a bad signature, or names a file that does not exist;
- 410 (text/plain "This download link has expired. Sign up again on the page to get a new one.") when expired;
- 503 (text/plain "Downloads are not open yet.") when `unconfigured`.
Checks run in this order: missing/malformed → 404; unconfigured → 503; signature → 404; expired → 410; file → 404.

Keyless preview behaviour (no database, no secret): the card is locked, the form answers "Signups are not open yet", the old public path answers 404, the route answers 404 (no token) or 503 (a well-formed token). Nothing lies.

## Task 1 — Token, file and the download route (server)

Files owned: `lib/freebies/token.ts`, `lib/freebies/file.ts`, `app/api/freebies/download/route.ts`, `next.config.ts`, `scripts/freebie/build_activity_pack.py` (paths and docstring only), `tests/freebie/activity-pack.test.ts`, new `tests/freebies/token.test.ts`, `tests/freebies/download-route.test.ts`, `docs/cms-operations.md` (lines 100-125: where the PDF lives and how it is served).

The controller has already moved `public/freebies/bibo-bay-activity-pack.pdf` to `content/freebies/bibo-bay-activity-pack.pdf` (git mv) and added `DOWNLOAD_ROUTE` to `lib/content/freebie-path.ts`. The six WebP previews stay in `public/freebies/`.

1. Tests first (watch them fail):
   - `tests/freebies/token.test.ts`: round trip for `/freebies/bibo-bay-activity-pack.pdf` with a 40-char secret; `null`/`unconfigured` without a secret and with a 31-char secret; tampered payload → `signature`; tampered signature → `signature`; `nowMs` past expiry → `expired`; `"abc"`, `""`, `"a.b.c"`, non-JSON payload, payload whose `f` is `"/etc/passwd"` or `"https://x/y.pdf"` → `malformed`; `downloadPath("x")` is `"/api/freebies/download?t=x"`; a token signed with one secret does not verify under another.
   - `tests/freebies/download-route.test.ts`: import `GET` from the route; use `vi.stubEnv("LEAD_IP_HASH_SECRET", …)`; a signed token → 200, `content-type` `application/pdf`, body length = manifest bytes, `content-disposition` `attachment; filename="bibo-bay-activity-pack.pdf"`, `cache-control` `private, no-store`, `x-robots-tag` present; no `t` → 404; `t=garbage` → 404; expired (sign with `nowMs` in the past and `ttlSeconds: 1`) → 410; no secret → 503; a valid token for a FREEBIE_PATH name that is not on disk (`/freebies/nothing-here.pdf`) → 404; the 404/410/503 bodies are plain text and the error answers carry `cache-control: private, no-store`.
   - `tests/freebie/activity-pack.test.ts`: the PDF is read from `content/freebies` (the previews still from `public`); the test titled "is what the site's fallback copy offers, available and free" becomes "is what the site's fallback copy offers, available behind the signup" (same assertions); add: `public/freebies/bibo-bay-activity-pack.pdf` does not exist (`existsSync` false) — the file must never return to `public/`.
2. Implement `lib/freebies/token.ts`, `lib/freebies/file.ts` (resolve only `FREEBIE_PATH` names under `content/freebies`, `path.join(cwd, "content", fileUrl)`; reject anything else), and the route (`export const runtime = "nodejs"; export const dynamic = "force-dynamic";` read with `readFile`, answer `new Response(new Uint8Array(bytes), …)`).
3. `next.config.ts`: add `outputFileTracingIncludes: { "/api/freebies/download": ["./content/freebies/*.pdf"] }` with a `// src: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md · next 16.3.8 · 2026-10-16` line (keys are route globs matched against the route path; values are globs from the project root). Then prove it: `npm run build` and confirm `.next/server/app/api/freebies/download/route.js.nft.json` lists `content/freebies/bibo-bay-activity-pack.pdf`; put the exact line in the report. Build on D: if the tree's `.next` is in use (`D:\Work\_scratch\bibobay\`), never on C:.
4. `scripts/freebie/build_activity_pack.py`: `OUT_DIR` for the PDF becomes `ROOT / "content" / "freebies"`, previews keep `ROOT / "public" / "freebies"`; update the docstring (lines 17-18). Do not run the generator (it needs uv/Python and fonts); do not touch the manifest.
5. `docs/cms-operations.md` lines 100-125: the pack lives in `content/freebies/`, is served only through the signed route after a signup, and `/freebies/*.pdf` is the CMS identity of a repository file, not a public address.

Done when: the new tests pass, `tests/freebie` passes, `npx tsc --noEmit -p tsconfig.json` is clean, `npm run lint` is clean, and the nft.json line is in the report.

## Task 2 — The locked card, the form's download button, copy, analytics, e2e (UI)

Files owned: `components/landing/FreebieCard.tsx`, `components/landing/LeadCapture.tsx` (only if needed), `components/landing/ui-copy.ts`, `components/landing/landing.css`, `components/forms/LeadForm.tsx`, `components/forms/form-copy.ts`, `components/forms/lead-form.css`, `lib/content/fallback.ts` (the `lead` entry only), `studio/scripts/seed-data.ts` (the same sentence), `lib/analytics/classify.ts`, `docs/observability.md` (the `freebie_downloaded` row), `e2e/landing/freebie-youtube.spec.ts`, `e2e/leads/lead-form.spec.ts` (only if it asserts the old link), `e2e/crawl/public-routes.spec.ts` (only if it lists the PDF), and the tests under `tests/landing/`, `tests/leads/lead-copy.test.tsx`, `tests/analytics/classify.test.ts`, `tests/content/` that cover these.

1. Tests first (watch them fail):
   - FreebieCard: renders the previews, title, description and meta as before; renders NO link whose href matches `FREEBIE_PATH`; renders a link with the words "Get the free pack" whose href is `#lead-form`; the accessible name is `Get the free pack: <title>`.
   - LeadForm (jsdom, the existing test style in `tests/leads/lead-copy.test.tsx` or a new `tests/leads/lead-form-download.test.tsx`): a 200 answer with `download: { url: "/api/freebies/download?t=abc", title: "Bibo Bay Activity Pack" }` renders, after the success message, a link "Download the free pack" with that href, the `download` attribute, and accessible name `Download the free pack: Bibo Bay Activity Pack`; a 200 answer without `download` renders no such link; a 200 answer with `download.url` of `"javascript:alert(1)"`, `"//evil.example/x.pdf"`, `"/anything-else"` renders no link (only a same-origin path starting with `/api/freebies/download?` or an `https:` URL is accepted; an https URL gets no `download` attribute); a 503 answer renders no link; the link is announced once (it sits outside the live status line).
   - classify: a same-origin click on `/api/freebies/download?t=secret` classifies as `freebie_downloaded` with `file: "/api/freebies/download"` and the token absent from every property; the old `/freebies/*.pdf` classification stays.
   - Fallback copy: `SAFE_FALLBACK_CONTENT.lead.description` no longer contains "no sign-up"; `buttonLabel` is "Get the free pack".
2. Implement:
   - `FreebieCard`: keep everything except the file link. The button becomes `<a href="#lead-form" className="btn btn-primary freebie-card__download" aria-label={`${UI_COPY.getFreebie}: ${magnet.title}`}>` with the glyph and `UI_COPY.getFreebie` ("Get the free pack"); under it a line `UI_COPY.freebieGate` = "Sign up with your email and the download is yours straight away. We also email you the link." (a `<p className="freebie-card__gate">`). Drop the `download` attribute logic. Update the component comment (the R66 sentence) to R140. The card prop type becomes `LeadMagnet & { fileUrl: string }` still (the identity decides previews).
   - `LeadForm`: give the `<form>` `id="lead-form"` (nothing else on the page uses it; check with grep). Add `download` state set from a 200 answer only when `answer.persisted === true` and the shape is valid (see the test). Render, after the outcome block and outside the `role="status"` line, when present: `<p className="lead-form__download-lead">{FORM_COPY.downloadReady}</p>` and the link `<a className="btn btn-primary lead-form__download" href={url} {...(sameOrigin ? { download: "" } : {})} aria-label={`${UI_COPY.downloadFreebie}: ${title}`}>` with the glyph and `UI_COPY.downloadFreebie`. Move `DownloadGlyph` to `components/landing/DownloadGlyph.tsx` so both files share it. `FORM_COPY.downloadReady` = "Your download is ready:". Clear `download` when a new submit starts. Keep "nothing the visitor typed" (R70).
   - `ui-copy.ts`: add `getFreebie` and `freebieGate`; keep `downloadFreebie` and `freebieMeta`.
   - `fallback.ts` `lead`: description → "Sign up with your email and the free activity pack is yours to download straight away. We also send the link to your inbox, with news of new adventures."; `buttonLabel` → "Get the free pack"; everything else unchanged. Mirror the same two strings in `studio/scripts/seed-data.ts` line 97.
   - `classify.ts`: also classify `url.pathname === DOWNLOAD_ROUTE` (same origin) as `freebie_downloaded` with `file: url.pathname` (never `url.search`). Import `DOWNLOAD_ROUTE` from `../content/freebie-path`.
   - CSS: `.freebie-card__gate` (small, `--ink-soft`), `.lead-form__download-lead`, `.lead-form__download` (full width on phones, matches `.btn-primary`). No layout jump in the status line: the download block sits below the reserved outcome wrappers.
   - `docs/observability.md`: the `freebie_downloaded` row names the signed route.
3. E2E `e2e/landing/freebie-youtube.spec.ts`, first test, per viewport: the card is visible with its three renders and meta; the card has no link to `ACTIVITY_PACK.fileUrl` (`card.locator('a[href$=".pdf"]')` count 0); the "Get the free pack" link has href `#lead-form` and the accessible name `Get the free pack: <title>`; clicking it on desktop brings `#lead-form` into view (`expect(page.locator("#lead-form")).toBeInViewport()`); `page.request.get(ACTIVITY_PACK.fileUrl)` → 404; `page.request.get("/api/freebies/download")` → 404; `…?t=abc` → 404; `…?t=eyJmIjoieCJ9.YWJj` (well-formed junk) → one of 404 or 503. Drop the download-event part. Keep the other tests. Update the R66 comment to R140. `e2e/crawl/public-routes.spec.ts` and `e2e/leads/lead-form.spec.ts`: only if they reference the PDF or the old link.

Done when: the new tests pass, `tests/landing`, `tests/leads/lead-copy.test.tsx`, `tests/analytics`, `tests/content` pass, typecheck and lint are clean, and `npx playwright test e2e/landing/freebie-youtube.spec.ts --project=chromium` (or the project name the config uses) passes against the keyless dev server. Playwright writes its output under `D:\Work\_scratch\bibobay\`; never under C:.

## Task 3 — The signup answers with a link; the acknowledgement carries one (lead pipeline + email)

Depends on Task 1 (imports `lib/freebies/token.ts`). Files owned: `lib/leads/submit.ts`, `lib/leads/dependencies.ts`, `lib/outbox/dependencies.ts` (comment on the secret), `lib/email/lead-emails.ts`, `lib/content/freebie.ts` (`absoluteFileUrl` doc comment only, if it changes), `lib/content/legal-fallback.ts` (one sentence, see below), `tests/leads/lead-submit.test.ts`, `tests/leads/lead-dependencies.test.ts`, `tests/leads/lead-emails.test.ts`, `tests/content/legal-pages.test.tsx` (if it pins the sentence), `docs/architecture.md` and `docs/deployment.md` (one line each where the freebie or the acknowledgement is described), `CHANGELOG.md` (a new dated entry at the top, Keep-a-Changelog style like the existing one).

1. Tests first (watch them fail):
   - `lead-submit`: with `dependencies.download = { url: "/api/freebies/download?t=abc", title: "Bibo Bay Activity Pack" }` a stored signup's 200 body carries exactly that `download`; with `download: null` the body has no `download` key; a 400/429/500/503 answer never carries `download`, even when the dependency is set.
   - `lead-dependencies`: `immediateDownloadFrom(lead, env)` with the repository pack and a 40-char secret → `{ url: "/api/freebies/download?t=<token>", title }` where `verifyDownloadToken(token, env)` is ok for the pack and expires within `IMMEDIATE_DOWNLOAD_TTL_SECONDS` of now; no secret → `null`; an https CMS file → `{ url: thatHttpsUrl, title }` with no token; `leadMagnetFrom` for the repository pack with an origin → `fileUrl` = `<origin>/api/freebies/download?t=<token>` whose token verifies and expires within `EMAIL_DOWNLOAD_TTL_SECONDS`; no origin → `null`; no secret → `null`; an https file → unchanged.
   - `lead-emails`: the acknowledgement's text and html carry the link and the sentence "Here is your free download; the link works for 30 days:" (replace the thank-you sentence); no magnet → the paragraph is absent as before.
2. Implement per the shared interfaces. `createLeadDependencies` computes `download: immediateDownloadFrom(lead, env)` next to `leadMagnet`. In `submitLead`, the 200 answer spreads `...(dependencies.download ? { download: dependencies.download } : {})`. The outbox worker (`lib/outbox/leads.ts` via `lib/outbox/dependencies.ts`) keeps using `leadMagnetFrom`, which now signs at send time: fix the comment in `lib/outbox/dependencies.ts` that says the worker does not need `LEAD_IP_HASH_SECRET` (it now needs it to sign the link; without it the email simply omits the pack).
3. `lib/content/legal-fallback.ts` line ~103 (privacy, why we use the email): append to the first sentence that the confirmation email also carries the download link for the free activity pack. One factual clause, nothing else; the owner's legal review stays open (ledger checklist section C).
4. Docs and CHANGELOG as listed. The CHANGELOG entry is public-safe wording.

Done when: `tests/leads` and `tests/content` pass, typecheck and lint are clean.

## Verification (controller, after review)

`npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build` (D: scratch if needed) with the nft.json check, Playwright keyless: `e2e/landing/freebie-youtube.spec.ts`, `e2e/leads/lead-form.spec.ts`, `e2e/crawl/public-routes.spec.ts`, `e2e/analytics/analytics.spec.ts`. Then commit by named paths, push, PR, CI, merge, redeploy the Hobby preview and run `npm run verify:deployment -- https://bibobay-lp-preview.vercel.app --production` and `--browser`, plus `curl -I` on the old PDF path (404) and the route (404).
