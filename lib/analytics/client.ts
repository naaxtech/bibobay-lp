import type { AnalyticsConfig } from "./config";
import { cleanCapture, cleanProperties, type AnalyticsEvent } from "./events";
import { analyticsAllowed, forgetChoiceForTests, writeChoice } from "./preference";

/**
 * The browser side of analytics (ruling R144: opt-in, replacing R70's opt-out). PostHog loads as a
 * first-party chunk (the no-external build, so it cannot fetch PostHog's remote scripts under our
 * 'strict-dynamic' CSP, ruling R50) only when analytics are configured and the visitor has said yes.
 * Before that answer nothing is loaded and every event is dropped, never kept for later. Events
 * sent after the "yes" while the SDK is still loading wait in a short queue.
 *
 * Review C1: with cookieless_mode "always", PostHog ignores opt_out_capturing / opt_in_capturing
 * (posthog-core: "Consent opt in/out is not valid with cookieless_mode=\"always\""). The visitor's
 * choice is therefore enforced here, in before_send, for every event including PostHog's own page
 * views and page leaves, and a load still in flight never starts PostHog once statistics are off.
 */
type PostHogModule = typeof import("posthog-js/dist/module.no-external");
type PostHogClient = PostHogModule["default"];
type PostHogOptions = NonNullable<Parameters<PostHogClient["init"]>[1]>;
type Loader = () => Promise<PostHogModule>;

const loadPostHog: Loader = () => import("posthog-js/dist/module.no-external");

let client: PostHogClient | null = null;
let starting: Promise<boolean> | null = null;
let stopped = false;
const queue: Array<[AnalyticsEvent, Record<string, unknown>]> = [];
const QUEUE_LIMIT = 30;

/**
 * Cookieless for everyone: no cookies, no local or session storage, no person profiles. PostHog
 * counts visitors with a daily-rotating hash on its servers; the project must have "Cookieless
 * server hash mode" switched on, or PostHog ignores these events (docs/observability.md).
 */
export function posthogOptions(config: AnalyticsConfig): PostHogOptions {
  return {
    api_host: config.apiHost,
    defaults: "2026-08-30",
    cookieless_mode: "always",
    persistence: "memory",
    person_profiles: "never",
    autocapture: false,
    // Any truthy value, "history_change" included, also sends the page view of the page PostHog
    // starts on (posthog-core `_loaded` -> `_captureInitialPageview`, cookieless mode needs no
    // opt-in), so the page on which the visitor says yes is counted; later client-side navigations
    // are counted from the history API.
    // src: https://raw.githubusercontent.com/PostHog/posthog-js/posthog-js@1.438.11/packages/browser/src/posthog-core.ts · posthog-js 1.438.11 · 2026-10-17
    capture_pageview: "history_change",
    capture_pageleave: true,
    save_referrer: true,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    enable_heatmaps: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    mask_all_text: true,
    before_send: (capture) => (capture && analyticsActive() ? cleanCapture(capture) : null),
  };
}

function send(event: AnalyticsEvent, properties: Record<string, unknown>): void {
  const clean = cleanProperties(event, properties);
  if (clean && client) client.capture(event, clean);
}

/** True while statistics may be sent: the visitor said yes (here or in another tab) and has not said no since. */
export function analyticsActive(): boolean {
  return !stopped && analyticsAllowed();
}

/**
 * Review M2: a PostHog toolbar link (`#__posthog=…` or the legacy `#state=…`) makes the bundled
 * toolbar code write its parameters to local storage, even with remote loading off. That code
 * reads the address as soon as the SDK module is evaluated (toolbar.js `STATE_FROM_WINDOW`), so
 * the fragment is removed before the SDK is even loaded. The site has no use for the toolbar.
 */
const TOOLBAR_HASH = /(?:^#|&)(?:__posthog|state)=/;

function dropToolbarLink(): void {
  const { hash, pathname, search } = window.location;
  if (TOOLBAR_HASH.test(hash)) window.history.replaceState(window.history.state, "", `${pathname}${search}`);
}

/** Starts analytics when configured and allowed; resolves true once PostHog is running. */
export function startAnalytics(config: AnalyticsConfig | null, load: Loader = loadPostHog): Promise<boolean> {
  if (!config || !analyticsAllowed()) return Promise.resolve(false);
  stopped = false;
  if (client) return Promise.resolve(true);
  if (!starting) dropToolbarLink();
  starting ??= load()
    .then(({ default: posthog }) => {
      if (!analyticsActive()) {
        // Turned off while the SDK was loading: never start it; a later "on" loads it again.
        starting = null;
        return false;
      }
      posthog.init(config.key, posthogOptions(config));
      client = posthog;
      for (const [event, properties] of queue.splice(0)) send(event, properties);
      return true;
    })
    .catch(() => {
      // Analytics must never break the page; without the SDK nothing is sent.
      queue.length = 0;
      starting = null;
      return false;
    });
  return starting;
}

/** Counts one page action. Unknown events and properties are dropped before anything is sent. */
export function track(event: AnalyticsEvent, properties: Record<string, unknown> = {}): void {
  if (stopped || !analyticsAllowed()) return;
  if (client) send(event, properties);
  else if (starting && queue.length < QUEUE_LIMIT) queue.push([event, properties]);
}

/**
 * The visitor said no in the consent notice, or turned statistics off in the footer: stop now and
 * remember it on this device. A PostHog already running keeps running (its opt-out is a no-op in
 * cookieless mode), but before_send drops every event from here. The answer is written last, so
 * whatever follows it (the notice, the provider) already sees statistics stopped.
 */
export function stopAnalytics(): void {
  stopped = true;
  queue.length = 0;
  writeChoice("off");
}

/** The visitor said yes in the consent notice, or turned statistics on in the footer. */
export function resumeAnalytics(config: AnalyticsConfig | null): Promise<boolean> {
  writeChoice("on");
  return startAnalytics(config);
}

export function resetAnalyticsForTests(): void {
  client = null;
  starting = null;
  stopped = false;
  queue.length = 0;
  forgetChoiceForTests();
}
