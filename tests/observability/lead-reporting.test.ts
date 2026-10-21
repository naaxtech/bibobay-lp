import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const reported = vi.hoisted(() => ({ errors: [] as Array<[unknown, Record<string, unknown>]>, events: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/lib/observability/report", () => ({
  reportError: (error: unknown, context: Record<string, unknown>) => reported.errors.push([error, context]),
  reportEvent: (event: string, tags: Record<string, unknown>) => reported.events.push([event, tags]),
}));
const failing = vi.hoisted(() => ({ dependencies: false }));
vi.mock("@/lib/leads/dependencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leads/dependencies")>();
  return {
    ...actual,
    createLeadDependencies: async (...args: Parameters<typeof actual.createLeadDependencies>) => {
      if (failing.dependencies) throw new Error("sanity unreachable for parent@example.com");
      return actual.createLeadDependencies(...args);
    },
  };
});

import { POST } from "@/app/api/leads/route";
import { logLeadEvent } from "@/lib/leads/dependencies";

/** Task 10M-a: the lead route's unexpected failures and the send-cap alerts (ruling R52) reach Sentry. */
beforeEach(() => {
  reported.errors.length = 0;
  reported.events.length = 0;
  failing.dependencies = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lead route errors", () => {
  it("reports an unexpected failure through reportError and answers a generic 500", async () => {
    failing.dependencies = true;
    const response = await POST(new Request("http://127.0.0.1:3000/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "parent@example.com", consent: true }) }));
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, persisted: false, acknowledgementQueued: false });
    expect(JSON.stringify(body)).not.toMatch(/sanity|parent@example\.com/);
    expect(reported.errors).toHaveLength(1);
    expect(reported.errors[0]![1]).toEqual({ area: "leads", event: "lead_route_failed" });
  });
});

describe("operational warnings (ruling R52)", () => {
  it("sends the send-cap and failure events to Sentry as warnings, and keeps the log line", () => {
    logLeadEvent({ event: "delivery_send_capped", kind: "acknowledgement", budget: "lead_acknowledgement" });
    logLeadEvent({ event: "delivery_send_cap_unavailable", kind: "staff_alert", code: "PGRST301" });
    logLeadEvent({ event: "lead_store_failed", code: "23505" });
    expect(reported.events).toEqual([
      ["delivery_send_capped", { kind: "acknowledgement", budget: "lead_acknowledgement" }],
      ["delivery_send_cap_unavailable", { kind: "staff_alert", code: "PGRST301" }],
      ["lead_store_failed", { code: "23505" }],
    ]);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("reports an unavailable or unconfigured bot check, but not a refusal", () => {
    logLeadEvent({ event: "lead_bot_check_refused", reason: "rejected" });
    expect(reported.events).toEqual([]);
    logLeadEvent({ event: "lead_bot_check_unavailable", reason: "timeout" });
    logLeadEvent({ event: "lead_bot_check_unconfigured", reason: "misconfigured" });
    expect(reported.events).toEqual([
      ["lead_bot_check_unavailable", {}],
      ["lead_bot_check_unconfigured", {}],
    ]);
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it("does not report routine events", () => {
    logLeadEvent({ event: "lead_stored", created: true });
    logLeadEvent({ event: "lead_rate_limited" });
    logLeadEvent({ event: "lead_honeypot" });
    logLeadEvent({ event: "delivery_skipped", count: 1 });
    expect(reported.events).toEqual([]);
  });

  it("reports the outbox claim's warnings: a failed claim, an unbuildable message and parked rows (Task 8a)", () => {
    logLeadEvent({ event: "delivery_claim_failed", code: "PGRST301" });
    logLeadEvent({ event: "delivery_message_invalid", kind: "staff_alert" });
    logLeadEvent({ event: "delivery_expired", count: 2 });
    expect(reported.events).toEqual([
      ["delivery_claim_failed", { code: "PGRST301" }],
      ["delivery_message_invalid", { kind: "staff_alert" }],
      ["delivery_expired", {}],
    ]);
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});
