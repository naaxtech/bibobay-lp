import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UI_COPY } from "@/components/landing/ui-copy";
import { AddToOrder } from "@/components/shop/AddToOrder";
import { SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { ORDER_PAD_STORAGE_KEY } from "@/lib/orders/constants";

vi.mock("server-only", () => ({}));

const { draft } = vi.hoisted(() => ({ draft: { isEnabled: false } }));
vi.mock("next/headers", () => ({ draftMode: async () => draft }));

const { getGateSettings } = vi.hoisted(() => ({ getGateSettings: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getGateSettings }));

import { OrderPadMount } from "@/components/shop/OrderPadMount";

/**
 * Task 6 carry (review Minor 10), spec §10 "Server gating": the app/(commerce) layout mounts the order pad
 * from the server, and only while commerce is on. Off, no pad exists on any page: the controls
 * render nothing and the device is never read.
 */
const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

beforeEach(() => {
  window.localStorage.clear();
  draft.isEnabled = false;
  getGateSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
});

afterEach(() => {
  cleanup();
});

describe("OrderPadMount (the commerce layout)", () => {
  it("mounts no order pad while commerce is off: no control, nothing read from the device", async () => {
    window.localStorage.setItem(ORDER_PAD_STORAGE_KEY, JSON.stringify({ lines: [{ productId: "plush-tula", quantity: 2 }] }));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    render(await OrderPadMount({ children: <AddToOrder productId="plush-tula" productName="Tula plush" /> }));
    await settle();
    expect(screen.queryByRole("button")).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("mounts the order pad while commerce is on, so the shop's controls work", async () => {
    getGateSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true });
    render(await OrderPadMount({ children: <AddToOrder productId="plush-tula" productName="Tula plush" /> }));
    await settle();
    expect(screen.getByRole("button", { name: `${UI_COPY.orderPad.add}: Tula plush` })).toBeTruthy();
  });

  it("accepts only a literal true, like the commerce gate", async () => {
    getGateSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: "true" as unknown as boolean });
    render(await OrderPadMount({ children: <AddToOrder productId="plush-tula" productName="Tula plush" /> }));
    await settle();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads the settings an editor previews while draft mode is on", async () => {
    draft.isEnabled = true;
    await OrderPadMount({ children: null });
    expect(getGateSettings).toHaveBeenCalledWith({ preview: true });
  });

  it("wraps the commerce pages only, so no other page downloads the order pad's code", () => {
    const root = readFileSync(resolve("app/layout.tsx"), "utf8");
    expect(root).not.toMatch(/OrderPadMount|OrderPadProvider/);
    const layout = readFileSync(resolve("app/(commerce)/layout.tsx"), "utf8");
    expect(layout).toMatch(/<OrderPadMount>\{children\}<\/OrderPadMount>/);
  });
});
