# Consent notice and GDPR privacy notice — visit statistics only after a "yes"

Spec: `docs/superpowers/specs/2026-10-02-bibobay-production-platform-design.md` (§2 truthfulness, §8 lead capture) as amended by the owner on 2026-10-17: "Do not forget to add cookie consent, follow GDPR and data privacy laws." This overrides ruling R70's "statistics are on unless the visitor turns them off" (opt-out) with opt-in consent. Ruling R144 in the ledger records the override; R145 keeps the statistics cookieless.

Line moved: reduced cost (legal exposure of an email list and visit statistics without a consent record) and retained revenue (a founding-family list that can be used lawfully in the EU and UK).

## Outcome

A visitor sees a short consent notice on their first visit when visit statistics are configured. Nothing is counted, and no PostHog code is loaded, until they say yes. Saying no, or not answering, counts nothing. The answer is kept on the device and can be changed at any time under "Analytics choices" in the footer. The privacy page explains the notice, the legal basis for each use of personal data, the visitor's rights, and everything kept on the device. A new data-protection document lists what the owner must still do before launch (controller identity, processor agreements, data regions, the legal review).

## What does not change

- Statistics stay cookieless (`cookieless_mode: "always"`, `persistence: "memory"`, no person profiles). The notice is honest: it sets no cookie. The only thing kept on the device is the visitor's answer (`localStorage` key `bibo.analytics.v1`), which is strictly necessary to honour that answer.
- The notice renders only when PostHog is configured (ruling R49 stands): asking consent for statistics that cannot run would be a false statement. A keyless deployment shows no notice and no footer link.
- A browser that sends Global Privacy Control or Do Not Track is not asked and is not counted; an explicit "yes" made on this site still wins over the browser signal (unchanged, ruling R147).
- The "Analytics choices" dialog in the footer keeps its explainer, its status line and its on/off buttons.
- The signup form's consent tick, consent copy version and timestamps are unchanged.
- No feature, file, export or test is deleted; tests that pinned the opt-out default are rewritten to pin the opt-in default.

## Global constraints

- Nothing is sent to PostHog before the visitor's "yes": no SDK chunk is fetched, no event is queued for later sending. Events that happen before the answer are dropped, never replayed after it.
- Truthfulness (spec §2): every sentence in the notice, the dialog, the privacy text and the docs describes what the code does. No claim about contracts, regions or companies that the code cannot back; those are the owner's, listed in `docs/data-protection.md`.
- No dark patterns: the notice is non-modal, never steals focus, has two equal buttons ("yes" and "no" styled the same), no pre-selected answer, no cookie wall (the page stays usable without answering), a link to the privacy page. src: EDPB Guidelines 03/2022 on deceptive design patterns; ICO Age Appropriate Design Code standard 7 (default settings) and 13 (nudge techniques). Ruling R148.
- Accessibility: the notice is a landmark region with a visible heading as its name, keyboard-operable, readable at 390 px and 1440 px without overlapping the header or hiding both of its buttons; no `role="status"` anywhere in it (a second `role="status"` on the page breaks the form's live-region locators).
- Hydration-safe: the server renders no notice (the answer lives in the browser). The client decides after mount, from the stored answer, through `useSyncExternalStore` so the server snapshot is always `null`.
- Secrets never in code, tests, logs or analytics. Public-repository hygiene: no local paths, no owner emails, no private project names in tracked files (`tests/scripts/docs-hygiene.test.ts` enforces it).
- Every non-obvious dependency fact carries `// src: <url or path> · <version> · <date>` (research-protocol). Installed: next 16.3.8, react 19.3, posthog-js (version from `package-lock.json`), vitest 5, playwright 1.63, Node 24 on CI/Vercel (local 26).
- TDD: each task writes its failing tests first and watches them fail before implementing (Task 3's browser specs are run by the controller on the keyed production build after every task lands, ruling R150).
- Agents never run `npm ci`/`npm install`, never write git state, and run only their own test files (the controller runs the full gate).

## Shared interfaces (fixed here; tasks do not renegotiate them)

### Behaviour

| Situation | Notice | Statistics |
|---|---|---|
| No PostHog key configured | not rendered | off (nothing loads) |
| Key configured, no stored answer, no GPC/DNT | rendered | off until "yes" |
| Key configured, GPC or DNT, no stored answer | not rendered | off (footer can turn on) |
| Stored answer `on` | not rendered | on |
| Stored answer `off` | not rendered | off |
| Answer written in another tab (`storage` event) | hides at once | follows the stored answer |
| Page under `/admin` or `/studio` | not rendered | off (unchanged) |
| Storage blocked | rendered; an answer lasts for this page | follows the page's answer |

### `lib/analytics/preference.ts` (Task 1)

```ts
export const ANALYTICS_PREFERENCE_KEY = "bibo.analytics.v1";       // unchanged
export type AnalyticsChoice = "on" | "off";                        // unchanged
export function readChoice(): AnalyticsChoice | null;              // unchanged
export function writeChoice(choice: AnalyticsChoice): void;        // now also notifies subscribers
/** Opt-in (ruling R144): true only for a stored or page answer of "on". */
export function analyticsAllowed(): boolean;
export function declinedByBrowser(): boolean;                      // unchanged
/** Calls `listener` after every writeChoice and after a `storage` event for the key (another tab). Returns the unsubscribe. */
export function subscribeChoice(listener: () => void): () => void;
export function forgetChoiceForTests(): void;                      // unchanged, also clears subscribers
```

`lib/analytics/client.ts` keeps `startAnalytics`, `track`, `stopAnalytics`, `resumeAnalytics`, `analyticsActive`, `resetAnalyticsForTests` with their signatures. `startAnalytics` returns `false` and loads nothing while `analyticsAllowed()` is false (already so). `track` drops (does not queue) while not allowed (already so).

### Copy (Task 1 owns `components/landing/ui-copy.ts`; Tasks 2 and 3 quote these strings verbatim)

```ts
consentNotice: {
  title: "Can we count your visit?",
  body: "BIBO Bay would like to count visits with PostHog to learn which pages, videos and activities families use, and how they find us. Counting sets no cookies, builds no profile of you and never records what you type. The only thing it keeps on this device is your answer; change it any time under Analytics choices in the footer.",
  accept: "Yes, count my visit",
  decline: "No, do not count me",
  privacy: "Privacy page",
},
analytics: {
  choices: "Analytics choices",                                     // unchanged
  explainer: [
    /* line 1 unchanged */,
    /* line 2, its last sentence now: "A browser that sends Global Privacy Control or Do Not Track is not asked and not counted, unless you turn statistics on here." (review S5) */,
    "Statistics stay off until you say yes. Your answer, yes or no, is kept on this device; change it here at any time.",
  ],
  statusOn: "Visit statistics are on for this browser.",            // unchanged
  statusOff: "Visit statistics are off for this browser.",          // unchanged
  turnOff: "Turn statistics off",                                   // unchanged
  turnOn: "Turn statistics on",                                     // unchanged
},
```

### DOM contract of the notice (Task 1 builds it; Task 3 locates it by this)

```html
<section class="consent-notice" role="region" aria-labelledby="consent-notice-title" data-consent-notice>
  <h2 id="consent-notice-title" class="consent-notice__title">Can we count your visit?</h2>
  <p class="consent-notice__text">…body…</p>
  <div class="consent-notice__actions">
    <button type="button" class="btn btn-paper">Yes, count my visit</button>
    <button type="button" class="btn btn-paper">No, do not count me</button>
    <a class="consent-notice__link" href="/privacy">Privacy page</a>
  </div>
</section>
```

- Component `components/analytics/ConsentNotice.tsx` (`"use client"`), props `{ config: AnalyticsConfig | null }`.
- Rendered by `app/layout.tsx` inside `<body>`, after `<RenderPerRequest />` and **before** `{children}`, so keyboard and screen-reader users reach it early. `AnalyticsProvider` stays after `{children}`.
- "Yes" calls `resumeAnalytics(config)`; "No" calls `stopAnalytics()`. Both make the notice disappear through the subscription (no local "dismissed" state). Nothing auto-focuses on appearance; after a click, focus may stay where the browser leaves it.
- Styles in `components/analytics/consent-notice.css`, imported from `app/globals.css` beside the other component sheets. Fixed to the bottom of the viewport, 16 px gutters on phones, a readable maximum width on desktop, above page content but below the modal dialog, honouring `prefers-reduced-motion` (no entrance motion is required).

### Privacy text (Task 2 owns `lib/content/legal-fallback.ts`)

New or changed statements, all code-backed or statements of law; see Task 2 for the wording rules.

## Task 1 — Opt-in preference, consent notice, provider wiring (model: opus)

Files: `lib/analytics/preference.ts`, `lib/analytics/client.ts` (only if a comment or the `stopped` flow needs it), `components/analytics/ConsentNotice.tsx` (new), `components/analytics/consent-notice.css` (new), `components/analytics/AnalyticsProvider.tsx`, `components/analytics/AnalyticsChoices.tsx`, `components/landing/ui-copy.ts`, `app/layout.tsx`, `app/globals.css`, `tests/analytics/preference.test.ts`, `tests/analytics/client.test.tsx`, `tests/analytics/wiring.test.tsx`, `tests/analytics/consent-notice.test.tsx` (new). No other files.

1. Tests first (watch them fail):
   - `preference.test.ts`: with no answer, `analyticsAllowed()` is `false` (opt-in); `"on"` makes it `true`; a GPC browser with a stored `"on"` is allowed (explicit choice wins); `subscribeChoice` fires on `writeChoice` and on a `storage` event for the key, and not after unsubscribe; the blocked-storage cases keep their meaning under the new default.
   - `client.test.tsx`: `startAnalytics` with a config but no answer resolves `false` and never calls the loader; `track` before an answer queues nothing; after `writeChoice("on")`, `startAnalytics` loads and inits. Existing "turning off" cases get a `writeChoice("on")` (or `resumeAnalytics`) first where they assumed the old default.
   - `consent-notice.test.tsx` (jsdom, `@testing-library/react`): renders nothing without config; nothing with a stored answer; nothing for a GPC browser; renders the region named "Can we count your visit?" with both buttons and the privacy link when configured and unanswered; "Yes" writes `on`, starts analytics (loader mocked) and removes the region; "No" writes `off` and removes it; a `storage` event (another tab) removes it; nothing under `/admin/…` (mock `usePathname` from `next/navigation` as the provider's tests do, or set `window.location`); the server render (`renderToString`) outputs no region.
   - `wiring.test.tsx`: the footer dialog opens showing "Visit statistics are off for this browser." for an unanswered visitor; "Turn statistics on" is offered; the CSP/environment cases unchanged.
2. Implement `subscribeChoice` (a module `Set` of listeners; `writeChoice` notifies after the write attempt; one `window` `storage` listener registered on first subscribe, filtering on the key) and the opt-in `analyticsAllowed`.
3. `ConsentNotice`: `useSyncExternalStore(subscribeChoice, readChoice, () => null)`; `usePathname()` for the exclusion (`isExcludedPagePath`); `declinedByBrowser()` read in an effect-free way that is still hydration-safe (for example a `useSyncExternalStore` snapshot or a state set on mount) so the server output stays empty.
4. `AnalyticsProvider`: subscribe to the answer the same way; the start effect and the section observer effect list the answer in their dependencies, so a "yes" starts statistics and re-observes the sections; a `useRef<Set<string>>` of counted sections, reset when `pathname` changes, so a section is counted once per page view even across off/on. Update the file comment (ruling R144) and the layout comment.
5. `AnalyticsChoices`: initial `on` state `false`; the third explainer line from the copy above.
6. Research: confirm from the PostHog docs for the installed `posthog-js` that `capture_pageview: "history_change"` captures the initial page view at `init`, so the page on which the visitor says yes is counted; leave the `src:` line beside the option in `lib/analytics/client.ts` (the browser spec asserts the `$pageview` after "yes"). Agents cannot read `node_modules` with the Read tool; use `cat` via Bash or the public docs.
7. Run only `npx vitest run tests/analytics` and `npx tsc --noEmit -p tsconfig.json` if it finishes within the tree's state; the controller runs everything else.

Report: `task-1-report.md` in the slice's working folder.

## Task 2 — Privacy text, data-protection document, docs (model: opus)

Files: `lib/content/legal-fallback.ts`, `tests/content/legal-pages.test.tsx`, `docs/observability.md`, `docs/data-protection.md` (new), `docs/deployment.md`, `docs/qa-checklist.md`, `docs/architecture.md` (only where it describes analytics), `README.md` (the two "cookieless visit statistics" lines), `CHANGELOG.md`. No other files.

Wording rules (ruling R149): a sentence is allowed if the code does it today, or if it states a right or duty under the GDPR/UK GDPR that exists whatever the code does. Nothing about contracts, regions, company names, addresses or registrations: those go into `docs/data-protection.md` as the owner's tasks. The text names no company and no contact (unchanged); `/privacy` adds the contact address from site settings when configured.

1. Tests first (`tests/content/legal-pages.test.tsx`; watch them fail): replace the pins "stores nothing on your device unless you turn statistics off" and "only when statistics are switched on" with pins for the new sentences; add pins for: the notice ("Can we count your visit?"), "nothing is counted" before a yes, the answer kept in the browser's storage, legal basis sentences (consent for updates and statistics; legitimate interest for rate limits and error reports; commerce: the step before a sale), the rights paragraph (see, correct, delete, limit, object, portable copy, withdraw at any time, complain to a data-protection authority), "no decisions about you by automated means", Vercel named as host, and the device-storage heading. Keep every existing pin that stays true.
2. Privacy text changes (plain words, the page's voice):
   - "Visit statistics": counting happens only if you say yes in the notice shown on your first visit; until then, and if you say no, nothing is counted and nothing is sent to PostHog; the notice is not shown to a browser that sends Global Privacy Control or Do Not Track, and such a browser is not counted unless you turn statistics on under Analytics choices; you can change your answer at any time under Analytics choices at the foot of every page, and a "no" stops the counting at once. Keep the sentences about what each event carries and how PostHog counts without cookies.
   - New heading "Cookies and what is kept on your device": no advertising or analytics cookies; your answer to the notice, kept as one entry in this browser's storage until you clear the site's data; (commerce) the order list, as already described; the preview cookie used by the people who edit the website; the staff session cookies (httpOnly, removed at sign-out). Fold the existing cookie paragraph into this section rather than repeating it.
   - "Why we use your details": add the legal bases: your consent for emailing you updates and for counting your visit (withdrawable at any time, as this page explains); our legitimate interest in keeping the website working and safe for the rate-limit counts and the error reports; (commerce) handling an order request is the step you asked for before any sale. Add "We make no decisions about you by automated means."
   - "Services that handle your details": add "Vercel hosts the website and runs the code that serves these pages." Keep the "like any website" sentence.
   - Rename "How to ask for removal or a copy" to "Your rights" and open it with: under data-protection law you can ask to see the details we hold about you, to have them corrected or deleted, to limit or object to how we use them, and to receive them in a form you can take elsewhere; you can withdraw your consent at any time, which does not affect what was done before; you can complain to the data-protection authority where you live. Then the existing channel-dependent removal paragraph, with "deleted" added to what you can ask for. Where no channel exists the existing "not open yet" sentence stays.
   - Keep `legalFallbackFor`, `LEGAL_FALLBACK`, `LEGAL_FALLBACK_WITH_COMMERCE` and the file comment true (update the comment's description of visit statistics).
3. `docs/data-protection.md` (new, linked from `README.md`'s docs list and from `docs/deployment.md`): (a) a table of personal data the site handles: what, from where, to where, legal basis, retention, where the privacy text says so; (b) consent on the site: the notice (opt-in, cookieless, the stored answer), the signup consent record (tick, copy version, timestamps), the order consent (commerce); (c) what is kept on the device; (d) "Before launch (owner)": controller identity and contact in the Sanity privacy text; processor agreements with Vercel, Supabase, Resend, PostHog, Sentry and Sanity; data regions where EU/UK visitors are expected (PostHog EU host through `NEXT_PUBLIC_POSTHOG_HOST`, Supabase region, Sentry region), stated in the privacy text once chosen; Sentry "Prevent Storing of IP Addresses" on; PostHog "Cookieless server hash mode" on; the lawyer's review of the privacy and terms text (`legalReviewed`); a retention decision for signups; the removal channel; (e) "Handling a request from a person": access, correction, deletion, withdrawal: where the data is (Supabase `leads` and email delivery records by email address; PostHog and Sentry hold nothing that identifies a person), the one-month answer period of GDPR Article 12(3), and the pointer to `docs/incident-runbook.md` for breaches. Cite `src:` lines for the GDPR articles used (for example https://gdpr-info.eu/art-13-gdpr/).
4. `docs/observability.md`: replace "There is no consent banner, because nothing is stored on the visitor's device" and the "Who is not counted" section with the opt-in model (everyone until they say yes; GPC/DNT not asked; the stored answer; the footer dialog); keep the event table. `README.md` lines that say "cookieless visit statistics" become "consent-first, cookieless visit statistics". `docs/qa-checklist.md`: add the manual steps for the notice (first visit shows it; "No" sends nothing and the notice stays away after reload; "Yes" sends a page view; footer dialog turns it off) to the keyed browser section. `docs/architecture.md` only if it describes the opt-out default. `CHANGELOG.md`: new top entry "2026-10-17 — Consent notice and privacy notice" with Changed bullets and the decisions R144–R150 in one line each.
5. Run only `npx vitest run tests/content tests/scripts/docs-hygiene.test.ts`.

Report: `task-2-report.md` in the slice's working folder.

## Task 3 — Browser specs (model: sonnet)

Files: `e2e/analytics/analytics.spec.ts`, `e2e/analytics/consent.spec.ts` (new). No other files. The specs are not run by this task (ruling R150); write them to the DOM contract and the copy above and keep the existing helpers (`watch`, `eventsIn`, `named`, `storageKeys`, `PERSON_UA`, the YouTube and `/api/leads` routes).

1. `analytics.spec.ts` (keyed, `E2E_ANALYTICS=1`): the first test accepts the notice before expecting any event and asserts storage holds exactly `["bibo.analytics.v1"]` and cookies stay `[]` (rename it "… storing only the visitor's answer on the device"); the toolbar-link test stays as it is (no answer given, nothing stored); the GPC test also asserts the notice is not rendered; the "stops at once" test accepts the notice first, then turns statistics off in the footer dialog. Update the describe title and the file comment to the opt-in model (ruling R144).
2. `consent.spec.ts`:
   - Keyless part (`test.skip(process.env.E2E_ANALYTICS === "1")`): on `/` there is no `[data-consent-notice]` and no "Analytics choices" button; nothing in `localStorage`.
   - Keyed part (`test.skip(process.env.E2E_ANALYTICS !== "1")`, viewport 1440×900, `PERSON_UA`, `watch(context)`):
     a. First visit: the region named "Can we count your visit?" is visible with its heading, both buttons and the "Privacy page" link to `/privacy`; after 4 s no request reached the PostHog host; `storageKeys` is `[]`; cookies `[]`.
     b. "No": no request after 4 s, the region is gone, storage is `["bibo.analytics.v1"]`, and after `page.reload()` the region does not come back and still nothing is sent after scrolling to `#lead`.
     c. "Yes": a `$pageview` arrives within 15 s, the region is gone; after `page.reload()` the region does not come back and a second `$pageview` arrives.
     d. Another tab: with two pages in one context, answering in the first page removes the region in the second without a reload.
     e. Keyboard: from a fresh load, `Tab` reaches the "Yes, count my visit" button before any header link (the notice is early in the document; at most the skip link comes first), and `Enter` on "No, do not count me" removes the region.
     f. Phone (a separate `test.use({ viewport: { width: 390, height: 844 } })` describe): the region is visible, both buttons are inside the viewport, and the region's bounding box does not intersect the header's.
     g. Not on staff pages: `/admin/login` renders no `[data-consent-notice]`.
     h. The "Analytics choices" dialog for an unanswered visitor shows "Visit statistics are off for this browser." and "Turn statistics on"; pressing it sends a `$pageview` and the notice stays away.
3. Keep every assertion deterministic: `expect.poll` with the timeouts the existing file uses; no fixed waits other than the existing 4 s "nothing arrives" windows.

Report: `task-3-report.md` in the slice's working folder.

## Verification (controller)

1. `npm run typecheck`, `npm run lint`, `npx vitest run` (expect every file to run; read the file count).
2. Keyless production build; `npx playwright test e2e/analytics e2e/landing/accessibility.spec.ts e2e/leads` against it (consent keyless part, no regression in the landing suite).
3. Keyed production build (placeholder `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com`, Sentry placeholder DSN, `LEAD_IP_HASH_SECRET` placeholder, `CRON_SECRET` placeholder) on port 3200; `E2E_PRODUCTION=1 E2E_ANALYTICS=1 E2E_SENTRY=1 npx playwright test e2e/analytics e2e/observability e2e/freebies`.
4. `npm run verify:bundle`; screenshots of the notice at 390 px and 1440 px from the keyed server for the owner (the keyless preview cannot show it).
5. Whole-slice review (opus) → fix round → scoped re-review; commit; push; PR; CI; merge; redeploy the Hobby preview; verifier `--production` and `--browser`.
