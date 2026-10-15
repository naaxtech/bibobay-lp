import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({ tracked: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/lib/analytics/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/client")>();
  return { ...actual, track: (event: string, properties: Record<string, unknown>) => analytics.tracked.push([event, properties]) };
});

import { LeadForm } from "@/components/forms/LeadForm";
import { FORM_COPY } from "@/components/forms/form-copy";
import { Footer } from "@/components/landing/Footer";
import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { proxy } from "@/proxy";
import { verifyEnvironment } from "@/scripts/verify-env";

/** Ruling R70 wiring: environment, CSP, footer choices and the signup outcome. */
const KEY = "phc_ExampleKey0123456789abcdefABCDEF";

beforeEach(() => {
  analytics.tracked.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("analytics environment", () => {
  it("accepts the PostHog project key and host as public names, documented in .env.example", () => {
    expect(verifyEnvironment({ NEXT_PUBLIC_POSTHOG_KEY: KEY, NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com" }, "production").forbiddenPublic).toEqual([]);
    const example = readFileSync(resolve(".env.example"), "utf8");
    expect(example).toMatch(/^NEXT_PUBLIC_POSTHOG_KEY=$/m);
    expect(example).toMatch(/^NEXT_PUBLIC_POSTHOG_HOST=$/m);
  });

  it("refuses a PostHog personal API key under the public name: it can read the whole project", () => {
    expect(verifyEnvironment({ NEXT_PUBLIC_POSTHOG_KEY: "phx_personalKey0123456789abcdef" }, "production").forbiddenPublic).toEqual(["NEXT_PUBLIC_POSTHOG_KEY"]);
  });
});

describe("content security policy", () => {
  it("lets the page send events to the configured PostHog host only", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const without = proxy(new NextRequest("https://bibo.example/")).headers.get("content-security-policy") ?? "";
    expect(without).not.toMatch(/posthog|ph\.example/);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://ph.example.com");
    const policy = proxy(new NextRequest("https://bibo.example/")).headers.get("content-security-policy") ?? "";
    expect(/connect-src ([^;]*)/.exec(policy)?.[1]).toContain("https://ph.example.com");
    // Never as a script source: the SDK is bundled, and 'strict-dynamic' stays nonce-only.
    expect(/script-src ([^;]*)/.exec(policy)?.[1]).not.toContain("ph.example.com");
  });
});

describe("footer", () => {
  it("offers Analytics choices only while analytics are configured", () => {
    const { unmount } = render(<Footer settings={SAFE_FALLBACK_SETTINGS} />);
    expect(screen.queryByRole("button", { name: "Analytics choices" })).toBeNull();
    unmount();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
    render(<Footer settings={SAFE_FALLBACK_SETTINGS} />);
    expect(screen.getByRole("button", { name: "Analytics choices" })).toBeTruthy();
  });
});

describe("signup outcome", () => {
  it("counts a stored signup with its outcome only, never the details typed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, persisted: true, acknowledgementQueued: true }), { status: 200, headers: { "content-type": "application/json" } })));
    const { lead } = SAFE_FALLBACK_CONTENT;
    render(<LeadForm copy={{ buttonLabel: lead.buttonLabel, consentCopy: lead.consentCopy, successMessage: lead.successMessage, errorMessage: lead.errorMessage }} />);
    fireEvent.change(screen.getByLabelText(FORM_COPY.email.label), { target: { value: "parent@example.com" } });
    fireEvent.click(screen.getByRole("checkbox", { name: lead.consentCopy }));
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: FORM_COPY.formLabel }));
    });
    expect(analytics.tracked).toEqual([["lead_submitted", { persisted: true, acknowledgementQueued: true }]]);
  });

  it("counts nothing when the signup was not stored", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 503, headers: { "content-type": "application/json" } })));
    const { lead } = SAFE_FALLBACK_CONTENT;
    render(<LeadForm copy={{ buttonLabel: lead.buttonLabel, consentCopy: lead.consentCopy, successMessage: lead.successMessage, errorMessage: lead.errorMessage }} />);
    fireEvent.change(screen.getByLabelText(FORM_COPY.email.label), { target: { value: "parent@example.com" } });
    fireEvent.click(screen.getByRole("checkbox", { name: lead.consentCopy }));
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: FORM_COPY.formLabel }));
    });
    expect(analytics.tracked).toEqual([]);
  });
});

describe("root layout", () => {
  it("starts analytics on every page from the server's configuration", () => {
    const layout = readFileSync(resolve("app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<AnalyticsProvider config=\{analyticsConfig\(\)\} \/>/);
  });
});
