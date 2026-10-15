import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ORDER_COPY } from "@/components/forms/order-copy";
import { Footer } from "@/components/landing/Footer";
import { LandingPage } from "@/components/landing/LandingPage";
import { landingContent, siteSettings } from "../landing/fixtures";

vi.mock("server-only", () => ({}));

/**
 * Task 7b, spec §10 "Server gating": the shop link (the CMS label `navigation.commerceLabel`) is in
 * the header and the footer only while commerce is on.
 */
const shopLinks = (container: HTMLElement) => within(container).queryAllByRole("link").filter((link) => link.getAttribute("href") === "/shop");

afterEach(() => {
  cleanup();
});

describe("footer", () => {
  it("has no shop link while commerce is off", () => {
    render(<Footer settings={siteSettings()} />);
    expect(shopLinks(screen.getByRole("contentinfo"))).toEqual([]);
  });

  it("links the shop, with the CMS label, while commerce is on", () => {
    render(<Footer settings={siteSettings((s) => { s.commerceEnabled = true; s.navigation.commerceLabel = "Bay shop"; })} />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    expect(within(nav).getByRole("link", { name: "Bay shop" }).getAttribute("href")).toBe("/shop");
  });

  it("keeps the shop link when an editor removed every legal link", () => {
    render(<Footer settings={siteSettings((s) => { s.commerceEnabled = true; s.footer.legalLinks = []; })} />);
    expect(shopLinks(screen.getByRole("contentinfo"))).toHaveLength(1);
  });

  it("accepts only a literal true", () => {
    render(<Footer settings={siteSettings((s) => { s.commerceEnabled = "true" as unknown as boolean; })} />);
    expect(shopLinks(screen.getByRole("contentinfo"))).toEqual([]);
  });
});

/** Task 7c: "Track an order" sits in the footer only while commerce and tracking are both on. */
describe("footer track link", () => {
  const trackLinks = () => within(screen.getByRole("contentinfo")).queryAllByRole("link").filter((link) => link.getAttribute("href") === "/track");

  it("is absent while tracking is off, and while commerce is off", () => {
    const { unmount } = render(<Footer settings={siteSettings((s) => { s.commerceEnabled = true; })} />);
    expect(trackLinks()).toEqual([]);
    unmount();
    render(<Footer settings={siteSettings((s) => { s.trackingEnabled = true; })} />);
    expect(trackLinks()).toEqual([]);
  });

  it("links /track by its visible words while both are on, after the shop link", () => {
    render(<Footer settings={siteSettings((s) => { s.commerceEnabled = true; s.trackingEnabled = true; s.navigation.commerceLabel = "Bay shop"; })} />);
    const nav = screen.getByRole("navigation", { name: "Footer" });
    const links = within(nav).getAllByRole("link");
    expect(within(nav).getByRole("link", { name: ORDER_COPY.track.title }).getAttribute("href")).toBe("/track");
    expect(links.findIndex((link) => link.getAttribute("href") === "/track")).toBe(links.findIndex((link) => link.getAttribute("href") === "/shop") + 1);
  });

  it("accepts only a literal true, and keeps the link when an editor removed every legal link", () => {
    const { unmount } = render(<Footer settings={siteSettings((s) => { s.commerceEnabled = true; s.trackingEnabled = "true" as unknown as boolean; })} />);
    expect(trackLinks()).toEqual([]);
    unmount();
    render(<Footer settings={siteSettings((s) => { s.commerceEnabled = true; s.trackingEnabled = true; s.footer.legalLinks = []; })} />);
    expect(trackLinks()).toHaveLength(1);
  });
});

describe("landing header", () => {
  it("names the shop link with the CMS label while commerce is on, and has none while it is off", () => {
    const { unmount } = render(<LandingPage content={landingContent()} settings={siteSettings()} />);
    expect(shopLinks(screen.getByRole("banner"))).toEqual([]);
    unmount();
    render(<LandingPage content={landingContent()} settings={siteSettings((s) => { s.commerceEnabled = true; s.navigation.commerceLabel = "Bay shop"; })} />);
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Bay shop" }).getAttribute("href")).toBe("/shop");
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "Bay shop" }).getAttribute("href")).toBe("/shop");
  });
});
