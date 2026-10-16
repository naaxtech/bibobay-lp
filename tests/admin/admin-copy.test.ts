import { describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/components/admin/admin-copy";

/*
 * Truth rules for the staff API copy (Task 8b; spec §3 ruling 3, §10). The API never knows, when
 * it answers, that an email was delivered or a payment taken: a quote is "saved" once stored and
 * "queued" once its outbox row exists. Refusals never say which accounts exist, and nothing echoes
 * configuration values (only the variable's name, for the owner).
 */
const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

describe("ADMIN_COPY", () => {
  const all = strings(ADMIN_COPY);

  it("is all plain, non-empty sentences", () => {
    expect(all.length).toBeGreaterThan(15);
    for (const text of all) {
      expect(text.trim(), text).toBe(text);
      expect(text, text).toMatch(/^[A-Z].*[.!]$/);
      expect(text, text).not.toMatch(/[<>{}]|\bTODO\b|lorem/i);
    }
  });

  it("never claims an email was sent or delivered, or that anyone paid", () => {
    for (const text of all) {
      expect(text, text).not.toMatch(/\b(?:email|quote|link) (?:was |has been )?(?:sent|delivered)\b/i);
      expect(text, text).not.toMatch(/\bwe (?:sent|emailed)\b|\bcustomer (?:was|has been) (?:emailed|notified)\b/i);
      expect(text, text).not.toMatch(/\bpaid\b|\bpayment (?:received|taken|confirmed)\b/i);
    }
    expect(ADMIN_COPY.quote.saved).toMatch(/Nothing has been sent/);
    expect(ADMIN_COPY.quote.queued).toMatch(/queued/i);
  });

  it("refuses sign-in without saying whether the account exists or is staff", () => {
    expect(ADMIN_COPY.session.refused).not.toMatch(/\b(?:no|not)\s+(?:\w+\s+)?(?:account|found|registered|staff|user)\b|\bfound\b|\bexists?\b|unknown|inactive|disabled/i);
    expect(ADMIN_COPY.api.forbidden).not.toMatch(/staff|cross|origin|sign/i);
  });

  it("says nothing was changed on every refusal that leaves the order as it was", () => {
    for (const text of [ADMIN_COPY.api.unavailable, ADMIN_COPY.api.checkDetails, ADMIN_COPY.api.badRequest, ADMIN_COPY.api.stale, ADMIN_COPY.api.notAllowed, ADMIN_COPY.api.failed]) {
      expect(text, text).toMatch(/Nothing was changed|nothing was changed/);
    }
  });

  it("names a configuration variable, never a value", () => {
    expect(ADMIN_COPY.quote.noPaymentHosts).toContain("PAYMENT_HOST_ALLOWLIST");
    for (const text of all) expect(text, text).not.toMatch(/https?:\/\/|sb_(?:secret|publishable)_|@[a-z0-9-]+\./i);
  });
});
