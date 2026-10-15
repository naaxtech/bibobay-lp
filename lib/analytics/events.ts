import { maskPrivatePaths } from "../privacy/private-links";

/**
 * What may leave the browser (ruling R70). The owner wants every visit counted, with what visitors
 * do and where they come from; nothing that identifies a person goes with it. Every event passes
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

/** PostHog's own events that are kept: page views and page leaves (time on page, scroll depth). */
const SDK_EVENTS = new Set(["$pageview", "$pageleave"]);

/** Fields PostHog needs to accept an event (it drops events without them), and the page title. */
const SDK_FIELDS = new Set(["token", "distinct_id", "title"]);

/** Campaign tags kept from the address: where a visit came from. */
const CAMPAIGN_TAGS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/** Ad-click identifiers PostHog would copy from the address: they single out a click, so they go. */
const CLICK_IDS = new Set(["gclid", "gad_source", "gclsrc", "dclid", "gbraid", "wbraid", "fbclid", "msclkid", "twclid", "li_fat_id", "mc_cid", "igshid", "ttclid", "rdt_cid", "epik", "qclid", "sccid", "irclid", "_kx"]);

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MAX_TEXT = 80;

/**
 * Review M1: an address can hide percent-encoded (`%40`, even `%2540`) in a path or a label. Text
 * is decoded up to three times before the email check; undecodable text is checked as it is.
 */
function holdsEmail(value: string): boolean {
  let text = value;
  for (let round = 0; round < 3; round += 1) {
    if (EMAIL.test(text)) return true;
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return EMAIL.test(text);
}

function isEventName(event: string): event is AnalyticsEvent {
  return Object.hasOwn(ANALYTICS_EVENTS, event);
}

function plainValue(value: unknown): AnalyticsValue | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const text = maskPrivatePaths(value.trim());
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
      if (tagValue && !holdsEmail(tagValue)) kept.set(tag, tagValue.slice(0, MAX_TEXT));
    }
    const query = kept.toString();
    const path = holdsEmail(url.pathname) ? "/" : maskPrivatePaths(url.pathname);
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
 * action; keeps the SDK's device, page and source fields with the address cut down; removes person
 * properties, initial-visit copies, ad-click identifiers and any value holding an email address.
 */
export function cleanCapture<T extends CaptureLike>(capture: T): T | null {
  const action = isEventName(capture.event);
  if (!action && !SDK_EVENTS.has(capture.event)) return null;
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
      if (typeof value === "string" && holdsEmail(value)) continue;
      properties[name] = typeof value === "string" ? maskPrivatePaths(value) : value;
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
