import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_COPY, ORDER_STATUS_COPY } from "@/components/forms/order-copy";
import { TrackOrderForm } from "@/components/forms/TrackOrderForm";
import { NOT_FOUND_COPY } from "@/components/legal/legal-copy";
import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { SiteSettings } from "@/lib/content/types";
import type { TrackedOrder, TrackingResult } from "@/lib/orders/track";

vi.mock("server-only", () => ({}));

const { draft, requestHeaders } = vi.hoisted(() => ({ draft: { isEnabled: false }, requestHeaders: new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("next/headers", () => ({ draftMode: async () => draft, headers: async () => requestHeaders }));

const { getGateSettings } = vi.hoisted(() => ({ getGateSettings: vi.fn() }));
// app/not-found.tsx (the ordinary 404) only renders content, so it reads the tag-only settings.
vi.mock("@/lib/sanity/fetch", () => ({ getGateSettings, getSiteSettings: getGateSettings }));

const { createTrackingDependencies, trackOrderByToken, DEPS } = vi.hoisted(() => ({
  createTrackingDependencies: vi.fn(),
  trackOrderByToken: vi.fn(),
  DEPS: { marker: "tracking-dependencies" },
}));
vi.mock("@/lib/orders/dependencies", () => ({ createTrackingDependencies }));
vi.mock("@/lib/orders/track", () => ({ trackOrderByToken }));

import TrackPage, { generateMetadata as trackMetadata } from "@/app/track/page";
import OrderLinkPage, { generateMetadata as orderLinkMetadata } from "@/app/orders/[token]/page";
import OrderNotFound from "@/app/orders/[token]/not-found";

/*
 * Task 7c, spec §10 step 11 and §11: the tracking page and the private order link. Both exist only
 * while commerce AND tracking are on (a literal true each); otherwise a 404 before anything else.
 * Every miss reads the same, so a lookup never says which part was wrong.
 */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const TOKEN = "0123456789abcdef".repeat(4);
const ORDER: TrackedOrder = {
  reference: "BB-1A2B-3C4D",
  status: "dispatched",
  submittedAt: "2026-10-14T09:30:00.000Z",
  statusChangedAt: "2026-10-15T16:05:00.000Z",
  lines: [{ title: "Tula plush", variant: "Blue", pack: null, quantity: 2 }],
};
const OFF: SiteSettings[] = [
  SAFE_FALLBACK_SETTINGS,
  { ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true },
  { ...SAFE_FALLBACK_SETTINGS, trackingEnabled: true },
  { ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true, trackingEnabled: "true" as unknown as boolean },
];
const ON: SiteSettings = { ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true, trackingEnabled: true };
const params = (token: string) => ({ params: Promise.resolve({ token }) });
const found: TrackingResult = { status: 200, body: { ok: true, order: ORDER } };

beforeEach(() => {
  draft.isEnabled = false;
  getGateSettings.mockReset().mockResolvedValue(ON);
  createTrackingDependencies.mockReset().mockReturnValue(DEPS);
  trackOrderByToken.mockReset().mockResolvedValue(found);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/track", () => {
  it.each(OFF.map((settings) => [JSON.stringify([settings.commerceEnabled, settings.trackingEnabled]), settings] as const))("answers 404 while tracking is off %s", async (_flags, settings) => {
    getGateSettings.mockResolvedValue(settings);
    await expect(TrackPage()).rejects.toMatchObject(NOT_FOUND);
    await expect(trackMetadata()).rejects.toMatchObject(NOT_FOUND);
  });

  it("is kept out of search results, and explains how to find an order", async () => {
    expect((await trackMetadata()).robots).toEqual({ index: false, follow: false });
    render(await TrackPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ORDER_COPY.track.title);
    expect(screen.getByRole("main").textContent).toContain(ORDER_COPY.track.intro);
    expect(screen.getByRole("form", { name: ORDER_COPY.track.formLabel })).toBeTruthy();
  });
});

describe("the tracking form", () => {
  type Answer = { status: number; body: unknown } | "network-error";
  let answers: Answer[] = [];
  const requests: Array<{ url: string; init: RequestInit }> = [];

  beforeEach(() => {
    answers = [];
    requests.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      const answer = answers.shift() ?? { status: 200, body: { ok: true, order: ORDER } };
      if (answer === "network-error") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    }));
  });

  const reference = () => screen.getByLabelText(ORDER_COPY.track.reference.label) as HTMLInputElement;
  const email = () => screen.getByLabelText(ORDER_COPY.track.email.label) as HTMLInputElement;
  const status = () => screen.getByRole("status");
  async function find(ref = " bb-1a2b-3c4d ", address = " Parent@Example.com ") {
    fireEvent.change(reference(), { target: { value: ref } });
    fireEvent.change(email(), { target: { value: address } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("form", { name: ORDER_COPY.track.formLabel }));
    });
  }

  it("labels a reference and an email field for the adult who ordered", () => {
    render(<TrackOrderForm />);
    expect(reference().required).toBe(true);
    expect(reference().getAttribute("autocomplete")).toBe("off");
    expect(email().type).toBe("email");
    expect(email().getAttribute("autocomplete")).toBe("email");
    expect(email().required).toBe(true);
  });

  it("checks both fields before asking the server, with a summary that takes focus", async () => {
    render(<TrackOrderForm />);
    await find("", "");
    expect(requests).toEqual([]);
    const summary = screen.getByRole("group", { name: ORDER_COPY.track.errorSummaryTitle });
    expect(document.activeElement).toBe(summary);
    expect(within(summary).getAllByRole("link").map((link) => link.textContent)).toEqual([ORDER_COPY.track.errors.reference.required, ORDER_COPY.track.errors.email.required]);
    await find("BB-12", "not-an-email");
    expect(requests).toEqual([]);
    expect(within(screen.getByRole("group", { name: ORDER_COPY.track.errorSummaryTitle })).getAllByRole("link").map((link) => link.textContent)).toEqual([ORDER_COPY.track.errors.reference.invalid, ORDER_COPY.track.errors.email.invalid]);
  });

  it("posts the reference in capitals and the email, then shows the order's status and moves focus to it", async () => {
    render(<TrackOrderForm />);
    await find();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/api/orders/track");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({ reference: "BB-1A2B-3C4D", email: "Parent@Example.com" });
    const heading = screen.getByRole("heading", { name: ORDER_STATUS_COPY.heading(ORDER.reference) });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(ORDER_STATUS_COPY.explanations.dispatched)).toBeTruthy();
  });

  it.each([
    [404, ORDER_COPY.tracking.notFound],
    [429, ORDER_COPY.tracking.rateLimited],
    [500, ORDER_COPY.tracking.failed],
    [503, ORDER_COPY.tracking.failed],
    [400, ORDER_COPY.tracking.failed],
    ["network-error", ORDER_COPY.tracking.failed],
  ] as const)("answers %s with one message and no order", async (code, message) => {
    answers = [code === "network-error" ? code : { status: code, body: { ok: false, message: "server words" } }];
    render(<TrackOrderForm />);
    await find();
    expect(status().textContent).toBe(message);
    expect(screen.queryByRole("heading", { name: ORDER_STATUS_COPY.heading(ORDER.reference) })).toBeNull();
    expect(reference().value).toBe(" bb-1a2b-3c4d ");
  });

  it("treats a 200 without a readable order as a failure", async () => {
    answers = [{ status: 200, body: { ok: true, order: { ...ORDER, status: "lost" } } }];
    render(<TrackOrderForm />);
    await find();
    expect(status().textContent).toBe(ORDER_COPY.tracking.failed);
  });

  it("clears an order it found once a later lookup misses", async () => {
    answers = [{ status: 200, body: { ok: true, order: ORDER } }, { status: 404, body: { ok: false } }];
    render(<TrackOrderForm />);
    await find();
    expect(screen.getByRole("heading", { name: ORDER_STATUS_COPY.heading(ORDER.reference) })).toBeTruthy();
    await find("BB-FFFF-0000");
    expect(screen.queryByRole("heading", { name: ORDER_STATUS_COPY.heading(ORDER.reference) })).toBeNull();
    expect(status().textContent).toBe(ORDER_COPY.tracking.notFound);
  });
});

describe("/orders/[token]", () => {
  it.each(OFF.map((settings) => [JSON.stringify([settings.commerceEnabled, settings.trackingEnabled]), settings] as const))("answers 404 while tracking is off %s, looking nothing up", async (_flags, settings) => {
    getGateSettings.mockResolvedValue(settings);
    await expect(OrderLinkPage(params(TOKEN))).rejects.toMatchObject(NOT_FOUND);
    await expect(orderLinkMetadata()).rejects.toMatchObject(NOT_FOUND);
    expect(createTrackingDependencies).not.toHaveBeenCalled();
    expect(trackOrderByToken).not.toHaveBeenCalled();
  });

  it("is kept out of search results and never names the token", async () => {
    const metadata = await orderLinkMetadata();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(JSON.stringify(metadata)).not.toContain(TOKEN);
  });

  it("answers a malformed token with the same 404 as a miss, without a lookup", async () => {
    for (const token of ["abc", TOKEN.toUpperCase(), `${TOKEN}0`, "BB-1A2B-3C4D"]) {
      await expect(OrderLinkPage(params(token)), token).rejects.toMatchObject(NOT_FOUND);
    }
    expect(trackOrderByToken).not.toHaveBeenCalled();
  });

  it("looks the token up with this request's headers and answers a miss with a 404", async () => {
    trackOrderByToken.mockResolvedValue({ status: 404, body: { ok: false, message: ORDER_COPY.tracking.notFound } } satisfies TrackingResult);
    await expect(OrderLinkPage(params(TOKEN))).rejects.toMatchObject(NOT_FOUND);
    expect(createTrackingDependencies).toHaveBeenCalledWith(requestHeaders, ON);
    expect(trackOrderByToken).toHaveBeenCalledWith(TOKEN, DEPS);
  });

  it("shows the order's status, and the way to look an order up, without the token anywhere", async () => {
    render(await OrderLinkPage(params(TOKEN)));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ORDER_COPY.orderLink.title);
    expect(screen.getByRole("heading", { name: ORDER_STATUS_COPY.heading(ORDER.reference) })).toBeTruthy();
    expect(screen.getByRole("link", { name: ORDER_COPY.orderLink.trackLink }).getAttribute("href")).toBe("/track");
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it.each([
    [503, ORDER_COPY.tracking.failed],
    [500, ORDER_COPY.tracking.failed],
    [429, ORDER_COPY.tracking.rateLimited],
  ] as const)("shows the failure state for a %s, not a 404", async (code, message) => {
    trackOrderByToken.mockResolvedValue({ status: code, body: { ok: false, message } } satisfies TrackingResult);
    render(await OrderLinkPage(params(TOKEN)));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ORDER_COPY.orderLink.failureTitle);
    expect(screen.getByRole("main").textContent).toContain(message);
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

describe("the private order link's not-found state", () => {
  it("says the order was not found, generically, and links /track while tracking is on", async () => {
    render(await OrderNotFound());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ORDER_COPY.orderLink.notFoundTitle);
    expect(screen.getByRole("main").textContent).toContain(ORDER_COPY.tracking.notFound);
    expect(screen.getByRole("link", { name: ORDER_COPY.orderLink.trackLink }).getAttribute("href")).toBe("/track");
  });

  it("is the site's ordinary 404 page while tracking is off, saying nothing about orders", async () => {
    getGateSettings.mockResolvedValue(SAFE_FALLBACK_SETTINGS);
    render(await OrderNotFound());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(NOT_FOUND_COPY.title);
    expect(screen.getByRole("main").textContent).not.toMatch(/order|track/i);
  });
});
