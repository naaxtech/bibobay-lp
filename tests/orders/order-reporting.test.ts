import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const reported = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock("@/lib/observability/report", () => ({
  reportError: () => {},
  reportEvent: (event: string) => reported.events.push(event),
}));

import { logOrderEvent, logTrackingEvent } from "@/lib/orders/dependencies";
import type { OrderLogEvent } from "@/lib/orders/submit";
import type { TrackingLogEvent } from "@/lib/orders/track";

/*
 * Ruling R52 sends warnings to Sentry. A warning must mean the site needs attention, not that a
 * customer chose a sold-out product or mistyped a reference (review Minor 5): those happen daily.
 */
beforeEach(() => {
  reported.events.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("which order events reach Sentry", () => {
  it("reports the site's own failures", () => {
    const orders: OrderLogEvent[] = [
      { event: "order_store_failed", code: "PGRST301" },
      { event: "order_storage_unconfigured" },
      { event: "order_catalogue_unavailable" },
      { event: "order_rate_limit_unavailable", code: "PGRST301" },
      { event: "order_config_invalid", code: "consent_version_invalid" },
    ];
    const tracking: TrackingLogEvent[] = [
      { event: "order_track_failed", code: "PGRST301" },
      { event: "order_track_storage_unconfigured" },
      { event: "order_track_rate_limit_unavailable", code: "PGRST301" },
    ];
    for (const entry of orders) logOrderEvent(entry);
    for (const entry of tracking) logTrackingEvent(entry);
    expect(reported.events).toEqual([...orders, ...tracking].map((entry) => entry.event));
  });

  it("does not report what a customer did", () => {
    const orders: OrderLogEvent[] = [
      { event: "order_products_refused" },
      { event: "order_honeypot" },
      { event: "order_rate_limited" },
      { event: "order_commerce_disabled" },
      { event: "order_stored", lines: 2 },
      // R81: a retry after a lost answer is the customer's connection, not a fault.
      { event: "order_duplicate" },
    ];
    const tracking: TrackingLogEvent[] = [{ event: "order_track_miss" }, { event: "order_track_rate_limited" }, { event: "order_tracking_disabled" }, { event: "order_tracked" }];
    for (const entry of orders) logOrderEvent(entry);
    for (const entry of tracking) logTrackingEvent(entry);
    expect(reported.events).toEqual([]);
  });
});
