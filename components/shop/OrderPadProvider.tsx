"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";
import { addOrderPadLine, isOrderPadFull, isOrderPadProductId, keepListedLines, parseOrderPad, serialiseOrderPad, updateOrderPadQuantity, type OrderPadLine } from "@/lib/orders/pad";

/**
 * The order pad's state (Task 6, spec §10). Mounted only while commerce is enabled: with
 * `commerceEnabled` false it renders its children and nothing else, so no control finds a pad and
 * nothing is read from or written to the device.
 *
 * The pad is an external store over local storage. The server render and hydration see "not read
 * yet" (`lines` is null), so nothing claims an empty pad before the device has been read. Another
 * tab's changes arrive through the `storage` event. Every change reads the current pad first, so
 * two quick changes never lose one. When the browser blocks storage, or refuses a write (full), the
 * page keeps its own copy, which wins until a write succeeds again or another tab writes the pad.
 */
export type AddOutcome = "added" | "full" | "at-most" | "invalid";

interface OrderPadState {
  /** Null until the device's pad has been read. */
  lines: OrderPadLine[] | null;
  /** `saved` is false when only this page holds the change (the browser refused to store it). */
  add(productId: string, quantity?: number): { outcome: AddOutcome; quantity: number; saved: boolean };
  setQuantity(productId: string, quantity: number): void;
  /**
   * Drops lines for products the catalogue no longer lists. Pass the whole catalogue only; an
   * empty one is ignored, since it means the catalogue failed to load.
   */
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
  const onStorage = (event: StorageEvent) => {
    // Another tab wrote the pad (or cleared storage): the device is current again (re-review N1).
    if (event.key === ORDER_PAD_STORAGE_KEY || event.key === null) {
      deviceBehind = false;
      pageCopy = null;
    }
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
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

/** Saves the pad; false when only this page could keep it. */
function store(lines: readonly OrderPadLine[]): boolean {
  const text = serialiseOrderPad(lines);
  let saved = true;
  try {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, text);
    deviceBehind = false;
    pageCopy = null;
  } catch {
    // Blocked or full: this page keeps the newer pad until a write succeeds.
    deviceBehind = true;
    pageCopy = text;
    saved = false;
  }
  notify();
  return saved;
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
    if (!isOrderPadProductId(productId) || !Number.isInteger(quantity) || quantity < 1) return { outcome: "invalid", quantity: 0, saved: false };
    const lines = currentLines();
    const next = addOrderPadLine(lines, productId, quantity);
    const existing = lines.find((line) => line.productId === productId);
    if (next === lines) {
      if (existing) return { outcome: "at-most", quantity: existing.quantity, saved: true };
      return { outcome: isOrderPadFull(lines) ? "full" : "invalid", quantity: 0, saved: true };
    }
    const added = next.find((line) => line.productId === productId)!;
    if (existing && added.quantity === existing.quantity) return { outcome: "at-most", quantity: added.quantity, saved: true };
    return { outcome: "added", quantity: added.quantity, saved: store(next) };
  },
  setQuantity(productId, quantity) {
    const lines = currentLines();
    const next = updateOrderPadQuantity(lines, productId, quantity);
    if (next !== lines) store(next);
  },
  keepListed(listed) {
    if (listed.size === 0) return;
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
