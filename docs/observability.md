# Observability: visit statistics and error reports

How the site counts visits (PostHog, ruling R70: owner request 2026-10-16, "track all website
users, what they do and where they come from"; made opt-in by ruling R144 on 2026-10-17, when the
owner asked for cookie consent and GDPR compliance) and how it reports errors (Sentry, Task 10M-a),
and what neither ever collects. Both are off until their environment variables are set, and visit
statistics are also off for each visitor until that visitor says yes. The personal data the site
handles, the legal basis of each use and the owner's tasks before launch are in
[data-protection.md](data-protection.md).

## What is counted

PostHog can run on every public page (not the Studio, and not the staff pages under `/admin`)
whenever `NEXT_PUBLIC_POSTHOG_KEY` holds a project key, but only for a visitor who has said yes in
the consent notice or turned statistics on in Analytics choices ([Consent](#consent-nobody-is-counted-until-they-say-yes)).
Before that, nothing is counted and the PostHog code is not even loaded. Once it runs, these are the
events it sends:

| Event | When | Properties |
|---|---|---|
| `$pageview`, `$pageleave` | Every page, including client-side navigation; leave carries time on page and scroll depth | Page address cut to origin + path + `utm_source/medium/campaign/content/term` (a path holding an email address becomes `/`); referring site (origin only); browser and its full user agent, OS, device type, screen and viewport size, browser language, time zone |
| `youtube_clicked` | A link to the channel, its subscribe prompt or a video | `kind` (`channel`, `subscribe`, `video`), `video_id`, `section`, `label` |
| `freebie_downloaded` | The activity pack: a click on the signed download route `/api/freebies/download` (or any `/freebies/*.pdf`); `file` is the pathname only, never the token | `file`, `section` |
| `cta_clicked` | Any other link (click or middle-click) | `destination` (`anchor`, `internal`, `external`), `section`, `label` |
| `section_viewed` | A landing section reaches the middle of the screen (once per page view, also after client-side navigation; a section seen while statistics are off is counted when it is next in the middle of the screen once they are on) | `section` |
| `tab_selected` | A friend or video tab other than the one showing | `section`, `label` |
| `faq_opened` | A question is opened | `index`, `section` |
| `menu_opened` | The phone menu | `section` |
| `lead_submitted` | The signup form gets a stored answer | `persisted`, `acknowledgementQueued` |
| `contact_submitted` | The contact form gets a stored answer (`persisted: true`); no other answer is counted | `persisted`, `topic` |

`section` is the nearest landing section (`hero`, `episodes`, `lead`, …) or `header`, `footer`,
`menu`. `label` is the link's visible words, at most 80 characters.

Where visitors come from: PostHog's Web analytics dashboard groups `$pageview` by referring domain,
`utm_*` campaign tags and device. There is no country or city: in cookieless server hash mode
PostHog strips the address before GeoIP runs, so no location is added. Tag links you share, for example
`https://<domain>/?utm_source=youtube&utm_medium=video_description&utm_campaign=activity_pack`.

What happens to the address is PostHog's own statement: "In cookieless mode, the IP is stripped
before transformations run, so GeoIP enrichment and bot detection won't enrich your events." Its
documentation says nothing more about where the address goes, so the privacy page says only that
the address is removed from the event and not stored with the statistics, and the owner asks PostHog
to confirm the rest ([data-protection.md](data-protection.md#before-launch-owner), item 7).

- src: https://posthog.com/docs/privacy/data-storage · PostHog docs, "IP data capture configuration" (cookieless mode strips the IP before transformations; "Discard client IP data" does not apply in that mode) · 2026-10-17

## What is never collected

- No cookies, and PostHog itself writes no local or session storage (`cookieless_mode: "always"`,
  `persistence: "memory"`); the visitor's answer is the one entry the site keeps
  ([Consent](#consent-nobody-is-counted-until-they-say-yes)). No person profiles
  (`person_profiles: "never"`), no `identify` call. PostHog counts unique
  visitors with a hash it computes on its servers from a salt that rotates daily, so a visitor
  is not recognised on a later day.
- No autocapture, session replay, heatmaps, dead-click or rage-click capture, exception capture,
  surveys, product tours, web experiments, feature flags or web vitals.
- No form contents: `lead_submitted` carries the outcome only, and `contact_submitted` the outcome and the topic the visitor chose, never the name, the address or the message.
- No private order link: the token in a `/orders/<token>` address (the tracking page, Task 7c)
  never leaves the browser. Every address, path and label is sent as `/orders/[token]`
  (`lib/privacy/private-links.ts`), and those pages send no referrer.
- No staff page and no Studio page: a staff page's path carries an order reference. Cookieless
  statistics (ruling R101) stand for the public pages only. `cleanCapture` drops every event whose
  address or path is under `/admin` or `/studio` (`isExcludedPagePath`, `lib/analytics/events.ts`), also
  for a page reached by client-side navigation after PostHog started, and the provider does not start
  on a hard load of one (final review 8c-M1).
- `before_send` (`lib/analytics/events.ts` `cleanCapture`) is the one gate: it drops any event not
  in the table above, any event on a staff or Studio page, any property not allowed for that event (PostHog's own `token`,
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

## Consent: nobody is counted until they say yes

Statistics are opt-in (ruling R144, which overrode R70's "on unless the visitor turns them off"):

- **Everyone starts uncounted.** With a key set, a visitor with no stored answer sees the consent
  notice "Can we count your visit?" (`components/analytics/ConsentNotice.tsx`) on their first visit.
  Until they answer, and after "No, do not count me", nothing is counted, no PostHog code is fetched
  and nothing is sent. Clicks and sections seen before the answer are dropped, not queued for later:
  "Yes, count my visit" starts the counting on the page the visitor is on.
- **The notice** is not a modal: it takes no focus when it appears, the page stays usable without an
  answer, the two buttons look the same, nothing is chosen in advance, and it links to the privacy
  page (ruling R148). After an answer, focus moves to the page's skip link so a keyboard or
  screen-reader user is not left nowhere (ruling R153); the link shows itself only for keyboard focus. It is not shown when no key is set (ruling R146: asking consent for statistics that cannot
  run would be untrue), on staff pages or in the Studio, or to a visitor who has already answered.
- **The stored answer.** Either answer is kept in `localStorage` under `bibo.analytics.v1` (`on` or
  `off`, `lib/analytics/preference.ts`), so the visitor is not asked again. It is the only thing
  analytics ever keep on the device, and it is strictly necessary to honour the answer, so it needs
  no consent of its own (ruling R145). An answer given in another tab hides the notice at once and is
  followed there. Where storage is blocked the answer lasts for the page, and the notice comes back on
  the next load.
- **Global Privacy Control or Do Not Track** (ruling R147): such a browser is not asked and not
  counted, unless that visitor turns statistics on in Analytics choices; an explicit "yes" given on
  this site wins over the browser signal.
- **Changing the answer:** **Analytics choices** in the footer (on every page, including the 404
  page, and even if an editor removes the legal links) says whether statistics are on for this
  browser and turns them off or on. Turning them off stops the counting at once, also in other open
  tabs (`before_send`, above).

## Who is not counted

- A visitor who has not answered the notice, or who answered "No, do not count me".
- A browser that sends Global Privacy Control or Do Not Track, unless that visitor turns statistics
  on in Analytics choices.
- A visitor who turns statistics off under **Analytics choices** in the footer.
- Anyone on a staff page (`/admin`) or in the Studio (`/studio`): see "What is never collected".
- Automated browsers: PostHog drops events from known bots and from browsers driven by automation
  (`navigator.webdriver`), so crawlers and test runs do not inflate the numbers. The e2e spec
  stands in for a person's browser for that reason.
- Everyone, when `NEXT_PUBLIC_POSTHOG_KEY` is empty: no SDK download, no request, no consent notice,
  no footer link.

## Setting it up (provisioning task)

1. Create the PostHog project under the BIBO Bay owner account. Pick the US or EU region and set
   `NEXT_PUBLIC_POSTHOG_HOST` to match (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
   Where EU or UK visitors are expected, the EU region is the one listed in
   [data-protection.md](data-protection.md#before-launch-owner).
2. **Project settings → Web analytics → Cookieless server hash mode: on.** Without it PostHog
   ignores every event this site sends.
3. Set `NEXT_PUBLIC_POSTHOG_KEY` (the project key, `phc_…`; never a personal key, `phx_…`, which
   `verify:env` refuses) in Vercel, then redeploy: Next inlines `NEXT_PUBLIC_` values into the
   build. `verify:env` also fails a key or host that is set but malformed, which would otherwise
   leave analytics silently off.
4. Check: open the site, answer "Yes, count my visit" in the notice, click a YouTube link and the
   activity pack, then confirm the events in PostHog's Activity view. In a second, private window,
   answer "No, do not count me" and confirm that nothing arrives.

The privacy page's fallback text (`lib/content/legal-fallback.ts`) describes all of this; keep it
in step with the code, and have the owner and a lawyer review it before launch.

## Proof

- Unit: `tests/analytics/*` (allow-list, address and referrer trimming, click meaning, options,
  the opt-in default and the stored answer, the consent notice, GPC/DNT, wiring into the footer,
  CSP, signup outcome).
- Browser: `e2e/analytics/analytics.spec.ts` and `e2e/analytics/consent.spec.ts`. Their keyed parts
  are skipped unless `E2E_ANALYTICS=1`; run them against a production build made with a placeholder
  key and `NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com` (Playwright answers that host itself; no
  real request is made). They check that nothing is sent before an answer or after "No", that no
  PostHog code is even downloaded before a "Yes" (no script response carries the installed
  posthog-js version until then; ruling R152), that a "Yes" sends events to the host with trimmed
  addresses, that the answer is the only thing stored
  and no cookie is set, that the answer holds across a reload and another tab, that the notice is
  reachable by keyboard, fits a phone screen and stays off the staff pages, that GPC stops all
  requests and shows no notice, and that after the footer switch no event is sent, also across
  client-side navigation. The keyless part of `consent.spec.ts` checks that a build without a key
  shows no notice and no footer link.

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
- **Error reports only (ruling R86):** no performance tracing, no session replay and no
  sessions. Sentry SDK 11 streams traces as spans and never runs `beforeSendTransaction` on them,
  so traces would leave with URL queries and private order tokens. `tracesSampleRate` is `null`
  (absent would let the Node.js and edge SDKs read `SENTRY_TRACES_SAMPLE_RATE`; `0` would let a
  visitor's `sentry-trace` header turn sampling on), and `verify:env` refuses that variable. The
  browser and process session integrations are dropped, and the Node.js Http integration runs
  without request sessions: with a release (every Vercel build has one) the SDK would otherwise
  send a session per page load and session counts from the server.
  `e2e/observability/sentry.spec.ts` gives the build a release, as Vercel does, and fails if
  anything but events (and the SDK's client reports) leaves the page.
- **Data collection:** SDK 11 has no `sendDefaultPii`; `dataCollection` is set to the minimum
  (no user info, cookies, bodies, query strings, database or queue data, or stack-frame variables;
  only the `user-agent` request header).
- **Scrubbing** (`lib/observability/sentry-config.ts`, every event and breadcrumb): the request
  keeps its method, its URL without the query and the user agent only; the user, all extra data and
  stack-frame variables are removed; every string at every depth of contexts, tags, breadcrumbs and
  messages, and the request URL, transaction name and span descriptions, is cut to 2,000
  characters, is percent-decoded where it can be (so `parent%40example.com` in a path is caught;
  a malformed escape never stops the check), loses any query (also a path's query in mid-text),
  and has email-shaped text
  replaced by `[email]` and a private order link's token by `/orders/[token]` (any 64-digit hex
  run becomes `[token]`). A staff order reference is masked the same way: `/admin/orders/BB-…` becomes
  `/admin/orders/[reference]`, and `/api/admin/orders/BB-…/quote` (and `/status`, `/tracking-link`)
  becomes `/api/admin/orders/[reference]/quote`, in request URLs, transaction names and the browser's
  fetch breadcrumbs, also when percent-encoded (`lib/observability/admin-paths.ts`, final review 8c-M1).
- **Environment tag:** Vercel's `VERCEL_ENV` (browser: `NEXT_PUBLIC_VERCEL_ENV`), else `development`.
  There is no `SENTRY_ENVIRONMENT` setting: Sentry's browser SDK reads that name itself, so listing
  it in `.env.example` would make `verify:bundle` flag the SDK chunk.
- **Source maps:** uploaded only with `SENTRY_AUTH_TOKEN` (+ `SENTRY_ORG`, `SENTRY_PROJECT`) and then
  deleted from the deployment; without the token nothing is uploaded and no browser maps are served.

### Alerts from the signup flow (ruling R52)

`logLeadEvent` keeps its structured log line and also sends these as warning messages, tagged with
the event, delivery kind and error code only (never an address or a lead id):
`delivery_send_capped` (the hourly cap of one send bucket was hit: emails of that kind wait in the
outbox; the buckets are `send:lead_acknowledgement`, `send:lead_staff_alert`,
`send:order_acknowledgement`, `send:order_staff_alert`, `send:quote` and `send:contact_staff_alert`, each capped at
`LEAD_ACK_SEND_LIMIT_PER_HOUR`), `delivery_send_cap_unavailable`, `delivery_enqueue_failed`,
`lead_store_failed`, `lead_rate_limit_unavailable`, `lead_storage_unconfigured`,
`lead_config_invalid` and `lead_removal_channel_unconfigured` (a signup was refused with the
"signups are closed" answer because neither email sending nor a contact address exists for a person to withdraw consent;
configure email sending or set the contact address in the Studio; `/api/readiness` shows `leadRemovalChannel: false` until then). An unexpected
failure of `/api/leads` is reported as `lead_route_failed` and answered with the generic error copy.

Set a Sentry alert on `delivery_send_capped` and `lead_store_failed`.

### Alerts from the contact form (rulings R160-R173)

`logContactEvent` (`lib/contact/dependencies.ts`) writes the contact route's log lines under
`scope: "contact"`: an event name and at most a scope or a short code, never a name, an address, a
message or a row id. Every event whose name ends in `_failed`, `_unavailable` or `_unconfigured` is also
sent to Sentry as a warning, tagged with the event and a code only; the others are routine log lines.

| Event | Meaning | What to do |
|---|---|---|
| `contact_stored` | A message and its alert row were stored in one transaction. Routine, not reported. | Nothing. |
| `contact_rate_limited` | A message was refused with 429 (`scope` is `client` for the 3 per 10 minutes limit or `global` for the 100 per hour one). Routine, not reported. | A burst of `global` means 100 messages in an hour: look at the traffic. |
| `contact_honeypot` | The hidden field was filled; the generic 400 was answered and nothing was counted or stored. Routine, not reported. | Nothing. |
| `contact_store_failed` | A message passed every check but could not be stored (code: the database's); the visitor was told it was not saved. | Check Supabase status and the database logs now; messages are being lost. Set a Sentry alert on this one. |
| `contact_rate_limit_unavailable` | The shared limiter is missing (code `missing`) or failed; the API answered 503 and stored nothing. | Check Supabase; the form fails closed without its limiter. |
| `contact_unconfigured` | A message arrived while the form is not open (see `contact` in `/api/readiness`); the API answered 503 with `closed: true` and stored nothing. | Expected if you closed the form on purpose; otherwise fix the environment ([deployment.md](deployment.md#contact-form)). |
| `contact_route_failed` | An unexpected failure of the contact route itself (also reported as an error, area `contact`); answered with the generic error. | Read the Sentry event; an unhandled code path. Set an alert. |

The staff alert is sent through the same attempt step as the other outboxes, so its `delivery_*` lines
(`delivery_attempted`, `delivery_send_capped`, `delivery_expired` and the rest, below) carry `channel`
`contact` and the kind `contact_staff_alert`. Its send bucket is `send:contact_staff_alert`. A
`delivery_expired` for that kind means an alert is parked for a person
([incident-runbook.md](incident-runbook.md#contact-messages)).

### Alerts from the email outbox (Task 8a)

The sends made right after an answer and the cron worker (`/api/cron/email-outbox`) share one
attempt step (`lib/outbox/attempt.ts`). Its log lines (`scope: "outbox"`, with `channel` `leads`,
`orders`, `contact` or `worker`; signup sends log under `scope: "leads"`) carry event names, message kinds,
counts and short codes only, never an address, a name, an order reference or a row id. These are
also sent to Sentry as warnings, tagged with the event, kind and code only:

- `delivery_send_capped` and `delivery_send_cap_unavailable`: the hourly send bucket of that message
  kind (`send:<kind>`, one per kind, `LEAD_ACK_SEND_LIMIT_PER_HOUR` each) was spent or could not be checked; the row was handed back and stays due.
- `delivery_claim_failed`: a claim function failed (database or answer shape); nothing was sent.
- `delivery_message_invalid`: a claimed row could not be turned into a truthful email (for example a
  staff alert with no staff address, or a quote with a non-https payment link); it is recorded as
  `failed` with `message_invalid`.
- `delivery_record_failed`: the outcome could not be recorded; the row
  stays `sending`; the next cron run (once a day on Hobby, and never before 15 minutes) re-sends it under the same idempotency key if that run is within 23 hours of the stuck claim; otherwise it is parked as `stale_unconfirmed`.
- `delivery_expired`: rows parked for a human: a final failure (the eighth attempt, or
  `invalid_idempotent_request`), tagged with its kind and code, or unconfirmed sends older than 23
  hours (`stale_unconfirmed`, as a count).

Routine lines, not reported: `delivery_attempted` (with `status` and a failure code),
`delivery_skipped` (a withdrawn lead or a superseded quote, as a count) and `worker_run` (one line
per cron run with `sent`, `failed`, `skipped` and `deferred`). An unexpected failure of the cron
route is reported as `outbox_worker_failed` (area `outbox`) and answered 500 `{ ok: false }`.

Every email is still attempted right after the API answer (R88); the cron worker is only the retry net.
It runs once a day (`0 6 * * *` in `vercel.json`, because the site stays on the Hobby plan, ruling R180,
2026-10-21; see [deployment.md](deployment.md#email-outbox-worker-task-8a)). A failed send is retried at the
next daily run, up to 8 attempts. A send whose outcome is unknown (a timeout, a provider server error) may
only be retried within 23 hours of the claim of the first attempt that left it unconfirmed, so on this
schedule such a row gets at most one retry before it is parked as `delivery_expired` for a person. A `delivery_expired`
alert therefore means a person has to act, and on this schedule it will be more common than on a
15-minute one: [incident-runbook.md](incident-runbook.md#parked-emails) says how to inspect, re-queue or close the row.

Set a Sentry alert on `delivery_expired` and `outbox_worker_failed`.

### Alerts from the staff API (Task 8b)

`logAdminEvent` (`lib/admin/http.ts`) writes the staff routes' log lines (`scope: "admin"`): an
event name and at most a reason, a status or a short code, never an email, a name, a password,
an order reference, a tracking link or a configuration value. These are also sent to Sentry as
warnings, tagged with the event and code only:

- `admin_unconfigured`: a staff request arrived while Supabase's URL or publishable key is missing,
  or a sign-in while the rate limiter cannot run (no service role key or `LEAD_IP_HASH_SECRET`);
  answered 503.
- `admin_auth_unavailable`: Supabase Auth or the `staff_users` read did not answer, or not within
  5 seconds (answered 503; nothing changed).
- `staff_sign_in_unavailable`: Auth or the sign-in rate limiter did not answer during a sign-in.
- `staff_sign_out_unavailable`: this device's session cookies were cleared, but Auth did not confirm it
  revoked the session, so the server-side session may live on until it expires.
- `admin_action_failed`: an unexpected failure of a staff route (also reported as an error with
  area `admin`); answered 500 with the generic copy.

Routine lines, not reported: `admin_request_refused` (with `cross_site`, `signed_out` or
`not_staff`), `admin_order_not_found`, `admin_fields_refused`, `admin_conflict` (`stale` or
`not_allowed`), `admin_quote_saved`, `admin_quote_queued`, `admin_status_changed`,
`admin_tracking_link_rotated`, `staff_signed_in`, `staff_sign_in_refused`,
`staff_sign_in_rate_limited` and `staff_signed_out`. A run of `staff_sign_in_refused` or
`staff_sign_in_rate_limited` lines means someone is guessing passwords.

Set a Sentry alert on `admin_auth_unavailable` and `admin_action_failed`.

### Alerts from the order and tracking routes (final review O-I5)

The order request route (`/api/orders`) and the tracking route (`/api/orders/track`, also read by the
`/track` and `/orders/<token>` pages) log under `scope: "orders"` and `scope: "order-tracking"`
(`lib/orders/dependencies.ts`). Every event whose name ends in `_failed`, `_unavailable`,
`_unconfigured` or `_invalid` is also sent to Sentry as a warning, tagged with the event and a short
code only (never a name, an address, a reference, a token or a product). This is the money path, so
these are the alerts that matter most once commerce is on:

| Event | Meaning | What to do |
|---|---|---|
| `order_store_failed` | An order request passed every check but could not be stored (code: the database's). The customer was told it was not confirmed. | Check Supabase status and the database logs now; orders are being lost. Set a Sentry alert on this one. |
| `order_route_failed` | An unexpected failure of the order route itself (also reported as an error, area `orders`); answered with the generic failure copy. | Read the Sentry event; an unhandled code path. Set an alert. |
| `order_storage_unconfigured` | Commerce is on but Supabase's URL, the service role key or `LEAD_IP_HASH_SECRET` (32+ characters) is missing, so orders answer 503 and store nothing. | Fix the environment; switch commerce off in the Studio until then ([incident-runbook.md](incident-runbook.md#switching-commerce-off-now)). |
| `order_rate_limit_unavailable` | The shared rate limiter could not run (code); the route fails closed and answers 503. | Check Supabase; the same cause usually raises `order_store_failed`. |
| `order_catalogue_unavailable` | The product catalogue could not be read from Sanity, so no order line can be checked; answered 503. | Check Sanity status and `NEXT_PUBLIC_SANITY_*`. |
| `order_catalogue_invalid` | A product in an order has a catalogue record the server cannot snapshot: its name, SKU, variant or pack is empty, too long or has a line break (answered 400, "products unavailable"). | Fix that product in the Studio. |
| `order_config_invalid` | The CMS order consent version cannot be stored (code `consent_version_invalid`); the built-in order sentence and version are used instead. | Fix `orderConsentCopyVersion` in the Studio ([cms-operations.md](cms-operations.md)). |
| `order_track_failed` | A tracking lookup failed unexpectedly (code); the visitor sees the generic failure. | Check Supabase. |
| `order_track_route_failed` | An unexpected failure of the tracking route (area `orders`). | Read the Sentry event. |
| `order_track_storage_unconfigured`, `order_track_rate_limit_unavailable` | The tracking counterparts of the two storage events above; answered 503. | As above. |

Routine lines, not reported: `order_stored` (with a line count), `order_duplicate` (the same
submission key sent again), `order_rate_limited`, `order_commerce_disabled`, `order_honeypot`,
`order_products_refused`, `order_tracked`, `order_track_miss`, `order_track_rate_limited` and
`order_tracking_disabled`.

### Alerts from the staff pages and sign-in (final review O-I5)

Besides the warnings in the staff API section below, these are sent to Sentry as errors (area
`admin`, tagged with the event only):

| Event | Meaning |
|---|---|
| `admin_quote_failed`, `admin_status_failed`, `admin_tracking_link_failed` | An unexpected failure of a staff action (save or queue a quote, change a status, make a tracking link). The action did not complete; the staff member saw the generic failure. Logged alongside as `admin_action_failed`. |
| `staff_sign_in_failed`, `staff_sign_out_failed` | An unexpected failure of the sign-in or sign-out route. |
| `admin_orders_list_failed` | The order list page could not read the orders; staff saw the could-not-load notice. |
| `admin_order_read_failed` | An order page could not read its order; the same notice. |

Set a Sentry alert on `admin_orders_list_failed` and `admin_order_read_failed` too: staff cannot work
the queue while they fire.

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

