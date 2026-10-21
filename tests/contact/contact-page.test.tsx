import { cleanup, render, screen, within } from "@testing-library/react";
import type { Metadata } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ContactPage, { generateMetadata } from "@/app/contact/page";
import { SAFE_FALLBACK_CONTACT_PAGE, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import type { ContactPageContent } from "@/lib/content/types";
import { contactPageState } from "@/lib/contact/page-state";
import { contactMetadata, seoEnvironment } from "@/lib/seo/metadata";
import { siteSettings } from "../landing/fixtures";

vi.mock("server-only", () => ({}));

const { draft } = vi.hoisted(() => ({ draft: { isEnabled: false } }));
vi.mock("next/headers", () => ({ draftMode: async () => draft }));

const { getSiteSettings, getContactPage } = vi.hoisted(() => ({ getSiteSettings: vi.fn(), getContactPage: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings, getContactPage }));

/** Fixture values only; the hash secret is longer than the 32-character minimum. */
const OPEN_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture-value",
  LEAD_IP_HASH_SECRET: "x".repeat(32),
  RESEND_API_KEY: "re_fixture",
  RESEND_FROM: "BIBO Bay <hello@example.com>",
  STAFF_NOTIFICATION_EMAIL: "staff@example.com",
};

const COPY: ContactPageContent = {
  ...SAFE_FALLBACK_CONTACT_PAGE,
  heading: "Write to the crew",
  description: "A CMS description for grown-ups.",
  closedMessage: "A CMS closed message.",
  emailIntro: "A CMS email intro:",
};

const openForm = () => {
  for (const [name, value] of Object.entries(OPEN_ENV)) vi.stubEnv(name, value);
};

beforeEach(() => {
  draft.isEnabled = false;
  getSiteSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
  getContactPage.mockReset().mockResolvedValue(COPY);
  for (const name of Object.keys(OPEN_ENV)) vi.stubEnv(name, "");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("the /contact page", () => {
  it("open: one h1 with the CMS heading, the CMS description and the contact form", async () => {
    openForm();
    render(await ContactPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Write to the crew");
    expect(screen.getByText("A CMS description for grown-ups.")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Contact BIBO Bay" });
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe(COPY.buttonLabel);
    expect(screen.queryByText(COPY.closedMessage)).toBeNull();
  });

  it("closed with a CMS address: the CMS email intro and a mailto link, with no form and no textbox", async () => {
    getSiteSettings.mockResolvedValue(siteSettings((s) => { s.contactEmail = "hello@example.com"; }));
    render(await ContactPage());
    expect(screen.getByText("A CMS email intro:")).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "hello@example.com" }).getAttribute("href")).toBe("mailto:hello@example.com");
    expect(screen.queryByRole("form", { name: "Contact BIBO Bay" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(COPY.closedMessage)).toBeNull();
  });

  it("closed without one: only the CMS closed message", async () => {
    render(await ContactPage());
    expect(screen.getByText("A CMS closed message.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(within(screen.getByRole("main")).queryByRole("link", { name: /@/ })).toBeNull();
    expect(screen.queryByText("A CMS email intro:")).toBeNull();
    expect(screen.queryByText("A CMS description for grown-ups.")).toBeNull();
  });

  it("falls back to the repository copy when the CMS has none", async () => {
    getContactPage.mockResolvedValue(SAFE_FALLBACK_CONTACT_PAGE);
    render(await ContactPage());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Contact us");
    expect(screen.getByText(SAFE_FALLBACK_CONTACT_PAGE.closedMessage)).toBeTruthy();
  });

  it("reads the draft copy in draft mode", async () => {
    draft.isEnabled = true;
    render(await ContactPage());
    expect(getContactPage).toHaveBeenCalledWith({ preview: true });
    expect(getSiteSettings).toHaveBeenCalledWith({ preview: true });
  });
});

describe("contactPageState", () => {
  it("picks form, then email, then closed", () => {
    const withEmail = { contactEmail: "hello@example.com" };
    expect(contactPageState(true, withEmail)).toEqual({ kind: "form" });
    expect(contactPageState(true, {})).toEqual({ kind: "form" });
    expect(contactPageState(false, withEmail)).toEqual({ kind: "email", email: "hello@example.com" });
    expect(contactPageState(false, {})).toEqual({ kind: "closed" });
    expect(contactPageState(false, { contactEmail: "" })).toEqual({ kind: "closed" });
  });
});

describe("contact metadata", () => {
  const production = seoEnvironment(siteSettings((s) => { s.canonicalUrl = "https://bibobay.example/"; }), { VERCEL_ENV: "production" });
  const settings = siteSettings();
  const FORM = { kind: "form" } as const;
  const EMAIL = { kind: "email", email: "hello@example.com" } as const;
  const CLOSED = { kind: "closed" } as const;
  const robots = (metadata: Metadata) => metadata.robots;
  const canonical = (metadata: Metadata) => metadata.alternates?.canonical;

  it("is indexable in production only with a way to reach the team, with canonical /contact only then", () => {
    for (const state of [FORM, EMAIL]) {
      const metadata = contactMetadata({ copy: COPY, settings, seo: production, draft: false, state });
      expect(robots(metadata)).toEqual({ index: true, follow: true });
      expect(canonical(metadata)).toBe("/contact");
    }
    const closed = contactMetadata({ copy: COPY, settings, seo: production, draft: false, state: CLOSED });
    expect(robots(closed)).toEqual({ index: false, follow: true });
    expect(canonical(closed)).toBeUndefined();
  });

  it("is never indexable in draft mode, outside production or with CMS noIndex", () => {
    const preview = seoEnvironment(settings, { VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://preview.bibo.example" });
    const noIndex = { ...COPY, seo: { ...COPY.seo, noIndex: true } };
    for (const metadata of [
      contactMetadata({ copy: COPY, settings, seo: production, draft: true, state: FORM }),
      contactMetadata({ copy: COPY, settings, seo: preview, draft: false, state: FORM }),
      contactMetadata({ copy: noIndex, settings, seo: production, draft: false, state: FORM }),
    ]) {
      expect(robots(metadata)).toEqual({ index: false, follow: true });
      expect(canonical(metadata)).toBeUndefined();
    }
  });

  it("takes the title and description from the CMS SEO", () => {
    const metadata = contactMetadata({ copy: COPY, settings, seo: production, draft: false, state: FORM });
    expect(metadata.title).toBe(COPY.seo.title);
    expect(metadata.description).toBe(COPY.seo.description);
  });

  it("the page's generateMetadata follows the environment: closed and keyless is noindex", async () => {
    const metadata = await generateMetadata();
    expect(robots(metadata)).toEqual({ index: false, follow: true });
    expect(canonical(metadata)).toBeUndefined();
  });
});
