import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ruling R144/R148: a visitor is asked once, in a non-modal notice, whether visits may be counted.
 * Nothing loads before a "yes"; the answer is kept on the device; GPC/DNT browsers are not asked
 * (R147); a keyless site asks nothing (R49/R146). The SDK is replaced here by a recorder.
 */
const sdk = vi.hoisted(() => {
  const calls = { init: [] as Array<[string, Record<string, unknown>]> };
  const posthog = {
    init: (key: string, options: Record<string, unknown>) => {
      calls.init.push([key, options]);
      return posthog;
    },
    capture: () => {},
  };
  return { calls, posthog };
});
vi.mock("posthog-js/dist/module.no-external", () => ({ default: sdk.posthog }));
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { ConsentNotice } from "@/components/analytics/ConsentNotice";
import { UI_COPY } from "@/components/landing/ui-copy";
import { resetAnalyticsForTests } from "@/lib/analytics/client";
import { ANALYTICS_PREFERENCE_KEY } from "@/lib/analytics/preference";

const CONFIG = { key: "phc_ExampleKey0123456789abcdefABCDEF", apiHost: "https://ph.example.com" };
const TITLE = "Can we count your visit?";

const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

const notice = () => screen.queryByRole("region", { name: TITLE });

beforeEach(() => {
  resetAnalyticsForTests();
  nav.pathname = "/";
  sdk.calls.init.length = 0;
  window.localStorage.clear();
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  window.localStorage.clear();
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  resetAnalyticsForTests();
});

describe("the copy (Tasks 2 and 3 quote it verbatim)", () => {
  it("asks plainly, with two answers and the privacy page", () => {
    expect(UI_COPY.consentNotice).toEqual({
      title: "Can we count your visit?",
      body: "BIBO Bay would like to count visits with PostHog to learn which pages, videos and activities families use, and how they find us. Counting sets no cookies, builds no profile of you and never records what you type. The only thing it keeps on this device is your answer; change it any time under Analytics choices in the footer.",
      accept: "Yes, count my visit",
      decline: "No, do not count me",
      privacy: "Privacy page",
    });
  });
});

describe("ConsentNotice", () => {
  it("renders nothing when analytics are not configured: there is nothing to ask about (ruling R49)", () => {
    const { container } = render(<ConsentNotice config={null} />);
    expect(container.innerHTML).toBe("");
  });

  it.each(["on", "off"])("renders nothing once the visitor has answered \"%s\"", (answer) => {
    window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, answer);
    const { container } = render(<ConsentNotice config={CONFIG} />);
    expect(container.innerHTML).toBe("");
  });

  it("does not ask a browser that sends Global Privacy Control or Do Not Track (ruling R147)", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    const first = render(<ConsentNotice config={CONFIG} />);
    expect(first.container.innerHTML).toBe("");
    first.unmount();
    Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    const second = render(<ConsentNotice config={CONFIG} />);
    expect(second.container.innerHTML).toBe("");
  });

  it.each(["/admin/orders/BB-1A2B-3C4D", "/admin", "/studio/desk"])("renders nothing on %s (staff pages and the editors' Studio)", (pathname) => {
    nav.pathname = pathname;
    const { container } = render(<ConsentNotice config={CONFIG} />);
    expect(container.innerHTML).toBe("");
  });

  it("asks a visitor who has not answered, in a region named by its heading, with two equal answers and the privacy page", () => {
    render(<ConsentNotice config={CONFIG} />);
    const region = notice()!;
    expect(region).toBeTruthy();
    expect(region.tagName).toBe("SECTION");
    expect(region.hasAttribute("data-consent-notice")).toBe(true);
    expect(region.className).toBe("consent-notice");
    const heading = within(region).getByRole("heading", { level: 2, name: TITLE });
    expect(heading.id).toBe("consent-notice-title");
    expect(region.getAttribute("aria-labelledby")).toBe("consent-notice-title");
    expect(within(region).getByText(UI_COPY.consentNotice.body).className).toBe("consent-notice__text");
    const yes = within(region).getByRole("button", { name: "Yes, count my visit" });
    const no = within(region).getByRole("button", { name: "No, do not count me" });
    // No pre-selected or louder answer (ruling R148): both buttons look the same.
    expect(yes.className).toBe("btn btn-paper");
    expect(no.className).toBe(yes.className);
    expect(yes.getAttribute("type")).toBe("button");
    expect(no.getAttribute("type")).toBe("button");
    const privacy = within(region).getByRole("link", { name: "Privacy page" });
    expect(privacy.getAttribute("href")).toBe("/privacy");
    expect(privacy.className).toBe("consent-notice__link");
    // A second live region on the page breaks the signup form's status locators.
    expect(region.querySelector("[role='status'], [aria-live]")).toBeNull();
    // Non-modal: it takes no focus and leaves the page usable.
    expect(document.activeElement).toBe(document.body);
    expect(region.getAttribute("aria-modal")).toBeNull();
  });

  it("\"Yes\" keeps the answer on this device, starts the statistics and goes away", async () => {
    render(<ConsentNotice config={CONFIG} />);
    expect(sdk.calls.init).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Yes, count my visit" }));
    await settle();
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("on");
    expect(sdk.calls.init).toEqual([[CONFIG.key, expect.objectContaining({ cookieless_mode: "always" })]]);
    expect(notice()).toBeNull();
  });

  it("\"No\" keeps the answer on this device, loads nothing and goes away", async () => {
    render(<ConsentNotice config={CONFIG} />);
    fireEvent.click(screen.getByRole("button", { name: "No, do not count me" }));
    await settle();
    expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("off");
    expect(sdk.calls.init).toHaveLength(0);
    expect(notice()).toBeNull();
  });

  describe("where focus goes after an answer (ruling R153): never lost to the page body", () => {
    /** The page's skip link and its target, as LandingPage, SiteFrame and AdminFrame render them. */
    const page = (main = `<main id="main-content"></main>`) => {
      document.body.insertAdjacentHTML("afterbegin", `<a href="#main-content" class="skip-link">Skip to content</a>${main}`);
    };

    it.each(["Yes, count my visit", "No, do not count me"])("after \"%s\", focuses the skip link when its target cannot take focus", async (answer) => {
      page();
      render(<ConsentNotice config={CONFIG} />);
      const button = screen.getByRole("button", { name: answer });
      button.focus();
      fireEvent.click(button);
      await settle();
      expect(notice()).toBeNull();
      expect(document.activeElement).toBe(document.querySelector("a.skip-link"));
    });

    it.each(["Yes, count my visit", "No, do not count me"])("after \"%s\", focuses the skip link's target when it can take focus", async (answer) => {
      page(`<main id="main-content" tabindex="-1"></main>`);
      render(<ConsentNotice config={CONFIG} />);
      const button = screen.getByRole("button", { name: answer });
      button.focus();
      fireEvent.click(button);
      await settle();
      expect(notice()).toBeNull();
      expect(document.activeElement).toBe(document.getElementById("main-content"));
    });

    it("leaves focus to the browser on a page without a skip link", async () => {
      render(<ConsentNotice config={CONFIG} />);
      fireEvent.click(screen.getByRole("button", { name: "No, do not count me" }));
      await settle();
      expect(notice()).toBeNull();
      expect(window.localStorage.getItem(ANALYTICS_PREFERENCE_KEY)).toBe("off");
    });
  });

  it("goes away at once when the visitor answers in another tab", async () => {
    render(<ConsentNotice config={CONFIG} />);
    expect(notice()).toBeTruthy();
    await act(async () => {
      window.localStorage.setItem(ANALYTICS_PREFERENCE_KEY, "off");
      window.dispatchEvent(new StorageEvent("storage", { key: ANALYTICS_PREFERENCE_KEY, newValue: "off", storageArea: window.localStorage }));
    });
    expect(notice()).toBeNull();
  });

  it("goes away when the visitor answers in the footer's Analytics choices", async () => {
    const { resumeAnalytics } = await import("@/lib/analytics/client");
    render(<ConsentNotice config={CONFIG} />);
    await act(async () => {
      await resumeAnalytics(CONFIG);
    });
    expect(notice()).toBeNull();
  });

  it("goes away when the visitor navigates to a staff page", () => {
    const { rerender } = render(<ConsentNotice config={CONFIG} />);
    expect(notice()).toBeTruthy();
    nav.pathname = "/admin/login";
    rerender(<ConsentNotice config={CONFIG} />);
    expect(notice()).toBeNull();
  });

  it("reserves room under the page while it is shown, so the end of every page can scroll clear of it, and gives it back once answered", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 312.4 } as DOMRect);
    const root = document.documentElement;
    render(<ConsentNotice config={CONFIG} />);
    await settle();
    expect(root.style.getPropertyValue("--consent-notice-space")).toBe("313px");
    fireEvent.click(screen.getByRole("button", { name: "No, do not count me" }));
    await settle();
    expect(root.style.getPropertyValue("--consent-notice-space")).toBe("");
  });

  it("still asks when storage is blocked, and the answer lasts for this page", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    render(<ConsentNotice config={CONFIG} />);
    expect(notice()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "No, do not count me" }));
    await settle();
    expect(notice()).toBeNull();
    expect(sdk.calls.init).toHaveLength(0);
  });
});

describe("server render and hydration", () => {
  it("renders nothing on the server: the answer lives in the browser", () => {
    const html = renderToString(<ConsentNotice config={CONFIG} />);
    expect(html).toBe("");
  });

  it("hydrates the server's empty output without a mismatch, then asks", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<ConsentNotice config={CONFIG} />);
    document.body.appendChild(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <ConsentNotice config={CONFIG} />, { onRecoverableError: (error) => recoverable.push(error) });
    });
    expect(recoverable).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(within(container).getByRole("region", { name: TITLE })).toBeTruthy();
    act(() => root!.unmount());
    container.remove();
  });
});
