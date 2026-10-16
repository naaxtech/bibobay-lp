import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sentry = vi.hoisted(() => ({
  exceptions: [] as Array<[unknown, unknown]>,
  messages: [] as Array<[string, unknown]>,
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: (error: unknown, context: unknown) => {
    sentry.exceptions.push([error, context]);
    return "id";
  },
  captureMessage: (message: string, context: unknown) => {
    sentry.messages.push([message, context]);
    return "id";
  },
}));

import { reportError, reportEvent } from "@/lib/observability/report";

/*
 * Task 10M-a, privacy rules 5 and 6: app code reaches Sentry only through lib/observability/report.ts,
 * with tags from a short allow-list (area, event, kind, code) and nothing else. No DSN: nothing at all.
 */
const DSN = "https://***@o0.ingest.example.com/1";
const LEAD = { email: "parent@example.com", firstName: "Ana", ageBand: "6-8", consent: true, utm: { source: "newsletter" } };

beforeEach(() => {
  sentry.exceptions.length = 0;
  sentry.messages.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reportError / reportEvent", () => {
  it("send nothing while Sentry is not configured", () => {
    reportError(new Error("boom"), { area: "leads", event: "lead_route_failed" });
    reportEvent("delivery_send_capped", { kind: "acknowledgement" });
    expect(sentry.exceptions).toEqual([]);
    expect(sentry.messages).toEqual([]);
  });

  it("report an error with allow-listed tags only", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const error = new Error("boom");
    reportError(error, { area: "leads", event: "lead_route_failed", ...(LEAD as Record<string, unknown>) });
    expect(sentry.exceptions).toEqual([[error, { tags: { area: "leads", event: "lead_route_failed" } }]]);
  });

  it("report an operational event as a warning, tagged with its event and kind (ruling R52)", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    reportEvent("delivery_send_capped", { kind: "acknowledgement" });
    reportEvent("delivery_send_cap_unavailable", { kind: "staff_alert", code: "PGRST301" });
    expect(sentry.messages).toEqual([
      ["delivery_send_capped", { level: "warning", tags: { event: "delivery_send_capped", kind: "acknowledgement" } }],
      ["delivery_send_cap_unavailable", { level: "warning", tags: { event: "delivery_send_cap_unavailable", kind: "staff_alert", code: "PGRST301" } }],
    ]);
  });

  it("let no part of a founding-family signup through, whichever way it is passed", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    reportError(new Error("x"), { area: "leads", event: "parent@example.com", kind: "Ana", code: "6-8", lead: LEAD } as never);
    reportEvent("parent@example.com" as never, { kind: "a b c", code: LEAD as never });
    const sent = JSON.stringify([sentry.exceptions.map(([, context]) => context), sentry.messages]);
    for (const value of ["parent", "example.com", "Ana", "6-8", "newsletter", "a b c"]) expect(sent, value).not.toContain(value);
  });
});
