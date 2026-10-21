import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Footer } from "@/components/landing/Footer";
import { LandingPage } from "@/components/landing/LandingPage";
import { SiteFrame } from "@/components/legal/SiteFrame";
import { landingContent, siteSettings } from "../landing/fixtures";

vi.mock("server-only", () => ({}));

/** Fixture values only; the hash secret is exactly the 32-character minimum. */
const OPEN_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture-value",
  LEAD_IP_HASH_SECRET: "x".repeat(32),
  RESEND_API_KEY: "re_fixture",
  RESEND_FROM: "BIBO Bay <hello@example.com>",
  STAFF_NOTIFICATION_EMAIL: "staff@example.com",
};

const withLabel = siteSettings((s) => { s.footer.contactPageLabel = "Write to us"; });
const footerNav = () => within(screen.getByRole("navigation", { name: "Footer" }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the footer's contact link (R190)", () => {
  it("shows the CMS Contact us link to /contact only when contactOpen", () => {
    render(<Footer settings={withLabel} contactOpen />);
    expect(footerNav().getByRole("link", { name: "Write to us" }).getAttribute("href")).toBe("/contact");
    cleanup();
    render(<Footer settings={withLabel} />);
    expect(screen.queryByRole("link", { name: "Write to us" })).toBeNull();
    cleanup();
    render(<Footer settings={withLabel} contactOpen={false} />);
    expect(screen.queryByRole("link", { name: "Write to us" })).toBeNull();
  });

  it("sits before the legal links", () => {
    render(<Footer settings={withLabel} contactOpen />);
    const labels = footerNav().getAllByRole("link").map((link) => link.textContent);
    expect(labels.indexOf("Write to us")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Write to us")).toBeLessThan(labels.indexOf("Privacy"));
  });

  it("falls back to Contact us", () => {
    render(<Footer settings={siteSettings()} contactOpen />);
    expect(footerNav().getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe("/contact");
  });

  it("the mailto stays as it is", () => {
    const settings = siteSettings((s) => { s.contactEmail = "hello@example.com"; });
    for (const contactOpen of [true, false]) {
      render(<Footer settings={settings} contactOpen={contactOpen} />);
      expect(screen.getByRole("link", { name: "hello@example.com" }).getAttribute("href")).toBe("mailto:hello@example.com");
      expect(screen.getByText(settings.footer.contactLabel)).toBeTruthy();
      cleanup();
    }
  });

  it("an editor's own /contact link is not doubled", () => {
    const settings = siteSettings((s) => { s.footer.legalLinks = [{ label: "Get in touch", href: "/contact" }, ...s.footer.legalLinks]; });
    render(<Footer settings={settings} contactOpen />);
    const links = footerNav().getAllByRole("link").filter((link) => link.getAttribute("href") === "/contact");
    expect(links.map((link) => link.textContent)).toEqual(["Get in touch"]);
  });

  it("LandingPage forwards contactOpen", () => {
    render(<LandingPage content={landingContent()} settings={withLabel} contactOpen />);
    expect(footerNav().getByRole("link", { name: "Write to us" }).getAttribute("href")).toBe("/contact");
    cleanup();
    render(<LandingPage content={landingContent()} settings={withLabel} />);
    expect(screen.queryByRole("link", { name: "Write to us" })).toBeNull();
  });

  it("SiteFrame shows the link when the environment opens the form, and not otherwise", () => {
    for (const [name, value] of Object.entries(OPEN_ENV)) vi.stubEnv(name, value);
    render(
      <SiteFrame settings={withLabel} preview={false} mainClassName="simple-page">
        <p>page</p>
      </SiteFrame>,
    );
    expect(footerNav().getByRole("link", { name: "Write to us" }).getAttribute("href")).toBe("/contact");
    cleanup();
    vi.stubEnv("STAFF_NOTIFICATION_EMAIL", "");
    render(
      <SiteFrame settings={withLabel} preview={false} mainClassName="simple-page">
        <p>page</p>
      </SiteFrame>,
    );
    expect(screen.queryByRole("link", { name: "Write to us" })).toBeNull();
  });
});
