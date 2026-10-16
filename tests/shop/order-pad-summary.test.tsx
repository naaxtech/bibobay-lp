import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ORDER_PAD_ANNOUNCE } from "@/components/shop/order-pad-copy";
import { OrderPadProvider } from "@/components/shop/OrderPadProvider";
import { OrderPadSummary } from "@/components/shop/OrderPadSummary";
import { ORDER_PAD_MAX_QUANTITY, ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";

/*
 * Final fix wave C-I2 (spec section 13): removing a row must not drop focus to the page body. Focus
 * goes to the next row's remove button, else the previous row's, else the pad heading; one polite
 * status line says what was removed and when a quantity is capped or refused.
 */
const LISTED = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
];

function mount(ids: string[]) {
  window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: ids.map((productId) => ({ productId, quantity: 2 })) }));
  render(
    <OrderPadProvider>
      <OrderPadSummary listed={LISTED} />
    </OrderPadProvider>,
  );
}

const removeButton = (name: string) => screen.getByRole("button", { name: `Remove: ${name}` });
const heading = () => screen.getByRole("heading", { name: "Your order" });
const status = () => screen.getByRole("status");
const click = (element: HTMLElement) =>
  act(async () => {
    element.focus();
    fireEvent.click(element);
  });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("focus after a removal", () => {
  it("goes to the next row's remove button when a middle row is removed", async () => {
    mount(["a", "b", "c"]);
    await click(removeButton("Bravo"));
    expect(screen.queryByRole("button", { name: "Remove: Bravo" })).toBeNull();
    expect(document.activeElement).toBe(removeButton("Charlie"));
  });

  it("goes to the previous row's remove button when the last row is removed", async () => {
    mount(["a", "b", "c"]);
    await click(removeButton("Charlie"));
    expect(document.activeElement).toBe(removeButton("Bravo"));
  });

  it("goes to the pad heading when the only row is removed, and the heading is focusable but not a tab stop", async () => {
    mount(["b"]);
    await click(removeButton("Bravo"));
    expect(screen.getByText("Nothing on your order yet.")).toBeTruthy();
    expect(document.activeElement).toBe(heading());
    expect(heading().getAttribute("tabindex")).toBe("-1");
  });
});

describe("the status line", () => {
  it("is one polite, atomic status region, empty until something happens", async () => {
    mount(["a", "b"]);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("");
  });

  it("says which product was removed, also when the empty state replaces the list", async () => {
    mount(["a", "b"]);
    await click(removeButton("Alpha"));
    expect(status().textContent).toBe("Alpha removed");
    await click(removeButton("Bravo"));
    expect(status().textContent).toBe("Bravo removed");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("announces a quantity held down to the most one order can hold", async () => {
    mount(["a"]);
    const input = screen.getByLabelText(/Quantity: Alpha/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: String(ORDER_PAD_MAX_QUANTITY + 50) } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(input.value).toBe(String(ORDER_PAD_MAX_QUANTITY));
    expect(status().textContent).toBe(ORDER_PAD_ANNOUNCE.capped("Alpha", ORDER_PAD_MAX_QUANTITY));
  });

  it("announces a quantity that was refused, and says what it stays at", async () => {
    mount(["a"]);
    const input = screen.getByLabelText(/Quantity: Alpha/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(input.value).toBe("2");
    expect(status().textContent).toBe(ORDER_PAD_ANNOUNCE.refused("Alpha", 2, ORDER_PAD_MAX_QUANTITY));
  });

  it("stays quiet for an ordinary quantity change", async () => {
    mount(["a"]);
    const input = screen.getByLabelText(/Quantity: Alpha/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(status().textContent).toBe("");
  });
});
