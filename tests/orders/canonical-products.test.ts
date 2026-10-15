import { evaluate, parse } from "groq-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ORDER_PRODUCTS_QUERY } from "@/lib/sanity/queries";

vi.mock("server-only", () => ({}));
const sanity = vi.hoisted(() => ({ fetch: vi.fn(), configured: true }));
vi.mock("@/lib/sanity/client", () => ({ getSanityClient: () => (sanity.configured ? { fetch: sanity.fetch } : null) }));

import { resolveCanonicalOrderLines, type CanonicalProductLoader } from "@/lib/orders/catalogue";
import { getOrderableProducts } from "@/lib/sanity/fetch";

/*
 * Spec §10 step 5: the server reloads every submitted product id from the CMS and snapshots the
 * canonical name, SKU, variant and pack. Nothing the browser says about a product is trusted, and
 * an id that is unknown, a draft, sold out or not listed rejects the order as a whole, without
 * saying which id.
 */

const TULA = { id: "product-tula-plush", name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", status: "listed" };
const BOB = { id: "product-bob-book", name: "Bob's counting book", status: "listed" };

/** A loader that answers from a fixed set of CMS documents, recording what it was asked for. */
function loaderFor(documents: unknown[] | null) {
  const calls: Array<readonly string[]> = [];
  const load: CanonicalProductLoader = async (ids) => {
    calls.push(ids);
    return documents;
  };
  return { load, calls };
}

describe("resolveCanonicalOrderLines", () => {
  it("snapshots the CMS name, SKU, variant and pack, with the submitted quantities, in the submitted order", async () => {
    const { load, calls } = loaderFor([BOB, TULA]);
    const result = await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 2 }, { productId: BOB.id, quantity: 1 }], load);
    expect(result).toEqual({
      ok: true,
      lines: [
        { productId: TULA.id, name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", quantity: 2 },
        { productId: BOB.id, name: "Bob's counting book", sku: null, variant: null, pack: null, quantity: 1 },
      ],
    });
    expect(calls).toEqual([[TULA.id, BOB.id]]);
  });

  it("takes every name from the CMS, so a line can never carry the browser's wording", async () => {
    const { load } = loaderFor([{ ...TULA, name: "  Tula plush (CMS)  " }]);
    const result = await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1, name: "FREE Tula" } as never], load);
    expect(result.ok && result.lines[0]?.name).toBe("Tula plush (CMS)");
  });

  it("snapshots a missing or blank SKU, variant or pack as null (R80)", async () => {
    const { load } = loaderFor([{ ...TULA, sku: "  ", variant: undefined, pack: 7 }]);
    const result = await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }], load);
    expect(result.ok && result.lines[0]).toMatchObject({ sku: null, variant: null, pack: null });
  });

  it("never carries a price, even if a CMS document still holds one", async () => {
    const { load } = loaderFor([{ ...TULA, price: 49, currency: "AUD" }]);
    const result = await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }], load);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/price|currency|49|AUD/);
  });

  it("rejects the whole order when one id is unknown, without naming it", async () => {
    const { load } = loaderFor([TULA]);
    const result = await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }, { productId: "product-made-up", quantity: 1 }], load);
    expect(result).toEqual({ ok: false, reason: "unavailable_products" });
  });

  it.each([["sold out", "sold-out"], ["a draft", "draft"], ["missing a status", undefined]])("rejects a product that is %s even if the CMS returns it", async (_case, status) => {
    const { load } = loaderFor([TULA, { ...BOB, status }]);
    const result = await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }, { productId: BOB.id, quantity: 1 }], load);
    expect(result).toEqual({ ok: false, reason: "unavailable_products" });
  });

  it("does not let a document for another id stand in for a requested one", async () => {
    const { load } = loaderFor([{ ...TULA, id: "drafts.product-tula-plush" }, { ...TULA, id: "product-other" }]);
    const result = await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }], load);
    expect(result).toEqual({ ok: false, reason: "unavailable_products" });
  });

  it.each([
    ["a blank name", { name: "  " }],
    ["a name too long to store", { name: "n".repeat(201) }],
    ["a SKU too long to store", { sku: "S".repeat(65) }],
    ["a variant too long to store", { variant: "v".repeat(121) }],
    ["a pack too long to store", { pack: "p".repeat(121) }],
    ["a control character in the name", { name: "Tula\u0000plush" }],
  ])("refuses a listed product with %s rather than store a cut or broken snapshot", async (_case, change) => {
    const { load } = loaderFor([{ ...TULA, ...change }]);
    expect(await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }], load)).toEqual({ ok: false, reason: "invalid_product" });
  });

  it("reports the catalogue unavailable when the CMS cannot be read", async () => {
    expect(await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }], loaderFor(null).load)).toEqual({ ok: false, reason: "catalogue_unavailable" });
    const failing: CanonicalProductLoader = async () => {
      throw new Error("network down");
    };
    expect(await resolveCanonicalOrderLines([{ productId: TULA.id, quantity: 1 }], failing)).toEqual({ ok: false, reason: "catalogue_unavailable" });
  });
});

describe("ORDER_PRODUCTS_QUERY", () => {
  const dataset = [
    { _id: "product-tula-plush", _type: "product", name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", status: "listed", price: 49 },
    { _id: "drafts.product-tula-plush", _type: "product", name: "Tula plush (draft edit)", status: "listed" },
    { _id: "product-sold-out", _type: "product", name: "Sold out", status: "sold-out" },
    { _id: "product-draft-status", _type: "product", name: "Not yet", status: "draft" },
    { _id: "product-not-asked", _type: "product", name: "Not asked", status: "listed" },
    { _id: "category-plush", _type: "productCategory", name: "Plush", status: "listed" },
  ];
  const run = async (ids: string[]) => (await evaluate(parse(ORDER_PRODUCTS_QUERY), { dataset, params: { ids } })).get();

  it("returns only published, listed products among the ids asked for", async () => {
    const result = await run(["product-tula-plush", "drafts.product-tula-plush", "product-sold-out", "product-draft-status", "category-plush", "product-unknown"]);
    expect(result).toEqual([{ id: "product-tula-plush", name: "Tula plush", sku: "BB-TULA-01", variant: "Large", pack: "Single", status: "listed" }]);
  });

  it("projects named fields only: no spread, no price", () => {
    expect(ORDER_PRODUCTS_QUERY).not.toMatch(/\.\.\./);
    expect(ORDER_PRODUCTS_QUERY).not.toMatch(/\b(price|currency)\b/i);
  });
});

describe("getOrderableProducts", () => {
  beforeEach(() => {
    sanity.fetch.mockReset();
    sanity.configured = true;
  });

  it("reads the published catalogue fresh, bypassing every cache, for exactly the ids asked", async () => {
    sanity.fetch.mockResolvedValue([TULA]);
    expect(await getOrderableProducts([TULA.id])).toEqual([TULA]);
    expect(sanity.fetch).toHaveBeenCalledWith(ORDER_PRODUCTS_QUERY, { ids: [TULA.id] }, expect.objectContaining({ cache: "no-store", perspective: "published" }));
  });

  it("answers null when the CMS is not configured, unreachable or answers something else", async () => {
    sanity.configured = false;
    expect(await getOrderableProducts([TULA.id])).toBeNull();
    sanity.configured = true;
    sanity.fetch.mockRejectedValue(new Error("offline"));
    expect(await getOrderableProducts([TULA.id])).toBeNull();
    sanity.fetch.mockResolvedValue({ not: "a list" });
    expect(await getOrderableProducts([TULA.id])).toBeNull();
  });
});
