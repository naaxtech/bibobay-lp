import { describe, expect, it } from "vitest";

import { ORDER_STATUSES, canTransitionOrder, nextOrderStatuses, type OrderStatus } from "@/lib/orders/constants";

/**
 * Task 6, spec §10 step 10: staff move an order forward one step at a time,
 * new → confirmed → paid → dispatched → closed, and may cancel it before it is closed. Nothing
 * moves backwards, skips a step, or leaves a terminal state.
 */
describe("order status transitions", () => {
  it("names the statuses in order, with cancelled last", () => {
    expect(ORDER_STATUSES).toEqual(["new", "confirmed", "paid", "dispatched", "closed", "cancelled"]);
  });

  it.each([
    ["new", ["confirmed", "cancelled"]],
    ["confirmed", ["paid", "cancelled"]],
    ["paid", ["dispatched", "cancelled"]],
    ["dispatched", ["closed", "cancelled"]],
    ["closed", []],
    ["cancelled", []],
  ] as Array<[OrderStatus, OrderStatus[]]>)("from %s allows only %j", (from, allowed) => {
    expect(nextOrderStatuses(from)).toEqual(allowed);
    for (const to of ORDER_STATUSES) expect(canTransitionOrder(from, to), `${from} -> ${to}`).toBe(allowed.includes(to));
  });

  it("never allows staying put, going back or skipping a step", () => {
    expect(canTransitionOrder("paid", "paid")).toBe(false);
    expect(canTransitionOrder("paid", "confirmed")).toBe(false);
    expect(canTransitionOrder("new", "paid")).toBe(false);
    expect(canTransitionOrder("confirmed", "closed")).toBe(false);
  });

  it("rejects statuses it does not know", () => {
    expect(canTransitionOrder("new" as OrderStatus, "refunded" as OrderStatus)).toBe(false);
    expect(canTransitionOrder("shipped" as OrderStatus, "closed")).toBe(false);
    expect(nextOrderStatuses("shipped" as OrderStatus)).toEqual([]);
  });
});
