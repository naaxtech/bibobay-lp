/**
 * Order constants (Task 6, spec §10). The order pad's storage contract and the one-way order
 * status flow that staff follow: new → confirmed → paid → dispatched → closed, with cancellation
 * allowed until the order is closed. The database migration (Task 7) and the admin (Task 8) use
 * these same names.
 */

/** Local storage key for the visitor's order pad. Bump the version to discard old pads. */
export const ORDER_PAD_STORAGE_KEY = "orderpad.v1";
/** Most products one order can hold. */
export const ORDER_PAD_MAX_LINES = 40;
/** Most of one product one order can hold. */
export const ORDER_PAD_MAX_QUANTITY = 999;

export const ORDER_STATUSES = ["new", "confirmed", "paid", "dispatched", "closed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const FORWARD: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["paid", "cancelled"],
  paid: ["dispatched", "cancelled"],
  dispatched: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
};

/** The statuses staff may move an order to next (none from a terminal state or an unknown one). */
export function nextOrderStatuses(from: OrderStatus): OrderStatus[] {
  return Object.hasOwn(FORWARD, from) ? [...FORWARD[from]] : [];
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return nextOrderStatuses(from).includes(to);
}
