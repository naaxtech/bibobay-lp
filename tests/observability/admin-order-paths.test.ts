import { describe, expect, it } from "vitest";

import { maskAdminOrderPaths } from "@/lib/observability/admin-paths";
import { scrubBreadcrumb, scrubEvent } from "@/lib/observability/sentry-config";

/*
 * 8c-M1: staff pages and staff API routes carry an order reference (BB-xxxx-xxxx) in the path.
 * Error reports carry /admin/orders/[reference] and /api/admin/orders/[reference]/... instead, in
 * request URLs, transaction names, breadcrumbs (including the browser's fetch breadcrumbs) and any
 * other string the scrubber cleans.
 */
const REF = "BB-1A2B-3C4D";

describe("maskAdminOrderPaths", () => {
  it.each([
    [`/admin/orders/${REF}`, "/admin/orders/[reference]"],
    [`https://bibo.example/admin/orders/${REF}`, "https://bibo.example/admin/orders/[reference]"],
    [`/api/admin/orders/${REF}/quote`, "/api/admin/orders/[reference]/quote"],
    [`https://bibo.example/api/admin/orders/${REF}/mark-sent`, "https://bibo.example/api/admin/orders/[reference]/mark-sent"],
    [`GET /admin/orders/${REF}`, "GET /admin/orders/[reference]"],
    [`opened "/admin/orders/${REF}" twice`, 'opened "/admin/orders/[reference]" twice'],
    [`next=%2Fadmin%2Forders%2F${REF}`, "next=%2Fadmin%2Forders%2F[reference]"],
  ])("masks %s", (input, expected) => {
    expect(maskAdminOrderPaths(input)).toBe(expected);
  });

  it.each([
    "/admin/orders",
    "/admin/orders/",
    "/api/admin/orders",
    "/admin/login",
    "/admin/orders/[reference]",
    "/api/admin/orders/[reference]/quote",
    `/shop/admin/orders/${REF}`,
    `/api/orders/track`,
  ])("leaves %s alone", (input) => {
    expect(maskAdminOrderPaths(input)).toBe(input);
  });
});

describe("error reports carry no order reference from the staff paths (8c-M1)", () => {
  it("masks the request URL, transaction, breadcrumbs, tags and contexts", () => {
    const scrubbed = scrubEvent({
      message: `Could not load /admin/orders/${REF}`,
      transaction: `GET /admin/orders/${REF}`,
      request: { url: `https://bibo.example/admin/orders/${REF}?tab=quote`, method: "GET", headers: { "user-agent": "fixture", referer: `https://bibo.example/admin/orders/${REF}` } },
      tags: { url: `https://bibo.example/api/admin/orders/${REF}/quote` },
      contexts: { nextjs: { request_path: `/admin/orders/${REF}` } },
      breadcrumbs: [
        { category: "navigation", data: { from: "/admin/orders", to: `/admin/orders/${REF}` } },
        { category: "fetch", type: "http", data: { url: `/api/admin/orders/${REF}/mark-sent`, method: "POST" } },
        { category: "console", message: `saving /api/admin/orders/${REF}/quote` },
      ],
    });
    expect(JSON.stringify(scrubbed)).not.toContain(REF);
    expect(scrubbed.request).toEqual({ url: "https://bibo.example/admin/orders/[reference]", method: "GET", headers: { "user-agent": "fixture" } });
    expect(scrubbed.transaction).toBe("GET /admin/orders/[reference]");
    expect(scrubbed.tags?.url).toBe("https://bibo.example/api/admin/orders/[reference]/quote");
    expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({ from: "/admin/orders", to: "/admin/orders/[reference]" });
    expect(scrubbed.breadcrumbs?.[1]?.data?.url).toBe("/api/admin/orders/[reference]/mark-sent");
    expect(scrubbed.breadcrumbs?.[2]?.message).toBe("saving /api/admin/orders/[reference]/quote");
  });

  it("masks a breadcrumb on its own, and an exception message", () => {
    expect(scrubBreadcrumb({ category: "xhr", data: { url: `https://bibo.example/api/admin/orders/${REF}/quote` } }).data?.url).toBe("https://bibo.example/api/admin/orders/[reference]/quote");
    const scrubbed = scrubEvent({ exception: { values: [{ type: "Error", value: `failed for /admin/orders/${REF}` }] } });
    expect(scrubbed.exception?.values?.[0]?.value).toBe("failed for /admin/orders/[reference]");
  });
});
