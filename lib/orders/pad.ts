import { ORDER_PAD_MAX_LINES, ORDER_PAD_MAX_QUANTITY, ORDER_PAD_STORAGE_KEY } from "./constants";

/**
 * The visitor's order pad (Task 6, spec §10 step 3), kept in local storage as
 * `{"lines":[{"productId","quantity"}]}` under `orderpad.v1`. It holds product ids and quantities
 * only: names, prices and every other detail come from the CMS on the server when the order is
 * submitted, never from the pad. Reading is forgiving (bad data is dropped, never thrown);
 * every change returns new lines and leaves the old ones untouched.
 */
export interface OrderPadLine {
  /** The product's Sanity document id (published; never a draft). */
  productId: string;
  /** Whole number from 1 to ORDER_PAD_MAX_QUANTITY. */
  quantity: number;
}

/** A published Sanity document id: no `drafts.` prefix, no path characters. */
const PRODUCT_ID = /^(?!drafts\.)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const isProductId = (value: unknown): value is string => typeof value === "string" && PRODUCT_ID.test(value);
const isQuantity = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;
const capped = (quantity: number) => Math.min(quantity, ORDER_PAD_MAX_QUANTITY);

/** Merges repeated products (capping the total), caps each quantity and the number of lines. */
function normalise(candidates: Iterable<OrderPadLine>): OrderPadLine[] {
  const lines: OrderPadLine[] = [];
  for (const { productId, quantity } of candidates) {
    const existing = lines.find((line) => line.productId === productId);
    if (existing) existing.quantity = capped(existing.quantity + quantity);
    else if (lines.length < ORDER_PAD_MAX_LINES) lines.push({ productId, quantity: capped(quantity) });
  }
  return lines;
}

/** The stored pad; anything missing, unreadable or malformed reads as empty or is dropped. */
export function readOrderPad(storage: Pick<Storage, "getItem"> | null): OrderPadLine[] {
  let raw: string | null;
  try {
    raw = storage?.getItem(ORDER_PAD_STORAGE_KEY) ?? null;
  } catch {
    return [];
  }
  return parseOrderPad(raw);
}

/** The pad from its stored text (see readOrderPad). */
export function parseOrderPad(raw: string | null): OrderPadLine[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const stored = (parsed as { lines?: unknown }).lines;
  if (!Array.isArray(stored)) return [];
  const valid = stored.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const { productId, quantity } = item as Record<string, unknown>;
    return isProductId(productId) && isQuantity(quantity) ? [{ productId, quantity }] : [];
  });
  return normalise(valid);
}

/** The pad as it is stored. */
export function serialiseOrderPad(lines: readonly OrderPadLine[]): string {
  return JSON.stringify({ lines: lines.map(({ productId, quantity }) => ({ productId, quantity })) });
}

export function writeOrderPad(storage: Pick<Storage, "setItem">, lines: readonly OrderPadLine[]): void {
  try {
    storage.setItem(ORDER_PAD_STORAGE_KEY, serialiseOrderPad(lines));
  } catch {
    // Storage full or blocked: the pad lasts for this page only.
  }
}

export function clearOrderPad(storage: Pick<Storage, "removeItem">): void {
  try {
    storage.removeItem(ORDER_PAD_STORAGE_KEY);
  } catch {
    // Blocked storage held nothing to clear.
  }
}

export function isOrderPadFull(lines: readonly OrderPadLine[]): boolean {
  return lines.length >= ORDER_PAD_MAX_LINES;
}

/**
 * Adds `quantity` of a product, merging into its line if it is already there. Returns the same
 * array when nothing changes: an invalid id or quantity, or a new product on a full pad.
 */
export function addOrderPadLine(lines: OrderPadLine[], productId: string, quantity = 1): OrderPadLine[] {
  if (!isProductId(productId) || !isQuantity(quantity)) return lines;
  const index = lines.findIndex((line) => line.productId === productId);
  if (index === -1) return isOrderPadFull(lines) ? lines : [...lines, { productId, quantity: capped(quantity) }];
  return lines.map((line, at) => (at === index ? { productId, quantity: capped(line.quantity + quantity) } : line));
}

/** Sets a product's quantity (capped); zero or less removes the line. Unknown products and fractions change nothing. */
export function updateOrderPadQuantity(lines: OrderPadLine[], productId: string, quantity: number): OrderPadLine[] {
  if (!Number.isInteger(quantity) || !lines.some((line) => line.productId === productId)) return lines;
  if (quantity <= 0) return lines.filter((line) => line.productId !== productId);
  return lines.map((line) => (line.productId === productId ? { productId, quantity: capped(quantity) } : line));
}

/** Only the lines whose product the catalogue still lists: a pad may hold products since retired. */
export function keepListedLines(lines: readonly OrderPadLine[], listed: ReadonlySet<string>): OrderPadLine[] {
  return lines.filter((line) => listed.has(line.productId));
}
