import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_COPY } from "@/components/forms/order-copy";
import { UI_COPY } from "@/components/landing/ui-copy";
import { OrderPadProvider } from "@/components/shop/OrderPadProvider";
import { SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { LegalSettings, Product, SiteSettings } from "@/lib/content/types";
import { ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";

vi.mock("server-only", () => ({}));

const { draft } = vi.hoisted(() => ({ draft: { isEnabled: false } }));
vi.mock("next/headers", () => ({ draftMode: async () => draft }));

const { getSiteSettings, getListedProducts, getLegalSettings } = vi.hoisted(() => ({ getSiteSettings: vi.fn(), getListedProducts: vi.fn(), getLegalSettings: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings, getListedProducts, getLegalSettings }));

import OrderPage, { generateMetadata } from "@/app/(commerce)/order/page";

/*
 * Task 7c, spec §10: the order page. Commerce off (the default), a 404 before anything is read.
 * On: the order pad with names from the server's catalogue, how paying works, and the order form;
 * after a stored order, the reference and (with tracking on) the private link and the way to /track.
 */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const PRICE = /[$€£¥₹]|\b(?:USD|EUR|GBP|AUD|NZD|CAD)\b|\d+[.,]\d{2}\b/;
const REFERENCE = "BB-1A2B-3C4D";
const TOKEN = "0123456789abcdef".repeat(4);

const ON: SiteSettings = { ...structuredClone(SAFE_FALLBACK_SETTINGS), commerceEnabled: true };
const TRACKING: SiteSettings = { ...ON, trackingEnabled: true };
const LEGAL: LegalSettings = { ...SAFE_FALLBACK_LEGAL, orderConsentCopy: "I am an adult and agree to the order terms.", orderConsentCopyVersion: "order-3" };

const product = (id: string, name: string): Product => ({ id, name, slug: id.replace("product-", ""), description: "", details: [], images: [], status: "listed", order: 0 });
const tula = product("product-tula", "Tula plush");
const bob = product("product-bob", "Bob plush");

const withPad = (node: ReactNode) => render(<OrderPadProvider>{node}</OrderPadProvider>);
const setPad = (lines: Array<{ productId: string; quantity: number }>) => window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines }));
const storedIds = () => (JSON.parse(window.localStorage.getItem(ORDER_PAD_STORAGE_KEY) ?? "null") as { lines: Array<{ productId: string }> } | null)?.lines.map((line) => line.productId) ?? null;
const settle = () => act(async () => {
  await Promise.resolve();
});

let answer: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  window.localStorage.clear();
  draft.isEnabled = false;
  getSiteSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
  getListedProducts.mockReset().mockResolvedValue([tula, bob]);
  getLegalSettings.mockReset().mockResolvedValue(LEGAL);
  answer = { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: REFERENCE, trackingToken: TOKEN } };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } })));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function sendValidOrder() {
  fireEvent.change(screen.getByLabelText(ORDER_COPY.form.contactName.label), { target: { value: "Sam Rivers" } });
  fireEvent.change(screen.getByLabelText(ORDER_COPY.form.email.label), { target: { value: "parent@example.com" } });
  fireEvent.change(screen.getByLabelText(ORDER_COPY.form.addressLine1.label), { target: { value: "12 Harbour Road" } });
  fireEvent.change(screen.getByLabelText(ORDER_COPY.form.city.label), { target: { value: "Seaside" } });
  fireEvent.change(screen.getByLabelText(ORDER_COPY.form.country.label), { target: { value: "AU" } });
  fireEvent.click(screen.getByRole("checkbox", { name: LEGAL.orderConsentCopy }));
  await act(async () => {
    fireEvent.submit(screen.getByRole("form", { name: ORDER_COPY.form.label }));
  });
}

describe("/order while commerce is off (the default)", () => {
  it("answers 404 before reading the catalogue or the legal settings", async () => {
    await expect(OrderPage()).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata()).rejects.toMatchObject(NOT_FOUND);
    expect(getListedProducts).not.toHaveBeenCalled();
    expect(getLegalSettings).not.toHaveBeenCalled();
  });

  it("accepts only a literal true", async () => {
    getSiteSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: "yes" as unknown as boolean });
    await expect(OrderPage()).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("/order while commerce is on", () => {
  beforeEach(() => {
    getSiteSettings.mockResolvedValue(ON);
  });

  it("is kept out of search results", async () => {
    const metadata = await generateMetadata();
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(String(metadata.title)).toContain(ORDER_COPY.page.title);
  });

  it("says plainly that nothing is charged and how the quote and payment link arrive, with no price anywhere", async () => {
    setPad([{ productId: "product-tula", quantity: 2 }]);
    withPad(await OrderPage());
    await settle();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ORDER_COPY.page.title);
    const main = screen.getByRole("main");
    for (const sentence of ORDER_COPY.page.payment) expect(main.textContent).toContain(sentence);
    expect(main.textContent).not.toMatch(PRICE);
  });

  it("names the pad's products from the server's catalogue and drops those it no longer lists", async () => {
    setPad([{ productId: "product-tula", quantity: 2 }, { productId: "product-gone", quantity: 1 }]);
    withPad(await OrderPage());
    await settle();
    const pad = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    expect(within(pad).getAllByRole("listitem").map((item) => item.querySelector(".order-pad__name")?.textContent)).toEqual(["Tula plush"]);
    expect(storedIds()).toEqual(["product-tula"]);
    // The page itself is the review: no link back to it.
    expect(within(screen.getByRole("main")).queryAllByRole("link").filter((link) => link.getAttribute("href") === "/order")).toEqual([]);
    expect(screen.getByRole("form", { name: ORDER_COPY.form.label })).toBeTruthy();
  });

  it("keeps the pad when the catalogue could not be read, and offers no form", async () => {
    getListedProducts.mockResolvedValue([]);
    setPad([{ productId: "product-tula", quantity: 2 }]);
    withPad(await OrderPage());
    await settle();
    expect(storedIds()).toEqual(["product-tula"]);
    expect(screen.queryByRole("form", { name: ORDER_COPY.form.label })).toBeNull();
    expect(screen.getByText(UI_COPY.shop.empty)).toBeTruthy();
  });

  it("shows an honest empty state, with the way back to the shop, when the pad is empty", async () => {
    withPad(await OrderPage());
    await settle();
    expect(screen.getByText(ORDER_COPY.page.empty)).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: ORDER_COPY.page.backToShop }).getAttribute("href")).toBe("/shop");
    expect(screen.queryByRole("form", { name: ORDER_COPY.form.label })).toBeNull();
  });

  it("shows the CMS order consent sentence (R82)", async () => {
    setPad([{ productId: "product-tula", quantity: 2 }]);
    withPad(await OrderPage());
    await settle();
    expect(screen.getByRole("checkbox", { name: LEGAL.orderConsentCopy })).toBeTruthy();
  });

  it("shows the repository sentence when the CMS order version cannot be stored, as the order then records its version (R82)", async () => {
    getLegalSettings.mockResolvedValue({ ...LEGAL, orderConsentCopyVersion: "version three" });
    setPad([{ productId: "product-tula", quantity: 2 }]);
    withPad(await OrderPage());
    await settle();
    expect(screen.getByRole("checkbox", { name: SAFE_FALLBACK_LEGAL.orderConsentCopy })).toBeTruthy();
  });

  it("offers the CMS countries, or every country when it lists none (R85)", async () => {
    setPad([{ productId: "product-tula", quantity: 2 }]);
    getSiteSettings.mockResolvedValue({ ...ON, orderCountries: ["PH", "AU"] });
    withPad(await OrderPage());
    await settle();
    const select = screen.getByLabelText(ORDER_COPY.form.country.label) as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "AU", "PH"]);
    cleanup();
    getSiteSettings.mockResolvedValue(ON);
    withPad(await OrderPage());
    await settle();
    expect((screen.getByLabelText(ORDER_COPY.form.country.label) as HTMLSelectElement).options).toHaveLength(250);
  });
});

describe("after the order is stored", () => {
  beforeEach(() => {
    setPad([{ productId: "product-tula", quantity: 2 }]);
  });

  it("shows the reference, the private link with its note and the way to /track, with the pad empty", async () => {
    getSiteSettings.mockResolvedValue(TRACKING);
    withPad(await OrderPage());
    await settle();
    await sendValidOrder();
    const heading = screen.getByRole("heading", { name: ORDER_COPY.received.title });
    expect(document.activeElement).toBe(heading);
    const main = screen.getByRole("main");
    expect(main.textContent).toContain(ORDER_COPY.outcome.received);
    expect(main.textContent).toContain(REFERENCE);
    expect(screen.getByRole("link", { name: ORDER_COPY.received.privateLink }).getAttribute("href")).toBe(`/orders/${TOKEN}`);
    expect(main.textContent).toContain(ORDER_COPY.received.privateNote);
    expect(main.textContent).toContain(ORDER_COPY.received.trackNote);
    expect(screen.getByRole("link", { name: ORDER_COPY.received.trackLink }).getAttribute("href")).toBe("/track");
    expect(window.localStorage.getItem(ORDER_PAD_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("form", { name: ORDER_COPY.form.label })).toBeNull();
    expect(screen.queryByText(ORDER_COPY.page.empty)).toBeNull();
  });

  it("answers a repeated request as already received, with the reference and no private link (R81)", async () => {
    getSiteSettings.mockResolvedValue(TRACKING);
    answer = { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: false, duplicate: true, message: ORDER_COPY.outcome.alreadyReceived, reference: REFERENCE } };
    withPad(await OrderPage());
    await settle();
    await sendValidOrder();
    const main = screen.getByRole("main");
    expect(main.textContent).toContain(ORDER_COPY.outcome.alreadyReceived);
    expect(main.textContent).toContain(REFERENCE);
    expect(screen.queryByRole("link", { name: ORDER_COPY.received.privateLink })).toBeNull();
    expect(screen.getByRole("link", { name: ORDER_COPY.received.trackLink }).getAttribute("href")).toBe("/track");
  });

  it("mentions no tracking page, and links no private page, while tracking is off", async () => {
    getSiteSettings.mockResolvedValue(ON);
    // The server leaves the token out while tracking is off; the page would not link one anyway.
    answer = { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: true, message: ORDER_COPY.outcome.received, reference: REFERENCE, trackingToken: TOKEN } };
    withPad(await OrderPage());
    await settle();
    await sendValidOrder();
    const main = screen.getByRole("main");
    expect(main.textContent).toContain(REFERENCE);
    expect(main.textContent).not.toContain(ORDER_COPY.received.trackNote);
    expect(screen.queryByRole("link", { name: ORDER_COPY.received.trackLink })).toBeNull();
    expect(screen.queryByRole("link", { name: ORDER_COPY.received.privateLink })).toBeNull();
  });

  it("says a repeat was already received without pointing at a tracking page that is off", async () => {
    getSiteSettings.mockResolvedValue(ON);
    answer = { status: 200, body: { ok: true, persisted: true, acknowledgementQueued: false, duplicate: true, message: ORDER_COPY.outcome.alreadyReceivedUntracked, reference: REFERENCE } };
    withPad(await OrderPage());
    await settle();
    await sendValidOrder();
    expect(screen.getByRole("main").textContent).toContain(ORDER_COPY.outcome.alreadyReceivedUntracked);
  });
});
