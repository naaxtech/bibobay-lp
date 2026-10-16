import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THANK_YOU_COPY } from "@/components/legal/legal-copy";
import { SAFE_FALLBACK_CONTENT, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { LEGAL_FALLBACK, legalFallbackFor } from "@/lib/content/legal-fallback";
import { consentWithRemoval, removalPhrase } from "@/lib/content/removal-copy";
import type { PortableContent } from "@/lib/content/types";
import { removalChannelFrom, type RemovalChannel } from "@/lib/leads/removal-channel";

vi.mock("server-only", () => ({}));

const { draft } = vi.hoisted(() => ({ draft: { isEnabled: false } }));
vi.mock("next/headers", () => ({ draftMode: async () => draft }));

const { getSiteSettings } = vi.hoisted(() => ({ getSiteSettings: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings, getLegalSettings: vi.fn(), getLandingPage: vi.fn() }));

const EMAIL_ENV = { RESEND_API_KEY: "re_fixture", RESEND_FROM: "BIBO Bay <hello@example.com>" };
const NO_ENV = {};
const textOf = (content: PortableContent) => content.flatMap((b) => (b.children ?? []).map((span) => span.text)).join("\n");

const CHANNELS: Array<[string, RemovalChannel]> = [
  ["email", { kind: "email" }],
  ["contact", { kind: "contact", email: "owner@example.com" }],
];

beforeEach(() => {
  draft.isEnabled = false;
  getSiteSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("removalChannelFrom (contract)", () => {
  it("is email when sending is configured, contact when only an address is set, otherwise null", () => {
    expect(removalChannelFrom({}, EMAIL_ENV)).toEqual({ kind: "email" });
    expect(removalChannelFrom({ contactEmail: "owner@example.com" }, EMAIL_ENV)).toEqual({ kind: "email" });
    expect(removalChannelFrom({ contactEmail: "owner@example.com" }, NO_ENV)).toEqual({ kind: "contact", email: "owner@example.com" });
    expect(removalChannelFrom({}, NO_ENV)).toBeNull();
    expect(removalChannelFrom({ contactEmail: "not an address" }, NO_ENV)).toBeNull();
  });
});

describe("the consent sentence names only the channel that exists (P-I1)", () => {
  it("the repository wording makes no removal promise of its own", () => {
    expect(SAFE_FALLBACK_CONTENT.lead.consentCopy).not.toMatch(/unsubscribe|remove|reply/i);
  });

  it("adds the reply channel, the contact channel, or nothing", () => {
    const base = SAFE_FALLBACK_CONTENT.lead.consentCopy;
    expect(consentWithRemoval(base, null)).toBe(base);
    expect(consentWithRemoval(base, { kind: "email" })).toMatch(/replying to the acknowledgement email/i);
    expect(consentWithRemoval(base, { kind: "contact", email: "owner@example.com" })).toMatch(/writing to owner@example\.com/);
    expect(removalPhrase(null)).toBeNull();
  });

  it("never promises an unsubscribe link", () => {
    for (const [, channel] of [...CHANNELS, ["none", null] as [string, RemovalChannel]]) expect(consentWithRemoval("I agree.", channel)).not.toMatch(/unsubscribe/i);
  });
});

describe("the privacy and terms fallbacks name the channel that exists (P-I1)", () => {
  it("with no channel: no reply promise, no unsubscribe, no 'any BIBO Bay email'", () => {
    const text = textOf(LEGAL_FALLBACK.privacy) + textOf(LEGAL_FALLBACK.terms);
    expect(text).not.toMatch(/reply to any BIBO Bay email|unsubscribe|replying to any BIBO Bay email/i);
    expect(legalFallbackFor({}, NO_ENV)).toBe(LEGAL_FALLBACK);
  });

  it("with email: removal is by replying to the acknowledgement email", () => {
    const fallback = legalFallbackFor({}, EMAIL_ENV);
    expect(textOf(fallback.privacy)).toMatch(/reply to the acknowledgement email/i);
    expect(textOf(fallback.terms)).toMatch(/replying to the acknowledgement email/i);
    expect(textOf(fallback.privacy) + textOf(fallback.terms)).not.toMatch(/any BIBO Bay email|unsubscribe/i);
  });

  it("with a contact address: removal is by writing to it, and not by replying", () => {
    const fallback = legalFallbackFor({ contactEmail: "owner@example.com" }, NO_ENV);
    expect(textOf(fallback.privacy)).toMatch(/write to owner@example\.com/i);
    expect(textOf(fallback.terms)).toMatch(/writing to owner@example\.com/i);
    expect(textOf(fallback.privacy) + textOf(fallback.terms)).not.toMatch(/reply to the acknowledgement|any BIBO Bay email/i);
  });
});

describe("the cookie sentence (P-M3)", () => {
  it("names the staff session cookies besides the preview cookie", () => {
    const privacy = textOf(LEGAL_FALLBACK.privacy);
    expect(privacy).toMatch(/preview cookie/i);
    expect(privacy).toMatch(/staff/i);
    expect(privacy).toMatch(/session cookies/i);
    expect(privacy).toMatch(/httpOnly|not readable by page scripts|only the server/i);
    expect(privacy).not.toMatch(/only cookie it sets is a preview cookie/i);
  });
});

describe("/thank-you names only the channel that exists (P-I1)", () => {
  const renderPage = async () => {
    const { default: ThankYou } = await import("@/app/thank-you/page");
    render(await ThankYou());
    return screen.getByRole("main").textContent ?? "";
  };

  it("has no removal promise in its repository paragraphs", () => {
    expect(THANK_YOU_COPY.paragraphs.join(" ")).not.toMatch(/removed|any BIBO Bay email/i);
  });

  it("with no channel: no promise", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM", "");
    expect(await renderPage()).not.toMatch(/removed|replying to/i);
  });

  it("with email: replying to the acknowledgement email", async () => {
    vi.stubEnv("RESEND_API_KEY", EMAIL_ENV.RESEND_API_KEY);
    vi.stubEnv("RESEND_FROM", EMAIL_ENV.RESEND_FROM);
    const text = await renderPage();
    expect(text).toMatch(/replying to the acknowledgement email/i);
    expect(text).not.toMatch(/any BIBO Bay email/i);
  });

  it("with a contact address: writing to it", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM", "");
    getSiteSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, contactEmail: "owner@example.com" });
    const text = await renderPage();
    expect(text).toMatch(/writing to owner@example\.com/);
    expect(text).not.toMatch(/replying to/i);
  });
});
