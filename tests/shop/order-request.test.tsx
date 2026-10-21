import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrderRequest } from "@/components/shop/OrderRequest";
import { OrderPadProvider } from "@/components/shop/OrderPadProvider";
import { ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }));

/*
 * Final fix wave C-I2 (re-review): OrderPadSummary's only mount is OrderRequest, which swaps in the
 * empty state when the pad empties. Removing the last product must still leave focus on the pad
 * heading and announce "<product> removed", so the heading and status line stay mounted.
 */
const PRODUCTS = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
];

function mount(ids: string[]) {
  window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: ids.map((productId) => ({ productId, quantity: 1 })) }));
  render(
    <OrderPadProvider>
      <OrderRequest products={PRODUCTS} consentCopy="I agree." countries={[]} trackingEnabled={false} botCheckSiteKey={null} />
    </OrderPadProvider>,
  );
}

const click = (element: HTMLElement) =>
  act(async () => {
    element.focus();
    fireEvent.click(element);
  });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("OrderRequest after the last product is removed", () => {
  it("keeps the pad heading as the focus target and announces the removal", async () => {
    mount(["b"]);
    await click(await screen.findByRole("button", { name: "Remove: Bravo" }));
    const heading = screen.getByRole("heading", { name: "Your order" });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole("status").textContent).toContain("Bravo removed");
  });

  it("offers the way back to the shop and no order form", async () => {
    mount(["b"]);
    await click(await screen.findByRole("button", { name: "Remove: Bravo" }));
    expect(screen.getByText(/Your order is empty/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /shop/i })).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });
});
