import type { AnalyticsConfig } from "./config";
import { cleanCapture, cleanProperties, type AnalyticsEvent } from "./events";
import { analyticsAllowed, writeChoice } from "./preference";

/**
 * The browser side of analytics (ruling R70). PostHog loads as a first-party chunk (the
 * no-external build, so it cannot fetch PostHog's remote scripts under our 'strict-dynamic' CSP,
 * ruling R50) only when analytics are configured and allowed. Events sent before it has loaded wait
 * in a short queue.
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
    before_send: (capture) => (capture ? cleanCapture(capture) : null),
  };
}

function send(event: AnalyticsEvent, properties: Record<string, unknown>): void {
  const clean = cleanProperties(event, properties);
  if (clean && client) client.capture(event, clean);
}

/** Starts analytics when configured and allowed; resolves true once PostHog is running. */
export function startAnalytics(config: AnalyticsConfig | null, load: Loader = loadPostHog): Promise<boolean> {
  if (!config || !analyticsAllowed()) return Promise.resolve(false);
  stopped = false;
  if (client) {
    client.opt_in_capturing({ captureEventName: false });
    return Promise.resolve(true);
  }
  starting ??= load()
    .then(({ default: posthog }) => {
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

/** The visitor turned statistics off: stop now and remember it on this device. */
export function stopAnalytics(): void {
  writeChoice("off");
  stopped = true;
  queue.length = 0;
  client?.opt_out_capturing();
}

/** The visitor turned statistics on again. */
export function resumeAnalytics(config: AnalyticsConfig | null): Promise<boolean> {
  writeChoice("on");
  return startAnalytics(config);
}

export function resetAnalyticsForTests(): void {
  client = null;
  starting = null;
  stopped = false;
  queue.length = 0;
}
