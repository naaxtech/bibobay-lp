import { afterEach, describe, expect, it, vi } from "vitest";

import { contactFormOpen } from "@/lib/contact/availability";

vi.mock("server-only", () => ({}));

/** Fixture values only; the hash secret is exactly the 32-character minimum. */
const OPEN: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture-value",
  LEAD_IP_HASH_SECRET: "x".repeat(32),
  RESEND_API_KEY: "re_fixture",
  RESEND_FROM: "BIBO Bay <hello@example.com>",
  STAFF_NOTIFICATION_EMAIL: "staff@example.com",
};

const without = (name: string) => Object.fromEntries(Object.entries(OPEN).filter(([key]) => key !== name));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("contactFormOpen", () => {
  it("opens only with storage, email sending, a staff address and the hash secret (R173)", () => {
    expect(contactFormOpen(OPEN)).toBe(true);
  });

  it.each(Object.keys(OPEN))("stays closed without %s", (name) => {
    expect(contactFormOpen(without(name))).toBe(false);
  });

  it("stays closed with a 31-character hash secret", () => {
    expect(contactFormOpen({ ...OPEN, LEAD_IP_HASH_SECRET: "x".repeat(31) })).toBe(false);
  });

  it("stays closed with a publishable key in the server slot", () => {
    expect(contactFormOpen({ ...OPEN, SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_fixture-value" })).toBe(false);
  });

  it("reads the process environment by default", () => {
    for (const [name, value] of Object.entries(OPEN)) vi.stubEnv(name, value);
    expect(contactFormOpen()).toBe(true);
    vi.stubEnv("STAFF_NOTIFICATION_EMAIL", "");
    expect(contactFormOpen()).toBe(false);
  });
});
