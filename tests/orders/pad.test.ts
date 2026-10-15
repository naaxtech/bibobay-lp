import { describe, expect, it } from "vitest";

import { ORDER_PAD_MAX_LINES, ORDER_PAD_MAX_QUANTITY, ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";
import {
  addOrderPadLine,
  clearOrderPad,
  isOrderPadFull,
  keepListedLines,
  readOrderPad,
  updateOrderPadQuantity,
  writeOrderPad,
  type OrderPadLine,
} from "@/lib/orders/pad";

/**
 * Task 6, spec §10 step 3: the order pad lives in local storage under `orderpad.v1`. It holds only
 * product ids and quantities (names and prices come from the CMS on the server, never from the
 * pad); duplicates merge, malformed data is discarded, and the limits hold (40 lines, 999 each).
 */
class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const stored = (value: unknown) => {
  const storage = new MemoryStorage();
  storage.setItem(ORDER_PAD_STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  return storage;
};

const line = (productId: string, quantity = 1): OrderPadLine => ({ productId, quantity });

describe("the storage contract", () => {
  it("uses the orderpad.v1 key with 40 lines of at most 999 each", () => {
    expect(ORDER_PAD_STORAGE_KEY).toBe("orderpad.v1");
    expect(ORDER_PAD_MAX_LINES).toBe(40);
    expect(ORDER_PAD_MAX_QUANTITY).toBe(999);
  });

  it("round-trips through storage", () => {
    const storage = new MemoryStorage();
    writeOrderPad(storage, [line("product-a", 2), line("product-b")]);
    expect(JSON.parse(storage.getItem(ORDER_PAD_STORAGE_KEY)!)).toEqual({ lines: [line("product-a", 2), line("product-b")] });
    expect(readOrderPad(storage)).toEqual([line("product-a", 2), line("product-b")]);
  });

  it("clears the pad", () => {
    const storage = stored({ lines: [line("product-a")] });
    clearOrderPad(storage);
    expect(storage.getItem(ORDER_PAD_STORAGE_KEY)).toBeNull();
    expect(readOrderPad(storage)).toEqual([]);
  });
});

describe("reading a corrupted or tampered pad", () => {
  it.each([
    ["no storage", null],
    ["nothing stored", new MemoryStorage()],
    ["invalid JSON", stored("{lines:")],
    ["a bare array", stored([line("product-a")])],
    ["lines that are not a list", stored({ lines: "product-a" })],
    ["null", stored("null")],
  ])("discards %s", (_case, storage) => {
    expect(readOrderPad(storage)).toEqual([]);
  });

  it("survives storage that throws (blocked by the browser)", () => {
    const blocked = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    expect(readOrderPad(blocked)).toEqual([]);
  });

  it("drops malformed lines and keeps the good ones", () => {
    const storage = stored({
      lines: [
        line("product-a", 2),
        { productId: "", quantity: 1 },
        { productId: "drafts.product-b", quantity: 1 },
        { productId: "../etc/passwd", quantity: 1 },
        { productId: "product-c", quantity: 0 },
        { productId: "product-d", quantity: -3 },
        { productId: "product-e", quantity: 1.5 },
        { productId: "product-f", quantity: "2" },
        { productId: "product-g" },
        { productId: 42, quantity: 1 },
        null,
        "product-h",
        { productId: "product-i", quantity: 3, name: "Free plush", price: 0 },
      ],
    });
    expect(readOrderPad(storage)).toEqual([line("product-a", 2), line("product-i", 3)]);
  });

  it("keeps only the id and quantity: names and prices a visitor edits in are never read", () => {
    const [first] = readOrderPad(stored({ lines: [{ productId: "product-a", quantity: 1, name: "Anything", price: 0 }] }));
    expect(Object.keys(first!)).toEqual(["productId", "quantity"]);
  });

  it("merges duplicate lines, capping the total at 999", () => {
    expect(readOrderPad(stored({ lines: [line("product-a", 600), line("product-b"), line("product-a", 600)] }))).toEqual([line("product-a", 999), line("product-b")]);
  });

  it("caps an oversized quantity and an overlong list", () => {
    const lines = Array.from({ length: 55 }, (_, index) => line(`product-${index}`, index === 0 ? 5000 : 1));
    const read = readOrderPad(stored({ lines }));
    expect(read).toHaveLength(40);
    expect(read[0]).toEqual(line("product-0", 999));
    expect(read.at(-1)).toEqual(line("product-39"));
  });
});

describe("changing the pad", () => {
  it("adds a new product and merges a repeated one", () => {
    let lines = addOrderPadLine([], "product-a");
    lines = addOrderPadLine(lines, "product-b", 2);
    lines = addOrderPadLine(lines, "product-a", 3);
    expect(lines).toEqual([line("product-a", 4), line("product-b", 2)]);
  });

  it("never changes the lines it was given", () => {
    const before = [line("product-a")];
    addOrderPadLine(before, "product-a");
    updateOrderPadQuantity(before, "product-a", 5);
    expect(before).toEqual([line("product-a")]);
  });

  it("caps a merged quantity at 999", () => {
    expect(addOrderPadLine([line("product-a", 990)], "product-a", 50)).toEqual([line("product-a", 999)]);
  });

  it("refuses a 41st product but still merges into an existing line", () => {
    const full = Array.from({ length: 40 }, (_, index) => line(`product-${index}`));
    expect(isOrderPadFull(full)).toBe(true);
    expect(addOrderPadLine(full, "product-new")).toBe(full);
    expect(addOrderPadLine(full, "product-3")[3]).toEqual(line("product-3", 2));
    expect(isOrderPadFull(full.slice(1))).toBe(false);
  });

  it.each([
    ["an empty id", "", 1],
    ["a draft id", "drafts.product-a", 1],
    ["zero", "product-a", 0],
    ["a fraction", "product-a", 0.5],
    ["a negative quantity", "product-a", -1],
  ])("ignores %s", (_case, productId, quantity) => {
    const before = [line("product-z")];
    expect(addOrderPadLine(before, productId, quantity)).toBe(before);
  });

  it("sets a quantity, caps it, and removes the line at zero", () => {
    const lines = [line("product-a"), line("product-b")];
    expect(updateOrderPadQuantity(lines, "product-a", 7)).toEqual([line("product-a", 7), line("product-b")]);
    expect(updateOrderPadQuantity(lines, "product-a", 12_000)).toEqual([line("product-a", 999), line("product-b")]);
    expect(updateOrderPadQuantity(lines, "product-a", 0)).toEqual([line("product-b")]);
    expect(updateOrderPadQuantity(lines, "product-missing", 3)).toBe(lines);
    expect(updateOrderPadQuantity(lines, "product-a", 2.5)).toBe(lines);
  });
});

describe("stale and unlisted products", () => {
  it("keeps only lines for products the catalogue still lists", () => {
    const lines = [line("product-a", 2), line("product-gone"), line("product-b")];
    expect(keepListedLines(lines, new Set(["product-a", "product-b"]))).toEqual([line("product-a", 2), line("product-b")]);
    expect(keepListedLines(lines, new Set())).toEqual([]);
  });
});
