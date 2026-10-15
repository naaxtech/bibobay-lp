# Observability: visit statistics and error reports

How the site counts visits (PostHog, ruling R70: owner request 2026-10-16, "track all website
users, what they do and where they come from") and how it reports errors (Sentry, Task 10M-a), and
what neither ever collects. Both are off until their environment variables are set.

## What is counted

PostHog runs on every public page (not the Studio) whenever `NEXT_PUBLIC_POSTHOG_KEY` holds a
project key. There is no consent banner, because nothing is stored on the visitor's device:

| Event | When | Properties |
|---|---|---|
| `$pageview`, `$pageleave` | Every page, including client-side navigation; leave carries time on page and scroll depth | Page address cut to origin + path + `utm_source/medium/campaign/content/term` (a path holding an email address becomes `/`); referring site (origin only); browser and its full user agent, OS, device type, screen and viewport size, browser language, time zone |
| `youtube_clicked` | A link to the channel, its subscribe prompt or a video | `kind` (`channel`, `subscribe`, `video`), `video_id`, `section`, `label` |
| `freebie_downloaded` | The activity pack (or any `/freebies/*.pdf`) | `file`, `section` |
| `cta_clicked` | Any other link (click or middle-click) | `destination` (`anchor`, `internal`, `external`), `section`, `label` |
| `section_viewed` | A landing section reaches the middle of the screen (once per page view, also after client-side navigation; a section seen while statistics are off counts once they are on) | `section` |
| `tab_selected` | A friend or video tab other than the one showing | `section`, `label` |
| `faq_opened` | A question is opened | `index`, `section` |
| `menu_opened` | The phone menu | `section` |
| `lead_submitted` | The signup form gets a stored answer | `persisted`, `acknowledgementQueued` |

`section` is the nearest landing section (`hero`, `episodes`, `lead`, …) or `header`, `footer`,
`menu`. `label` is the link's visible words, at most 80 characters.

Where visitors come from: PostHog's Web analytics dashboard groups `$pageview` by referring domain,
`utm_*` campaign tags and device. There is no country or city: in cookieless server hash mode
PostHog strips the address before GeoIP runs, so no location is added. Tag links you share, for example
`https://<domain>/?utm_source=youtube&utm_medium=video_description&utm_campaign=activity_pack`.

## What is never collected

- No cookies, no local or session storage (`cookieless_mode: "always"`, `persistence: "memory"`),
  no person profiles (`person_profiles: "never"`), no `identify` call. PostHog counts unique
  visitors with a hash it computes on its servers from a salt that rotates daily, so a visitor
  is not recognised on a later day.
- No autocapture, session replay, heatmaps, dead-click or rage-click capture, exception capture,
  surveys, product tours, web experiments, feature flags or web vitals.
- No form contents: `lead_submitted` carries the outcome only.
- No private order link: the token in a `/orders/<token>` address (the tracking page, Task 7c)
  never leaves the browser. Every address, path and label is sent as `/orders/[token]`
  (`lib/privacy/private-links.ts`), and those pages send no referrer.
- `before_send` (`lib/analytics/events.ts` `cleanCapture`) is the one gate: it drops any event not
  in the table above, any property not allowed for that event (PostHog's own `token`,
  `distinct_id` and page `title` are kept: it refuses events without them), query strings other than campaign
  tags, the referrer's path and query, ad-click identifiers (`gclid`, `fbclid`, `msclkid` and
  similar), person properties, initial-visit copies, and any value that looks like an email address,
  even percent-encoded.
- The visitor's choice is enforced in `before_send` too: in cookieless mode PostHog ignores
  `opt_out_capturing`, so turning statistics off (here or in another tab) drops every later event,
  PostHog's own page views and page leaves included.
- A PostHog toolbar link (`#__posthog=…`, `#state=…`) is removed from the address before the
  PostHog code is even loaded (its toolbar code reads the address as it loads), so it never writes
  to storage.
- PostHog code is the bundled `posthog-js/dist/module.no-external` build with external dependency
  loading off, so it never fetches scripts from PostHog under the site's `'strict-dynamic'` CSP. The
  configured host is added to `connect-src` only.

## Who is not counted

- A browser that sends Global Privacy Control or Do Not Track, unless that visitor turns statistics
  on in Analytics choices.
- A visitor who turns statistics off under **Analytics choices** in the footer (on every page,
  including the 404 page, and even if an editor removes the legal links). The choice is kept in
  `localStorage` (`bibo.analytics.v1`), which is the only thing analytics ever store, and only after
  that choice; where storage is blocked it lasts for the page.
- Automated browsers: PostHog drops events from known bots and from browsers driven by automation
  (`navigator.webdriver`), so crawlers and test runs do not inflate the numbers. The e2e spec
  stands in for a person's browser for that reason.
- Everyone, when `NEXT_PUBLIC_POSTHOG_KEY` is empty: no SDK download, no request, no footer link.

## Setting it up (provisioning task)

1. Create the PostHog project under the BIBO Bay owner account. Pick the US or EU region and set
   `NEXT_PUBLIC_POSTHOG_HOST` to match (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
2. **Project settings → Web analytics → Cookieless server hash mode: on.** Without it PostHog
   ignores every event this site sends.
3. Set `NEXT_PUBLIC_POSTHOG_KEY` (the project key, `phc_…`; never a personal key, `phx_…`, which
   `verify:env` refuses) in Vercel, then redeploy: Next inlines `NEXT_PUBLIC_` values into the
   build. `verify:env` also fails a key or host that is set but malformed, which would otherwise
   leave analytics silently off.
4. Check: open the site, click a YouTube link and the activity pack, then confirm the events in
   PostHog's Activity view.

The privacy page's fallback text (`lib/content/legal-fallback.ts`) describes all of this; keep it
in step with the code, and have the owner and a lawyer review it before launch.

## Proof

- Unit: `tests/analytics/*` (allow-list, address and referrer trimming, click meaning, options,
  opt-out, GPC/DNT, wiring into the footer, CSP, signup outcome).
- Browser: `e2e/analytics/analytics.spec.ts`, skipped unless `E2E_ANALYTICS=1`. Run it against a
  production build made with a placeholder key and `NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com`
  (Playwright answers that host itself; no real request is made). It checks that events reach the
  host with trimmed addresses, that nothing is written to cookies or storage, that GPC stops all
  requests, and that after the footer switch no event is sent, also across client-side navigation.

## Error reports (Sentry)

Sentry runs when `NEXT_PUBLIC_SENTRY_DSN` holds a valid DSN (https, public key only, numeric
project); otherwise nothing loads and nothing is sent.

- **Server and edge:** `instrumentation.ts` loads `sentry.server.config.ts` / `sentry.edge.config.ts`;
  request errors Next catches reach Sentry through `onRequestError = captureRequestError`.
- **Browser:** `instrumentation-client.ts` loads the SDK as its own chunk only when a DSN is set, so
  a site without Sentry ships none of it. `app/global-error.tsx` shows a calm branded page and
  reports the error.
- **App code** reaches Sentry only through `lib/observability/report.ts`: `reportError(error, {area,
  event})` and `reportEvent(event, {kind, code})`. Tags must be plain identifiers (`lead_route_failed`,
  `acknowledgement`, `PGRST301`); anything else, such as an address or a name, is dropped.
- **Scrubbing** (`lib/observability/sentry-config.ts`, every event, transaction and breadcrumb):
  `sendDefaultPii: false`; the request keeps its method, its URL without the query and the user
  agent only; the user and all extra data are removed; email-shaped text becomes `[email]`;
  breadcrumb and span URLs lose their queries; a private order link's token becomes
  `/orders/[token]` in request URLs, transaction names, breadcrumbs, messages and spans. No session replay. Traces: 0.1 in production, all in
  preview and development.
- **Environment tag:** Vercel's `VERCEL_ENV` (browser: `NEXT_PUBLIC_VERCEL_ENV`), else `development`.
  There is no `SENTRY_ENVIRONMENT` setting: Sentry's browser SDK reads that name itself, so listing
  it in `.env.example` would make `verify:bundle` flag the SDK chunk.
- **Source maps:** uploaded only with `SENTRY_AUTH_TOKEN` (+ `SENTRY_ORG`, `SENTRY_PROJECT`) and then
  deleted from the deployment; without the token nothing is uploaded and no browser maps are served.

### Alerts from the signup flow (ruling R52)

`logLeadEvent` keeps its structured log line and also sends these as warning messages, tagged with
the event, delivery kind and error code only (never an address or a lead id):
`delivery_send_capped` (the hourly send cap was hit: emails wait in the outbox),
`delivery_send_cap_unavailable`, `delivery_enqueue_failed`, `lead_store_failed`,
`lead_rate_limit_unavailable`, `lead_storage_unconfigured` and `lead_config_invalid`. An unexpected
failure of `/api/leads` is reported as `lead_route_failed` and answered with the generic error copy.

Set a Sentry alert on `delivery_send_capped` and `lead_store_failed`.

### Notes for staff reading lead records

- `rejoin_requested_at` can be set by anyone who submits a listed address again, so it is not proof
  that the person themselves asked to rejoin.
- When the CMS consent copy version is invalid, the stored consent evidence is the fallback version
  `"1"` (the event `lead_config_invalid` is reported when that happens).

### Setting it up (provisioning task)

1. Create the Sentry project (Next.js) under the BIBO Bay owner account.
2. Project settings → Security & Privacy: turn on **Prevent storing of IP addresses** and keep the
   default data scrubbers on.
3. Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel. Optionally create an organisation token and set
   `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` for readable stack traces.
4. Redeploy, then check an event arrives (for example from a preview deployment).

