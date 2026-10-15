# Observability: visit statistics

How the site counts visits and what it never collects. Ruling R70 (owner request, 2026-10-16:
"track all website users, what they do and where they come from"). Error monitoring (Sentry) is
not wired yet; it will get its own section here.

## What is counted

PostHog runs on every public page (not the Studio) whenever `NEXT_PUBLIC_POSTHOG_KEY` holds a
project key. There is no consent banner, because nothing is stored on the visitor's device:

| Event | When | Properties |
|---|---|---|
| `$pageview`, `$pageleave` | Every page, including client-side navigation; leave carries time on page and scroll depth | Page address cut to origin + path + `utm_source/medium/campaign/content/term`; referring site (origin only); browser, OS, device type, screen and viewport size |
| `youtube_clicked` | A link to the channel, its subscribe prompt or a video | `kind` (`channel`, `subscribe`, `video`), `video_id`, `section`, `label` |
| `freebie_downloaded` | The activity pack (or any `/freebies/*.pdf`) | `file`, `section` |
| `cta_clicked` | Any other link | `destination` (`anchor`, `internal`, `external`), `section`, `label` |
| `section_viewed` | A landing section reaches the middle of the screen (once per page load) | `section` |
| `tab_selected` | A friend or video tab | `section`, `label` |
| `faq_opened` | A question is opened | `index`, `section` |
| `menu_opened` | The phone menu | `section` |
| `lead_submitted` | The signup form gets a stored answer | `persisted`, `acknowledgementQueued` |

`section` is the nearest landing section (`hero`, `episodes`, `lead`, …) or `header`, `footer`,
`menu`. `label` is the link's visible words, at most 80 characters.

Where visitors come from: PostHog's Web analytics dashboard groups `$pageview` by referring domain,
`utm_*` campaign tags, country and device. Tag links you share, for example
`https://<domain>/?utm_source=youtube&utm_medium=video_description&utm_campaign=activity_pack`.

## What is never collected

- No cookies, no local or session storage (`cookieless_mode: "always"`, `persistence: "memory"`),
  no person profiles (`person_profiles: "never"`), no `identify` call. PostHog counts unique
  visitors with a hash it computes on its servers from a salt that rotates daily, so a visitor
  is not recognised on a later day.
- No autocapture, session replay, heatmaps, dead-click or rage-click capture, exception capture,
  surveys, product tours, web experiments, feature flags or web vitals.
- No form contents: `lead_submitted` carries the outcome only.
- `before_send` (`lib/analytics/events.ts` `cleanCapture`) is the one gate: it drops any event not
  in the table above, any property not allowed for that event (PostHog's own `token`,
  `distinct_id` and page `title` are kept: it refuses events without them), query strings other than campaign
  tags, the referrer's path and query, ad-click identifiers (`gclid`, `fbclid`, `msclkid` and
  similar), person properties, initial-visit copies, and any value that looks like an email address.
- PostHog code is the bundled `posthog-js/dist/module.no-external` build with external dependency
  loading off, so it never fetches scripts from PostHog under the site's `'strict-dynamic'` CSP. The
  configured host is added to `connect-src` only.

## Who is not counted

- A browser that sends Global Privacy Control or Do Not Track, unless that visitor turns statistics
  on in Analytics choices.
- A visitor who turns statistics off under **Analytics choices** in the footer. The choice is kept
  in `localStorage` (`bibo.analytics.v1`), which is the only thing analytics ever store, and only
  after that choice.
- Automated browsers: PostHog drops events from known bots and from browsers driven by automation
  (`navigator.webdriver`), so crawlers and test runs do not inflate the numbers. The e2e spec
  stands in for a person's browser for that reason.
- Everyone, when `NEXT_PUBLIC_POSTHOG_KEY` is empty: no SDK download, no request, no footer link.

## Setting it up (provisioning task)

1. Create the PostHog project under the BIBO Bay owner account. Pick the US or EU region and set
   `NEXT_PUBLIC_POSTHOG_HOST` to match (`https://us.i.posthog.com` or `https://eu.i.posthog.com`).
2. **Project settings → Web analytics → Cookieless server hash mode: on.** Without it PostHog
   ignores every event this site sends.
3. Consider **Project settings → Discard client IP data** if you do not need city-level location;
   country-level reports still work from the GeoIP lookup made before the address is discarded.
4. Set `NEXT_PUBLIC_POSTHOG_KEY` (the project key, `phc_…`; never a personal key, `phx_…`, which
   `verify:env` refuses) in Vercel, then redeploy.
5. Check: open the site, click a YouTube link and the activity pack, then confirm the events in
   PostHog's Activity view.

The privacy page's fallback text (`lib/content/legal-fallback.ts`) describes all of this; keep it
in step with the code, and have the owner and a lawyer review it before launch.

## Proof

- Unit: `tests/analytics/*` (allow-list, address and referrer trimming, click meaning, options,
  opt-out, GPC/DNT, wiring into the footer, CSP, signup outcome).
- Browser: `e2e/analytics/analytics.spec.ts`, skipped unless `E2E_ANALYTICS=1`. Run it against a
  production build made with a placeholder key and `NEXT_PUBLIC_POSTHOG_HOST=https://ph.example.com`
  (Playwright answers that host itself; no real request is made). It checks that events reach the
  host with trimmed addresses, that nothing is written to cookies or storage, and that GPC and the
  footer switch stop all requests.
