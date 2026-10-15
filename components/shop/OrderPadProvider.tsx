"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";
import { addOrderPadLine, isOrderPadFull, keepListedLines, parseOrderPad, serialiseOrderPad, updateOrderPadQuantity, type OrderPadLine } from "@/lib/orders/pad";

/**
 * The order pad's state (Task 6, spec §10). Mounted only while commerce is enabled: with
 * `commerceEnabled` false it renders its children and nothing else, so no control finds a pad and
 * nothing is read from or written to the device. The pad is an external store over local storage:
 * the server render and hydration see an empty pad, changes in another tab arrive through the
 * `storage` event, and a browser that blocks storage keeps the pad for the page.
 */
export type AddOutcome = "added" | "full";

interface OrderPadState {
  lines: OrderPadLine[];
  add(productId: string, quantity?: number): AddOutcome;
  setQuantity(productId: string, quantity: number): void;
  /** Drops lines for products the catalogue no longer lists. */
  keepListed(listed: ReadonlySet<string>): void;
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
/** The pad for this page when the browser blocks storage. */
let pageCopy: string | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function storedText(): string | null {
  try {
    return window.localStorage.getItem(ORDER_PAD_STORAGE_KEY) ?? pageCopy;
  } catch {
    return pageCopy;
  }
}

function store(lines: readonly OrderPadLine[]): void {
  pageCopy = serialiseOrderPad(lines);
  try {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, pageCopy);
  } catch {
    // Storage full or blocked: the page copy keeps the pad until the page closes.
  }
  for (const listener of listeners) listener();
}

function EnabledOrderPad({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, storedText, () => null);
  const lines = useMemo(() => parseOrderPad(raw), [raw]);

  const add = useCallback(
    (productId: string, quantity = 1): AddOutcome => {
      const next = addOrderPadLine(lines, productId, quantity);
      if (next === lines && isOrderPadFull(lines)) return "full";
      if (next !== lines) store(next);
      return "added";
    },
    [lines],
  );
  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      const next = updateOrderPadQuantity(lines, productId, quantity);
      if (next !== lines) store(next);
    },
    [lines],
  );
  const keepListed = useCallback(
    (listed: ReadonlySet<string>) => {
      const kept = keepListedLines(lines, listed);
      if (kept.length !== lines.length) store(kept);
    },
    [lines],
  );

  const value = useMemo<OrderPadState>(() => ({ lines, add, setQuantity, keepListed }), [lines, add, setQuantity, keepListed]);
  return <OrderPadContext.Provider value={value}>{children}</OrderPadContext.Provider>;
}

/** Forgets the page copy (tests start each case with an empty pad). */
export function resetOrderPadForTests(): void {
  pageCopy = null;
}
