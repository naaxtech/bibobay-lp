import { maskPrivatePaths } from "../privacy/private-links";
import { decodeLeniently } from "../privacy/decode";

/**
 * What may leave the browser (ruling R70; opt-in since R144, so only after the visitor's "yes").
 * The owner wants every visit of a visitor who said yes counted, with what visitors do and where
 * they come from; nothing that identifies a person goes with it. Every event passes
 * through `cleanCapture`, PostHog's `before_send`, so this file is the single gate. A private order
 * link's token (Task 7b) never leaves either: every address, path and label carries
 * `/orders/[token]` instead.
 */

/** The page actions counted, and the properties each may carry. */
export const ANALYTICS_EVENTS = {
  youtube_clicked: ["kind", "video_id", "section", "label"],
  freebie_downloaded: ["file", "section"],
  cta_clicked: ["destination", "section", "label"],
  section_viewed: ["section"],
  tab_selected: ["section", "label"],
  faq_opened: ["index", "section"],
  menu_opened: ["section"],
  lead_submitted: ["persisted", "acknowledgementQueued"],
} as const satisfies Record<string, readonly string[]>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsValue = string | number | boolean;
export type AnalyticsProperties = Record<string, AnalyticsValue>;

/**
 * Pages that are never counted (8c-M1): the staff pages (their paths carry order references) and the
 * editors' Studio. `cleanCapture` applies it to every event, so client-side navigations are covered
 * too; the provider uses it to not start at all on a hard load of one of these pages.
 */
export function isExcludedPagePath(pathname: string): boolean {
  return /^\/(?:admin|studio)(?:[/;?#]|$)/i.test(pathname);
}

/** True when the event's address (`$current_url`) or path (`$pathname`) is an excluded page. */
function onExcludedPage(properties: Record<string, unknown>): boolean {
  const { $current_url: url, $pathname: path } = properties;
  if (typeof path === "string" && isExcludedPagePath(path)) return true;
  if (typeof url !== "string") return false;
  try {
    return isExcludedPagePath(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** PostHog's own events that are kept: page views and page leaves (time on page, scroll depth). */
const SDK_EVENTS = new Set(["$pageview", "$pageleave"]);

/** Fields PostHog needs to accept an event (it drops events without them), and the page title. */
const SDK_FIELDS = new Set(["token", "distinct_id", "title"]);

/** Campaign tags kept from the address: where a visit came from. */
const CAMPAIGN_TAGS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** Ad-click identifiers PostHog would copy from the address: they single out a click, so they go. */
const CLICK_IDS = new Set(["gclid", "gad_source", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "li_fat_id", "mc_cid", "igshid", "ttclid", "rdt_cid", "epik", "qclid", "sccid", "irclid", "_kx"]);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** An "@", or one percent-encoded any number of times (`%40`, `%2540`, …). */
const AT_SIGN = /@|%(?:25)*40/i;
const MAX_TEXT = 80;
/**
 * The longest value checked or kept, in characters (Task 7b re-review 2 O-a): an address can be
 * as long as the request line allows (about 16 KB), and the email check costs more on long text.
 */
const MAX_FIELD = 2_000;
const bounded = (value: string) => value.slice(0, MAX_FIELD);

/**
 * Review M1: an address can hide percent-encoded (`%40`, even `%2540`) in a path or a label. Text
 * is decoded up to three times before the email check; undecodable text is checked as it is.
 */
function holdsEmail(value: string): boolean {
  if (!AT_SIGN.test(value)) return false;
  // Re-review 3 M1: decoded leniently, so a stray "%" or an escape cut by MAX_FIELD cannot hide an
  // encoded address beside it (decodeURIComponent threw on the whole text).
  return EMAIL.test(value) || EMAIL.test(decodeLeniently(value));
}

function isEventName(event: string): event is AnalyticsEvent {
  return Object.hasOwn(ANALYTICS_EVENTS, event);
}

function plainValue(value: unknown): AnalyticsValue | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const text = maskPrivatePaths(bounded(value.trim()));
    return text && !holdsEmail(text) ? text.slice(0, MAX_TEXT) : undefined;
  }
  return undefined;
}

/** An action's properties, reduced to its allow-list of short plain values; null for unknown events. */
export function cleanProperties(event: string, properties: Record<string, unknown>): AnalyticsProperties | null {
  if (!isEventName(event)) return null;
  const clean: AnalyticsProperties = {};
  for (const name of ANALYTICS_EVENTS[event]) {
    const value = plainValue(properties[name]);
    if (value !== undefined) clean[name] = value;
  }
  return clean;
}

/** Origin and path, plus the campaign tags; no other query, no fragment. A path holding an email address becomes "/". */
function pageAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const kept = new URLSearchParams();
    for (const tag of CAMPAIGN_TAGS) {
      const tagValue = url.searchParams.get(tag);
      if (tagValue && !holdsEmail(bounded(tagValue))) kept.set(tag, tagValue.slice(0, MAX_TEXT));
    }
    const query = kept.toString();
    const pathname = bounded(url.pathname);
    const path = holdsEmail(pathname) ? "/" : maskPrivatePaths(pathname);
    return `${url.origin}${path}${query ? `?${query}` : ""}`;
  } catch {
    return undefined;
  }
}

/** The referring site only: its path or search terms can say who the visitor is. */
function referrer(value: unknown): string | undefined {
  if (value === "$direct") return value;
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export interface CaptureLike {
  uuid: string;
  event: string;
  properties: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
  $unset?: string[];
  timestamp?: Date;
}

/**
 * PostHog `before_send`: drops anything that is not a page view, page leave or allow-listed
 * action, and anything on a staff or Studio page; keeps the SDK's device, page and source fields with the address cut down; removes person
 * properties, initial-visit copies, ad-click identifiers and any value holding an email address.
 */
export function cleanCapture<T extends CaptureLike>(capture: T): T | null {
  const action = isEventName(capture.event);
  if (!action && !SDK_EVENTS.has(capture.event)) return null;
  if (onExcludedPage(capture.properties ?? {})) return null;
  const allowed = action ? new Set<string>(ANALYTICS_EVENTS[capture.event as AnalyticsEvent]) : new Set<string>();
  const properties: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(capture.properties ?? {})) {
    if (name.startsWith("$initial_") || name === "$set" || name === "$set_once" || CLICK_IDS.has(name)) continue;
    if (name === "$current_url") {
      const address = pageAddress(value);
      if (address) properties[name] = address;
      continue;
    }
    if (name === "$referrer") {
      const site = referrer(value);
      if (site) properties[name] = site;
      continue;
    }
    if (name.startsWith("$") || CAMPAIGN_TAGS.includes(name) || SDK_FIELDS.has(name)) {
      const text = typeof value === "string" ? bounded(value) : undefined;
      if (text !== undefined && holdsEmail(text)) continue;
      properties[name] = text !== undefined ? maskPrivatePaths(text) : value;
      continue;
    }
    if (!allowed.has(name)) continue;
    const plain = plainValue(value);
    if (plain !== undefined) properties[name] = plain;
  }
  const clean = { ...capture, properties };
  delete clean.$set;
  delete clean.$set_once;
  delete clean.$unset;
  return clean;
}
