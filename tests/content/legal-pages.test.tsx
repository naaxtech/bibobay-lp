import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGE_BANDS } from "@/lib/leads/fields";
import { SAFE_FALLBACK_LEGAL, SAFE_FALLBACK_SETTINGS } from "@/lib/content/fallback";
import { LEGAL_FALLBACK, legalFallbackFor } from "@/lib/content/legal-fallback";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LegalSettings, PortableContent } from "@/lib/content/types";
import { LEGAL_PAGE_COPY, THANK_YOU_COPY } from "@/components/legal/legal-copy";
import { LEAD_RATE_LIMIT } from "@/lib/leads/submit";
import { ORDER_RATE_LIMIT } from "@/lib/orders/submit";
import { ORDER_TRACK_RATE_LIMIT } from "@/lib/orders/track";

vi.mock("server-only", () => ({}));

const { draft } = vi.hoisted(() => ({ draft: { isEnabled: false } }));
vi.mock("next/headers", () => ({ draftMode: async () => draft }));

const { getSiteSettings, getLegalSettings } = vi.hoisted(() => ({ getSiteSettings: vi.fn(), getLegalSettings: vi.fn() }));
vi.mock("@/lib/sanity/fetch", () => ({ getSiteSettings, getLegalSettings, getLandingPage: vi.fn() }));

const block = (text: string): PortableContent => [{ _type: "block", children: [{ _type: "span", text }] }];

beforeEach(() => {
  draft.isEnabled = false;
  getSiteSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_SETTINGS);
  getLegalSettings.mockReset().mockResolvedValue(SAFE_FALLBACK_LEGAL);
});
afterEach(() => {
  cleanup();
});

/** All text of a fallback document. */
const textOf = (content: PortableContent) => content.flatMap((b) => (b.children ?? []).map((span) => span.text)).join("\n");

describe("repository fallback legal text (ruling R30)", () => {
  const privacy = textOf(LEGAL_FALLBACK.privacy);
  const terms = textOf(LEGAL_FALLBACK.terms);

  it("describes exactly the details the founding-family form collects", () => {
    for (const field of [/email address/i, /first name/i, /age range/i, /consent/i, /campaign|utm/i, /language/i]) expect(privacy).toMatch(field);
    // Every listed age range is broad; none asks for a birthday.
    expect(privacy).toMatch(/broad/i);
    expect(AGE_BANDS.length).toBe(5);
  });

  it("names the processors the code really uses and nothing it does not", () => {
    expect(privacy).toMatch(/Supabase/);
    expect(privacy).toMatch(/Resend/);
    expect(privacy).toMatch(/Sanity/);
    // Ruling R70: PostHog counts visits when it is configured; Task 10M-a: Sentry receives error
    // reports when it is configured. Nothing else watches visitors.
    expect(privacy).toMatch(/PostHog/);
    expect(privacy).toMatch(/Sentry/);
    expect(privacy).not.toMatch(/Google Analytics|Facebook Pixel|Meta Pixel|Mailchimp|Stripe/i);
  });

  it("describes what visit statistics really send in cookieless mode (review I1)", () => {
    // Cookieless server hash mode strips the address before GeoIP runs: no location is added.
    expect(privacy).not.toMatch(/location/i);
    expect(privacy).toMatch(/language and time zone/i);
    expect(privacy).toMatch(/operating system/i);
    expect(privacy).toMatch(/how far down each page you scroll and how long you stay/i);
    expect(privacy).toMatch(/value that changes every day/i);
    expect(privacy).toMatch(/does not keep the address/i);
  });

  it("does not claim to store nothing on the device: the off choice is stored (review M2)", () => {
    expect(privacy).not.toMatch(/stores nothing on your device[,.;]/i);
    expect(privacy).toMatch(/stores nothing on your device unless you turn statistics off/i);
  });

  it("describes error reports exactly as the scrubber sends them (Task 10M-a)", () => {
    expect(privacy).toMatch(/only when error reporting is switched on/i);
    expect(privacy).toMatch(/no form details/i);
    expect(privacy).toMatch(/no cookies/i);
    expect(privacy).toMatch(/question mark/i);
  });

  it("describes the visit statistics exactly as the code runs them (ruling R70)", () => {
    expect(privacy).toMatch(/no cookies/i);
    expect(privacy).toMatch(/no profile/i);
    expect(privacy).toMatch(/never records what you type/i);
    expect(privacy).toMatch(/site or campaign that sent you/i);
    expect(privacy).toMatch(/Global Privacy Control/);
    expect(privacy).toMatch(/Analytics choices/);
    expect(privacy).toMatch(/only when statistics are switched on/i);
  });

  it("states the honest limits: no child data, no card data, no stored IP address, no advertising cookies", () => {
    expect(privacy).toMatch(/do not ask for.*child/i);
    expect(privacy).toMatch(/card/i);
    expect(privacy).toMatch(/IP address/i);
    expect(privacy).toMatch(/not stored|never stored|do not store/i);
    expect(privacy).toMatch(/cookie/i);
  });

  it("explains removal by reply and does not promise an unsubscribe link that does not exist", () => {
    expect(privacy).toMatch(/reply to any BIBO Bay email/i);
    expect(privacy).not.toMatch(/unsubscribe link/i);
  });

  it("describes retention as the database implements it, without inventing a period", () => {
    // Withdrawal marks the row; migration 0001 has no delete path, so the text must not imply deletion
    // (Task 9 review I2).
    expect(privacy).not.toMatch(/until you ask us to remove/i);
    expect(privacy).toMatch(/marks your signup as withdrawn/i);
    expect(privacy).toMatch(/does not delete/i);
    expect(privacy).toMatch(/nothing deletes it automatically/i);
    expect(privacy).toMatch(/rate-limit/i);
    expect(privacy).not.toMatch(/\b\d+\s*(days|months|years)\b/i);
  });

  it("mentions the delivery records kept for each email (lead_delivery_events)", () => {
    expect(privacy).toMatch(/delivery record/i);
    expect(privacy).toMatch(/error code/i);
  });

  it("invents no company name, address, registration, jurisdiction, governing law or contact email", () => {
    for (const text of [privacy, terms]) {
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/\b(Ltd|LLC|Inc\.?|GmbH|Pty|Limited|Corporation|registered (office|number|in))\b/i);
      expect(text).not.toMatch(/\b(GDPR|CCPA|COPPA|Data Protection Act|governed by|laws of|jurisdiction|court)\b/i);
      expect(text).not.toMatch(/\b(street|road|avenue|suite|postcode|zip)\b/i);
    }
  });

  it("is shown under a note saying plainly that it awaits legal review, on both pages", async () => {
    expect(LEGAL_PAGE_COPY.fallbackNote).toMatch(/not yet been reviewed by a lawyer/i);
    for (const load of [() => import("@/app/privacy/page"), () => import("@/app/terms/page")]) {
      const { default: Page } = await load();
      render(await Page());
      expect(within(screen.getByRole("main")).getByRole("note").textContent).toBe(LEGAL_PAGE_COPY.fallbackNote);
      cleanup();
    }
  });

  it("makes no commerce, download or social-proof promises in the terms", () => {
    expect(terms).toMatch(/nothing is for sale/i);
    // The free activity pack is real (R66): the terms say it may be printed at home, and no longer
    // claim that nothing here is a download.
    expect(terms).toMatch(/activity pack/i);
    expect(terms).not.toMatch(/promises a show, a product, a download/i);
    expect(terms).not.toMatch(/refund|delivery within|guarantee|money-back/i);
  });

  it("keeps the content contract: SAFE_FALLBACK_LEGAL is still empty", () => {
    expect(SAFE_FALLBACK_LEGAL.privacy).toEqual([]);
    expect(SAFE_FALLBACK_LEGAL.terms).toEqual([]);
  });
});

/*
 * Task 7b: the fallback text follows the commerce switch. Off (the default) it is exactly the text
 * above, "nothing is sold" included. On, those lines go and the text describes what an order request
 * stores (migrations 0002 to 0005), why, and how payment works, without a retention period.
 */
describe("repository fallback legal text while commerce is on (Task 7b)", () => {
  const on = legalFallbackFor({ commerceEnabled: true });
  const privacy = textOf(on.privacy);
  const terms = textOf(on.terms);
  const migration = ["0002_orders.sql", "0003_order_tracking.sql", "0005_shared_rate_limits_and_token_rotation.sql"].map((file) => readFileSync(resolve("supabase/migrations", file), "utf8")).join("\n");

  it("is exactly today's text while commerce is off, or anything but a literal true", () => {
    for (const settings of [{ commerceEnabled: false }, { commerceEnabled: "true" as unknown as boolean }, SAFE_FALLBACK_SETTINGS]) expect(legalFallbackFor(settings)).toBe(LEGAL_FALLBACK);
    expect(textOf(LEGAL_FALLBACK.privacy)).toMatch(/Nothing is sold on this website\./);
    expect(textOf(LEGAL_FALLBACK.terms)).toMatch(/Nothing is for sale on this website at the moment\./);
  });

  it("drops every \"nothing is sold\" line", () => {
    expect(privacy).not.toMatch(/nothing is sold|nothing is for sale/i);
    expect(terms).not.toMatch(/nothing is sold|nothing is for sale/i);
  });

  it("describes the contact and delivery details an order stores, as migration 0002 defines them", () => {
    for (const column of ["contact_name", "email", "phone", "address_line1", "address_line2", "city", "region", "postal_code", "country", "notes", "consent_version", "consent_granted_at"]) expect(migration, column).toMatch(new RegExp(`\\b${column}\\b`));
    expect(privacy).toMatch(/order form is for adults/i);
    expect(privacy).toMatch(/your name and email address/i);
    expect(privacy).toMatch(/phone number if you choose/i);
    expect(privacy).toMatch(/delivery address/i);
    expect(privacy).toMatch(/street address, city and country/i);
    expect(privacy).toMatch(/region and postal code/i);
    expect(privacy).toMatch(/notes you add/i);
    expect(privacy).toMatch(/version of the wording you agreed to, and when you agreed/i);
  });

  it("describes the product snapshot, the order's history, its email records and the tracking link's hash", () => {
    // orders, order_items, order_events, order_email_outbox: every order table the migrations create.
    for (const table of ["orders", "order_items", "order_events", "order_email_outbox"]) expect(migration).toMatch(new RegExp(`create table if not exists public\\.${table} `));
    for (const column of ["sanity_id", "title", "sku", "variant", "pack", "quantity", "actor", "provider_message_id", "last_error_code", "tracking_token_hash", "tracking_token_expires_at"]) expect(migration, column).toMatch(new RegExp(`\\b${column}\\b`));
    expect(privacy).toMatch(/as each product was described in the shop when you sent the request/i);
    expect(privacy).toMatch(/product code, variant and pack/i);
    expect(privacy).toMatch(/the shop's own reference for it, its name/i);
    expect(privacy).toMatch(/how many of each/i);
    expect(privacy).toMatch(/reference, its status/i);
    expect(privacy).toMatch(/a record of what has happened to the order/i);
    expect(privacy).toMatch(/you, the BIBO Bay team or the website itself/i);
    expect(privacy).toMatch(/one-way code \(a hash\)/i);
    expect(privacy).toMatch(/link itself is not stored/i);
    expect(privacy).toMatch(/delivery record/i);
  });

  it("never asks for card details, takes no payment, and explains the payment link staff send later", () => {
    expect(migration).not.toMatch(/card_number|\bcvc\b|\biban\b/i);
    expect(privacy).toMatch(/never ask for payment card or bank details/i);
    expect(privacy).toMatch(/no payment is taken on this website/i);
    expect(privacy).toMatch(/quote and a link to pay/i);
    expect(privacy).toMatch(/currency, the amounts quoted, the payment link/i);
    expect(terms).toMatch(/does not buy anything and charges nothing/i);
    expect(terms).toMatch(/quote and a payment link/i);
    expect(terms).toMatch(/Only adults may send an order request/i);
    expect(terms).not.toMatch(/refund|delivery within|guarantee|money-back/i);
  });

  it("says why the details are used, and that the acknowledgement carries no prices", () => {
    expect(privacy).toMatch(/to handle your order request/i);
    expect(privacy).toMatch(/acknowledging your request, without prices/i);
  });

  it("names exactly what the staff alert carries: the reference, name, email address and products, and no delivery details (R107)", () => {
    // lib/email/order-emails.ts buildStaffOrderAlert: reference, contact name, email, the lines. No address, phone or notes.
    expect(privacy).toMatch(/team is told that a request arrived, in a note that carries the order's reference, your name and email address and the products you asked for, but not your delivery address/i);
  });

  it("describes the order list kept on the device, and the private link kept out of statistics and error reports", () => {
    expect(privacy).toMatch(/only which products you added and how many/i);
    expect(privacy).toMatch(/\/orders\/\[token\]/);
  });

  it("counts order requests and lookups against the keyed code, never storing the address", () => {
    expect(privacy).toMatch(/not stored with your signup or your order/i);
    expect(privacy).toMatch(/order requests and order lookups are counted the same way/i);
  });

  it("describes only the order events the migrations record (review Minor 4)", () => {
    const migrations = readdirSync(resolve("supabase/migrations")).map((file) => readFileSync(resolve("supabase/migrations", file), "utf8")).join("\n");
    expect(migrations).toContain("'order_submitted'");
    expect(migrations).toContain("'tracking_token_rotated'");
    expect(privacy).toMatch(/your sending it/i);
    expect(privacy).toMatch(/replacement of its tracking link/i);
    // Status changes and quotes are recorded once a migration writes them (staff administration,
    // Task 8b, migration 0007); the text names each event exactly when one does.
    for (const [event, wording] of [
      ["status_changed", /each change of its status/i],
      ["quote_saved", /each quote the team saves/i],
      ["quote_queued", /queues for email/i],
    ] as const) {
      if (new RegExp(`'${event}'`).test(migrations)) expect(privacy, event).toMatch(wording);
      else expect(privacy, event).not.toMatch(wording);
    }
  });

  it("states the rate-limit windows the code uses (review Minor 4)", () => {
    expect(LEAD_RATE_LIMIT.windowSeconds).toBe(600);
    expect(privacy).toMatch(/signup attempts, in 10-minute windows/i);
    expect(ORDER_RATE_LIMIT.windowSeconds).toBe(3600);
    expect(privacy).toMatch(/order requests by the hour/i);
    expect(ORDER_TRACK_RATE_LIMIT.windowSeconds).toBe(600);
    expect(privacy).toMatch(/lookups in 10-minute windows/i);
  });

  it("states no retention period, and no deletion that does not exist", () => {
    expect(privacy).toMatch(/nothing deletes them automatically/i);
    expect(privacy).not.toMatch(/\b\d+\s*(days|months|years)\b/i);
    expect(privacy).not.toMatch(/we delete your order|orders are deleted/i);
  });

  it("still invents no company, address, jurisdiction or contact email", () => {
    for (const text of [privacy, terms]) {
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/\b(Ltd|LLC|Inc\.?|GmbH|Pty|Limited|Corporation|registered (office|number|in))\b/i);
      expect(text).not.toMatch(/\b(GDPR|CCPA|COPPA|Data Protection Act|governed by|laws of|jurisdiction|court)\b/i);
    }
  });

  it("is what /privacy and /terms show while commerce is on", async () => {
    getSiteSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, commerceEnabled: true });
    for (const [load, expected] of [[() => import("@/app/privacy/page"), "never ask for payment card or bank details"], [() => import("@/app/terms/page"), "does not buy anything and charges nothing"]] as const) {
      const { default: Page } = await load();
      render(await Page());
      const main = screen.getByRole("main");
      expect(main.textContent).toMatch(new RegExp(expected, "i"));
      expect(main.textContent).not.toMatch(/nothing is sold|nothing is for sale/i);
      cleanup();
    }
  });
});

describe("/privacy and /terms", () => {
  it("/privacy renders the fallback, labelled as such, when Sanity has no text", async () => {
    const { default: Privacy } = await import("@/app/privacy/page");
    render(await Privacy());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Privacy");
    const main = screen.getByRole("main");
    expect(main.textContent).toContain("Supabase");
    expect(within(main).getByRole("note").textContent).toMatch(/not yet been reviewed/i);
    expect(getLegalSettings).toHaveBeenCalledWith({ preview: false });
  });

  it("/privacy offers the configured contact email for removal, and none when unset", async () => {
    getSiteSettings.mockResolvedValue({ ...SAFE_FALLBACK_SETTINGS, contactEmail: "hello@bibo.example" });
    const { default: Privacy } = await import("@/app/privacy/page");
    render(await Privacy());
    expect(within(screen.getByRole("main")).getByRole("link", { name: "hello@bibo.example" }).getAttribute("href")).toBe("mailto:hello@bibo.example");
    cleanup();
    getSiteSettings.mockResolvedValue(SAFE_FALLBACK_SETTINGS);
    render(await Privacy());
    expect(screen.queryByRole("link", { name: /@/ })).toBeNull();
  });

  it("/terms renders Sanity text, without the fallback note, when it exists", async () => {
    const legal: LegalSettings = { ...SAFE_FALLBACK_LEGAL, terms: block("Terms written in the Studio."), termsVersion: "2026-10" };
    getLegalSettings.mockResolvedValue(legal);
    const { default: Terms } = await import("@/app/terms/page");
    render(await Terms());
    expect(screen.getByRole("main").textContent).toContain("Terms written in the Studio.");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("legal metadata is noindex for fallback text", async () => {
    const { generateMetadata } = await import("@/app/privacy/page");
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
  });
});

describe("/thank-you (ruling R31)", () => {
  it("does not claim the visitor joined, and links back to the form", async () => {
    const { default: ThankYou, generateMetadata } = await import("@/app/thank-you/page");
    render(await ThankYou());
    const main = screen.getByRole("main");
    expect(main.textContent).not.toMatch(/you('re| are) (on|in)|you joined|welcome aboard|subscribed/i);
    expect(within(main).getByRole("link", { name: THANK_YOU_COPY.backToForm }).getAttribute("href")).toBe("/#lead");
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
  });
});

describe("the page for a missing address (review I2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a calm branded page that leads home and keeps the footer, with Analytics choices", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", `phc_${"Fixture0nly".repeat(4)}`);
    const { default: NotFound } = await import("@/app/not-found");
    const { NOT_FOUND_COPY } = await import("@/components/legal/legal-copy");
    render(await NotFound());
    expect(screen.getByRole("heading", { level: 1, name: NOT_FOUND_COPY.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: NOT_FOUND_COPY.backHome }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("button", { name: "Analytics choices" })).toBeTruthy();
  });

  it("is titled like the site's other pages (re-review)", async () => {
    const { metadata } = await import("@/app/not-found");
    const { NOT_FOUND_COPY } = await import("@/components/legal/legal-copy");
    expect(metadata.title).toBe(`${NOT_FOUND_COPY.title} | ${SAFE_FALLBACK_SETTINGS.title}`);
  });
});
