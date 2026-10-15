import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UI_COPY } from "@/components/landing/ui-copy";
import { AddToOrder } from "@/components/shop/AddToOrder";
import { OrderPadProvider, resetOrderPadForTests } from "@/components/shop/OrderPadProvider";
import { OrderPadSummary } from "@/components/shop/OrderPadSummary";
import { ORDER_PAD_MAX_LINES, ORDER_PAD_MAX_QUANTITY, ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";
import { useOrderPad } from "@/components/shop/OrderPadProvider";

/** A stand-in for the order page's "submitted" step (Task 7), which empties the pad. */
function ClearButton() {
  const pad = useOrderPad();
  return pad ? (
    <button type="button" onClick={() => pad.clear()}>
      Clear
    </button>
  ) : null;
}

/**
 * Task 6: the order pad's provider and controls. Spec §10 "Server gating": while commerce is
 * disabled the provider is not mounted and nothing is read from or written to the device; the
 * controls render nothing without a provider.
 */
const LISTED = [
  { id: "plush-tula", name: "Tula plush" },
  { id: "book-bubbles", name: "Bubble breathing book" },
];

const settle = () => act(async () => {
  await Promise.resolve();
});

const storedLines = () => JSON.parse(window.localStorage.getItem(ORDER_PAD_STORAGE_KEY) ?? "null") as { lines: Array<{ productId: string; quantity: number }> } | null;

beforeEach(() => {
  window.localStorage.clear();
  resetOrderPadForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("while commerce is disabled", () => {
  it("mounts no order pad: nothing is read or written, and the controls render nothing", async () => {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "plush-tula", quantity: 2 }] }));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(
      <OrderPadProvider commerceEnabled={false}>
        <p>Shop closed</p>
        <AddToOrder productId="plush-tula" productName="Tula plush" />
        <OrderPadSummary listed={LISTED} />
      </OrderPadProvider>,
    );
    await settle();
    expect(screen.getByText("Shop closed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("region", { name: UI_COPY.orderPad.title })).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("renders no controls outside a provider either", () => {
    render(<AddToOrder productId="plush-tula" productName="Tula plush" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("while commerce is enabled", () => {
  const shop = () =>
    render(
      <OrderPadProvider commerceEnabled>
        <AddToOrder productId="plush-tula" productName="Tula plush" />
        <AddToOrder productId="book-bubbles" productName="Bubble breathing book" />
        <OrderPadSummary listed={LISTED} />
        <ClearButton />
      </OrderPadProvider>,
    );
  const statuses = () => screen.getAllByRole("status").map((element) => element.textContent);

  it("adds a product, says so politely each time, and keeps the pad on this device", async () => {
    shop();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    expect(storedLines()).toEqual({ lines: [{ productId: "plush-tula", quantity: 1 }] });
    expect(statuses()).toContain(UI_COPY.orderPad.added(1));
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    expect(storedLines()).toEqual({ lines: [{ productId: "plush-tula", quantity: 2 }] });
    // Review minor 9: a second add changes the words, so screen readers announce it again.
    expect(statuses()).toContain(UI_COPY.orderPad.added(2));
  });

  it("never says added when nothing was added: a product already at the most one order holds", async () => {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "plush-tula", quantity: ORDER_PAD_MAX_QUANTITY }] }));
    shop();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    expect(statuses()).toContain(UI_COPY.orderPad.atMost(ORDER_PAD_MAX_QUANTITY));
    expect(statuses().some((text) => text?.startsWith("Added"))).toBe(false);
  });

  it("empties the pad on clear, on screen and on the device, and keeps it empty after the next add (review I1)", async () => {
    shop();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(window.localStorage.getItem(ORDER_PAD_STORAGE_KEY)).toBeNull();
    const summary = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    expect(within(summary).getByText(UI_COPY.orderPad.empty)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Bubble breathing book` }));
    expect(storedLines()).toEqual({ lines: [{ productId: "book-bubbles", quantity: 1 }] });
  });

  it("follows another tab that emptied the pad (review I1)", async () => {
    shop();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    window.localStorage.removeItem(ORDER_PAD_STORAGE_KEY);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: ORDER_PAD_STORAGE_KEY }));
    });
    expect(within(screen.getByRole("region", { name: UI_COPY.orderPad.title })).getByText(UI_COPY.orderPad.empty)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Bubble breathing book` }));
    expect(storedLines()).toEqual({ lines: [{ productId: "book-bubbles", quantity: 1 }] });
  });

  it("keeps this page's newer pad when the device is full and an older pad is stored (review I1)", async () => {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "plush-tula", quantity: 1 }] }));
    shop();
    await settle();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Bubble breathing book` }));
    const summary = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    expect(within(summary).getByText("Bubble breathing book")).toBeTruthy();
    expect(within(summary).getByText("Tula plush")).toBeTruthy();
  });

  it("does not lose an add made twice before the page re-renders (review minor 5)", async () => {
    const pads: Array<ReturnType<typeof useOrderPad>> = [];
    function Grab() {
      const pad = useOrderPad();
      useEffect(() => {
        pads.push(pad);
      });
      return null;
    }
    render(
      <OrderPadProvider commerceEnabled>
        <Grab />
      </OrderPadProvider>,
    );
    await settle();
    const pad = pads.at(-1)!;
    act(() => {
      pad.add("plush-tula");
      pad.add("book-bubbles");
    });
    expect(storedLines()).toEqual({ lines: [{ productId: "plush-tula", quantity: 1 }, { productId: "book-bubbles", quantity: 1 }] });
  });

  it("shows nothing until the device's pad has been read, never a false empty pad (review minor 4)", async () => {
    const { renderToString } = await import("react-dom/server");
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "plush-tula", quantity: 3 }] }));
    const html = renderToString(
      <OrderPadProvider commerceEnabled>
        <OrderPadSummary listed={LISTED} />
      </OrderPadProvider>,
    );
    expect(html).not.toContain(UI_COPY.orderPad.empty);
  });

  it("restores the pad from the device, showing only products the catalogue still lists", async () => {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "plush-tula", quantity: 3 }, { productId: "retired-mug", quantity: 1 }] }));
    shop();
    await settle();
    const summary = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    expect(within(summary).getByText("Tula plush")).toBeTruthy();
    expect(within(summary).queryByText(/retired/i)).toBeNull();
    expect((within(summary).getByRole("spinbutton", { name: `${UI_COPY.orderPad.quantity}: Tula plush` }) as HTMLInputElement).value).toBe("3");
    // Review minor 2: the summary may be given part of the catalogue, so it hides, never deletes.
    expect(storedLines()).toEqual({ lines: [{ productId: "plush-tula", quantity: 3 }, { productId: "retired-mug", quantity: 1 }] });
  });

  it("changes a quantity within 1 to 999 and removes a line", async () => {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "plush-tula", quantity: 1 }, { productId: "book-bubbles", quantity: 1 }] }));
    shop();
    await settle();
    const summary = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    const quantity = within(summary).getByRole("spinbutton", { name: `${UI_COPY.orderPad.quantity}: Tula plush` }) as HTMLInputElement;
    expect(quantity.min).toBe("1");
    expect(quantity.max).toBe("999");
    fireEvent.change(quantity, { target: { value: "5000" } });
    fireEvent.blur(quantity);
    expect(storedLines()?.lines[0]).toEqual({ productId: "plush-tula", quantity: 999 });
    // Review minor 3: the field can be emptied while typing a new number.
    fireEvent.change(quantity, { target: { value: "" } });
    expect(quantity.value).toBe("");
    fireEvent.change(quantity, { target: { value: "7" } });
    fireEvent.blur(quantity);
    expect(storedLines()?.lines[0]).toEqual({ productId: "plush-tula", quantity: 7 });
    // An empty or invalid entry left behind goes back to the saved number.
    fireEvent.change(quantity, { target: { value: "" } });
    fireEvent.blur(quantity);
    expect(quantity.value).toBe("7");
    fireEvent.click(within(summary).getByRole("button", { name: `${UI_COPY.orderPad.remove}: Bubble breathing book` }));
    expect(storedLines()).toEqual({ lines: [{ productId: "plush-tula", quantity: 7 }] });
    expect(within(summary).getByRole("link", { name: UI_COPY.orderPad.review }).getAttribute("href")).toBe("/order");
  });

  it("shows an empty pad without a link to review it", async () => {
    shop();
    await settle();
    const summary = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    expect(within(summary).getByText(UI_COPY.orderPad.empty)).toBeTruthy();
    expect(within(summary).queryByRole("link")).toBeNull();
  });

  it("says when the pad is full instead of adding a 41st product", async () => {
    const full = Array.from({ length: 40 }, (_, index) => ({ productId: `product-${index}`, quantity: 1 }));
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: full }));
    render(
      <OrderPadProvider commerceEnabled>
        <AddToOrder productId="plush-tula" productName="Tula plush" />
      </OrderPadProvider>,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    expect(storedLines()?.lines).toHaveLength(40);
    expect(screen.getAllByRole("status").some((element) => element.textContent === UI_COPY.orderPad.full(ORDER_PAD_MAX_LINES))).toBe(true);
    // Review minor 6: the words carry the real limit.
    expect(UI_COPY.orderPad.full(ORDER_PAD_MAX_LINES)).toContain(String(ORDER_PAD_MAX_LINES));
  });

  it("picks up a change made in another tab", async () => {
    shop();
    await settle();
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "book-bubbles", quantity: 4 }] }));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: ORDER_PAD_STORAGE_KEY }));
    });
    const summary = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    expect((within(summary).getByRole("spinbutton", { name: `${UI_COPY.orderPad.quantity}: Bubble breathing book` }) as HTMLInputElement).value).toBe("4");
  });

  it("keeps the pad for the page when the browser blocks storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    shop();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    fireEvent.click(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` }));
    const summary = screen.getByRole("region", { name: UI_COPY.orderPad.title });
    expect((within(summary).getByRole("spinbutton", { name: `${UI_COPY.orderPad.quantity}: Tula plush` }) as HTMLInputElement).value).toBe("2");
  });
});
