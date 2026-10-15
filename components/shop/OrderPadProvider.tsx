"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { ORDER_PAD_MAX_QUANTITY, ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";
import { addOrderPadLine, isOrderPadFull, keepListedLines, parseOrderPad, serialiseOrderPad, updateOrderPadQuantity, type OrderPadLine } from "@/lib/orders/pad";

/**
 * The order pad's state (Task 6, spec §10). Mounted only while commerce is enabled: with
 * `commerceEnabled` false it renders its children and nothing else, so no control finds a pad and
 * nothing is read from or written to the device.
 *
 * The pad is an external store over local storage. The server render and hydration see "not read
 * yet" (`lines` is null), so nothing claims an empty pad before the device has been read. Another
 * tab's changes arrive through the `storage` event. Every change reads the current pad first, so
 * two quick changes never lose one. When the browser blocks storage, or refuses a write (full), the
 * page keeps its own copy, which wins until a write succeeds again.
 */
export type AddOutcome = "added" | "full" | "at-most" | "invalid";

interface OrderPadState {
  /** Null until the device's pad has been read. */
  lines: OrderPadLine[] | null;
  add(productId: string, quantity?: number): { outcome: AddOutcome; quantity: number };
  setQuantity(productId: string, quantity: number): void;
  /** Drops lines for products the catalogue no longer lists. Pass the whole catalogue only. */
  keepListed(listed: ReadonlySet<string>): void;
  /** Empties the pad here and on the device (after an order is sent). */
  clear(): void;
}

const OrderPadContext = createContext<OrderPadState | null>(null);

/** The pad, or null while commerce is disabled (no provider is mounted). */
export function useOrderPad(): OrderPadState | null {
  return useContext(OrderPadContext);
}

export function OrderPadProvider({ commerceEnabled, children }: { commerceEnabled: boolean; children: ReactNode }) {
  if (!commerceEnabled) return <>{children}</>;
  return <EnabledOrderPad>{children}</EnabledOrderPad>;
}

const listeners = new Set<() => void>();
/** This page's pad while the device cannot hold it (storage blocked or a write refused). */
let pageCopy: string | null = null;
let deviceBehind = false;
const UNREAD = "\u0000unread";

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function storedText(): string | null {
  if (deviceBehind) return pageCopy;
  try {
    return window.localStorage.getItem(ORDER_PAD_STORAGE_KEY);
  } catch {
    deviceBehind = true;
    return pageCopy;
  }
}

function currentLines(): OrderPadLine[] {
  return parseOrderPad(storedText());
}

function store(lines: readonly OrderPadLine[]): void {
  const text = serialiseOrderPad(lines);
  try {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, text);
    deviceBehind = false;
    pageCopy = null;
  } catch {
    // Blocked or full: this page keeps the newer pad until a write succeeds.
    deviceBehind = true;
    pageCopy = text;
  }
  notify();
}

function clear(): void {
  pageCopy = null;
  deviceBehind = false;
  try {
    window.localStorage.removeItem(ORDER_PAD_STORAGE_KEY);
  } catch {
    // Blocked storage held nothing of ours.
  }
  notify();
}

const PAD_ACTIONS: Omit<OrderPadState, "lines"> = {
  add(productId, quantity = 1) {
    const lines = currentLines();
    const next = addOrderPadLine(lines, productId, quantity);
    const existing = lines.find((line) => line.productId === productId);
    if (next === lines) {
      if (existing) return { outcome: existing.quantity >= ORDER_PAD_MAX_QUANTITY ? "at-most" : "invalid", quantity: existing.quantity };
      return { outcome: isOrderPadFull(lines) ? "full" : "invalid", quantity: 0 };
    }
    const saved = next.find((line) => line.productId === productId)!;
    if (existing && saved.quantity === existing.quantity) return { outcome: "at-most", quantity: saved.quantity };
    store(next);
    return { outcome: "added", quantity: saved.quantity };
  },
  setQuantity(productId, quantity) {
    const lines = currentLines();
    const next = updateOrderPadQuantity(lines, productId, quantity);
    if (next !== lines) store(next);
  },
  keepListed(listed) {
    const lines = currentLines();
    const kept = keepListedLines(lines, listed);
    if (kept.length !== lines.length) store(kept);
  },
  clear,
};

function EnabledOrderPad({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, storedText, () => UNREAD);
  const lines = useMemo(() => (raw === UNREAD ? null : parseOrderPad(raw)), [raw]);
  const value = useMemo<OrderPadState>(() => ({ lines, ...PAD_ACTIONS }), [lines]);
  return <OrderPadContext.Provider value={value}>{children}</OrderPadContext.Provider>;
}

/** Forgets this page's copy (tests start each case with an empty pad). */
export function resetOrderPadForTests(): void {
  pageCopy = null;
  deviceBehind = false;
}
