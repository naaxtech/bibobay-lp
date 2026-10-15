import { cleanup, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { ORDER_STATUS_COPY } from "@/components/forms/order-copy";
import { LocalTime, formatOrderTime } from "@/components/orders/LocalTime";
import { OrderStatusView } from "@/components/orders/OrderStatusView";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/orders/constants";
import type { TrackedOrder } from "@/lib/orders/track";

/*
 * Task 7c: the order status view shared by /track and /orders/<token>. The locked payload only
 * (spec §11): reference, status, two dates and each line's title, variant, pack and quantity.
 * Never a price, an address or an email.
 */
const ORDER: TrackedOrder = {
  reference: "BB-1A2B-3C4D",
  status: "confirmed",
  submittedAt: "2026-10-14T09:30:00.000Z",
  statusChangedAt: "2026-10-15T16:05:00.000Z",
  lines: [
    { title: "Tula plush", variant: "Blue", pack: "Gift box", quantity: 2 },
    { title: "Bubble breathing cards", variant: null, pack: null, quantity: 1 },
  ],
};
const STEPS: readonly OrderStatus[] = ["new", "confirmed", "paid", "dispatched", "closed"];
const PRICE = /[$€£¥₹]|\b(?:USD|EUR|GBP|AUD|NZD|CAD)\b|\d+[.,]\d{2}\b/;

const view = (edit: Partial<TrackedOrder> = {}) => render(<OrderStatusView order={{ ...ORDER, ...edit }} />);

afterEach(() => {
  cleanup();
});

describe("the order status view", () => {
  it("is a region headed with the order reference", () => {
    view();
    const region = screen.getByRole("region", { name: ORDER_STATUS_COPY.heading(ORDER.reference) });
    expect(within(region).getByRole("heading", { level: 2 }).textContent).toBe("Order BB-1A2B-3C4D");
  });

  it.each(ORDER_STATUSES)("names the %s status and explains it in one line", (status) => {
    view({ status });
    const current = screen.getByText(ORDER_STATUS_COPY.names[status], { selector: "strong" });
    expect(current.closest("p")?.textContent).toBe(`${ORDER_STATUS_COPY.currentLabel}: ${ORDER_STATUS_COPY.names[status]}`);
    expect(screen.getByText(ORDER_STATUS_COPY.explanations[status])).toBeTruthy();
  });

  it.each(STEPS)("shows the steps from new to closed, with %s as the current step", (status) => {
    view({ status });
    const steps = within(screen.getByRole("list", { name: ORDER_STATUS_COPY.progressLabel })).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(STEPS.map((step) => ORDER_STATUS_COPY.names[step]));
    const at = STEPS.indexOf(status);
    steps.forEach((step, index) => {
      expect(step.getAttribute("aria-current"), STEPS[index]).toBe(index === at ? "step" : null);
      expect(step.getAttribute("data-state"), STEPS[index]).toBe(index < at ? "done" : index === at ? "current" : "upcoming");
    });
  });

  it("shows a cancelled order distinctly, without the steps", () => {
    view({ status: "cancelled" });
    expect(screen.queryByRole("list", { name: ORDER_STATUS_COPY.progressLabel })).toBeNull();
    const region = screen.getByRole("region");
    expect(region.getAttribute("data-status")).toBe("cancelled");
    expect(screen.getByText(ORDER_STATUS_COPY.explanations.cancelled)).toBeTruthy();
  });

  it("lists each product with its variant, pack and quantity when it has them", () => {
    view();
    const lines = within(screen.getByRole("list", { name: ORDER_STATUS_COPY.linesTitle })).getAllByRole("listitem");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.textContent).toContain("Tula plush");
    expect(lines[0]?.textContent).toContain(`${ORDER_STATUS_COPY.variantLabel}: Blue`);
    expect(lines[0]?.textContent).toContain(`${ORDER_STATUS_COPY.packLabel}: Gift box`);
    expect(lines[0]?.textContent).toContain(ORDER_STATUS_COPY.quantity(2));
    expect(lines[1]?.textContent).not.toContain(ORDER_STATUS_COPY.variantLabel);
    expect(lines[1]?.textContent).not.toContain(ORDER_STATUS_COPY.packLabel);
    expect(lines[1]?.textContent).toContain(ORDER_STATUS_COPY.quantity(1));
  });

  it("dates the request and the last update in machine-readable <time> elements", () => {
    view();
    const times = Array.from(document.querySelectorAll("time"));
    expect(times.map((time) => time.getAttribute("datetime"))).toEqual([ORDER.submittedAt, ORDER.statusChangedAt]);
    expect(times.map((time) => time.textContent)).toEqual([formatOrderTime(new Date(ORDER.submittedAt)), formatOrderTime(new Date(ORDER.statusChangedAt))]);
    expect(screen.getByText(ORDER_STATUS_COPY.submittedLabel)).toBeTruthy();
    expect(screen.getByText(ORDER_STATUS_COPY.updatedLabel)).toBeTruthy();
  });

  it("shows no price, address or email", () => {
    view();
    const text = screen.getByRole("region").textContent ?? "";
    expect(text).not.toMatch(PRICE);
    expect(text).not.toContain("@");
  });
});

describe("status copy", () => {
  const strings = JSON.stringify(ORDER_STATUS_COPY);

  it("never shows a price, and never says an email or parcel was sent", () => {
    expect(strings).not.toMatch(/[$€£¥]|\b(price[ds]?|USD|AUD|EUR|GBP)\b|\d+\.\d{2}/i);
    expect(strings).not.toMatch(/\b(sent|inbox|we('ve| have) emailed|receipt|on its way|deliver(ed|y) (date|by))\b/i);
  });

  it("claims no payment before the payment step, and says nothing has been charged at first", () => {
    for (const status of ["new", "confirmed", "cancelled"] as const) {
      expect(ORDER_STATUS_COPY.names[status] + ORDER_STATUS_COPY.explanations[status], status).not.toMatch(/\b(paid|payment (has )?(come|received|taken)|charged you)\b/i);
    }
    expect(ORDER_STATUS_COPY.explanations.new).toMatch(/nothing has been charged/i);
  });
});

describe("order times", () => {
  it("are written in English with the time zone named", () => {
    const date = new Date("2026-10-14T09:30:00.000Z");
    const utc = formatOrderTime(date, "UTC");
    expect(utc).toContain("October 14, 2026");
    expect(utc).toContain("9:30");
    expect(utc).toContain("UTC");
    const manila = formatOrderTime(date, "Asia/Manila");
    expect(manila).toContain("5:30");
    expect(manila).toContain("GMT+8");
  });

  it("are shown in UTC in the server's HTML, so nothing waits for the browser, then in the visitor's zone", () => {
    const iso = "2026-10-14T09:30:00.000Z";
    const html = renderToString(<LocalTime iso={iso} />);
    // HTML attribute names are case-insensitive; React writes this one as dateTime.
    expect(html).toMatch(new RegExp(`datetime="${iso}"`, "i"));
    expect(html).toContain(formatOrderTime(new Date(iso), "UTC"));
    render(<LocalTime iso={iso} />);
    expect(document.querySelector("time")?.textContent).toBe(formatOrderTime(new Date(iso)));
  });

  it("render nothing for a date that is not one", () => {
    const { container } = render(<LocalTime iso="soon" />);
    expect(container.innerHTML).toBe("");
  });
});
