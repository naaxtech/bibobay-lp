import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
import { UI_COPY } from "@/components/landing/ui-copy";
import { resetAnalyticsForTests } from "@/lib/analytics/client";
import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { proxy } from "@/proxy";
import { verifyEnvironment } from "@/scripts/verify-env";

/** Ruling R144 wiring (opt-in, over R70): environment, CSP, the notice, footer choices and the signup outcome. */
const KEY = "phc_ExampleKey0123456789abcdefABCDEF";

beforeEach(() => {
  analytics.tracked.length = 0;
  resetAnalyticsForTests();
  window.localStorage.clear();
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
  it("lets the page send events to the configured PostHog host only", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const without = (await proxy(new NextRequest("https://bibo.example/"))).headers.get("content-security-policy") ?? "";
    expect(without).not.toMatch(/posthog|ph\.example/);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://ph.example.com");
    const policy = (await proxy(new NextRequest("https://bibo.example/"))).headers.get("content-security-policy") ?? "";
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

  it("keeps Analytics choices when an editor removes every legal link (review I2)", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
    render(<Footer settings={{ ...SAFE_FALLBACK_SETTINGS, footer: { ...SAFE_FALLBACK_SETTINGS.footer, legalLinks: [] } }} />);
    expect(screen.getByRole("button", { name: "Analytics choices" })).toBeTruthy();
  });

  it("tells a visitor who has not answered that statistics are off, and offers to turn them on (ruling R144)", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", KEY);
    render(<Footer settings={SAFE_FALLBACK_SETTINGS} />);
    fireEvent.click(screen.getByRole("button", { name: "Analytics choices" }));
    const dialog = screen.getByRole("dialog", { name: "Analytics choices" });
    expect(within(dialog).getByText("Visit statistics are off for this browser.")).toBeTruthy();
    const turnOn = within(dialog).getByRole("button", { name: "Turn statistics on" });
    // Equal weight (ruling R148): "on" is no louder than "Close" beside it.
    expect(turnOn.className).toBe("btn btn-paper");
    expect(within(dialog).getByRole("button", { name: "Close" }).className).toBe(turnOn.className);
    expect(within(dialog).queryByRole("button", { name: "Turn statistics off" })).toBeNull();
    expect(within(dialog).getByText("Statistics stay off until you say yes. Your answer, yes or no, is kept on this device; change it here at any time.")).toBeTruthy();
  });

  it("keeps the explainer's first line and the status and button labels, and says a GPC/DNT browser can still turn statistics on here (ruling R147)", () => {
    expect(UI_COPY.analytics.choices).toBe("Analytics choices");
    expect(UI_COPY.analytics.explainer).toHaveLength(3);
    expect(UI_COPY.analytics.explainer[0]).toMatch(/^BIBO Bay counts visits to learn which pages, videos and activities families use/);
    expect(UI_COPY.analytics.explainer[1]).toMatch(/ It never records what you type into the form\. A browser that sends Global Privacy Control or Do Not Track is not asked and not counted, unless you turn statistics on here\.$/);
    // Re-review N3: the dialog makes the same address claim as the privacy page, no more (PostHog documents only that the
    // address is stripped from the event before processing).
    expect(UI_COPY.analytics.explainer[1]).toContain("then removes the address from the event before it is processed further, so the address is not stored with the statistics");
    expect(UI_COPY.analytics.explainer[1]).not.toMatch(/does not keep the address/i);
    expect(UI_COPY.analytics.statusOn).toBe("Visit statistics are on for this browser.");
    expect(UI_COPY.analytics.statusOff).toBe("Visit statistics are off for this browser.");
    expect(UI_COPY.analytics.turnOff).toBe("Turn statistics off");
    expect(UI_COPY.analytics.turnOn).toBe("Turn statistics on");
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

  it("puts the consent notice first in the body, before the page, so keyboard and screen-reader users reach it early (ruling R148)", () => {
    const layout = readFileSync(resolve("app/layout.tsx"), "utf8");
    const perRequest = layout.indexOf("<RenderPerRequest />");
    const notice = layout.indexOf("<ConsentNotice config={analyticsConfig()} />");
    const page = layout.indexOf("{children}", notice);
    const provider = layout.indexOf("<AnalyticsProvider config={analyticsConfig()} />");
    expect(perRequest).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(perRequest);
    expect(page).toBeGreaterThan(notice);
    expect(provider).toBeGreaterThan(page);
  });
});

describe("consent notice styles", () => {
  /** The declarations of the first rule written exactly as `<selector> { … }`. */
  const blockOf = (css: string, selector: string) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const zIndex = (css: string, selector: string) => Number(/z-index:\s*(\d+)/.exec(blockOf(css, selector))?.[1] ?? Number.NaN);
  const noticeCss = () => readFileSync(resolve("components/analytics/consent-notice.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("never clip the buttons' hover shadow: the card does not scroll, only its text does, and the card stays below the header (review nit 11)", () => {
    const css = noticeCss();
    const card = blockOf(css, ".consent-notice");
    expect(card).toMatch(/max-block-size:\s*calc\(100dvh - var\(--site-header-height\)/);
    expect(card).toMatch(/display:\s*flex/);
    expect(card).toMatch(/flex-direction:\s*column/);
    expect(card).not.toMatch(/overflow/);
    const text = blockOf(css, ".consent-notice__text");
    expect(text).toMatch(/overflow-y:[ \t]*auto/);
    expect(text).toMatch(/min-block-size:\s*0/);
    // Only the text may shrink: the heading and the answers keep their size.
    expect(blockOf(css, ".consent-notice__title")).toMatch(/flex-shrink:\s*0/);
    expect(blockOf(css, ".consent-notice__actions")).toMatch(/flex-shrink:\s*0/);
  });

  it("are imported with the other component sheets", () => {
    const globals = readFileSync(resolve("app/globals.css"), "utf8");
    expect(globals).toMatch(/^@import "\.\.\/components\/analytics\/consent-notice\.css";$/m);
  });

  it("keep the notice above the header but under every modal dialog and the skip link", () => {
    const notice = zIndex(readFileSync(resolve("components/analytics/consent-notice.css"), "utf8"), ".consent-notice");
    const landing = readFileSync(resolve("components/landing/landing.css"), "utf8");
    expect(notice).toBeGreaterThan(zIndex(landing, ".site-header"));
    expect(notice).toBeLessThan(zIndex(landing, ".dialog-layer"));
    expect(notice).toBeLessThan(zIndex(landing, ".skip-link"));
  });
});
