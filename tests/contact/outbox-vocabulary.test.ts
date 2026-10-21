import { describe, expect, it } from "vitest";

import { CONTACT_DELIVERY_KINDS, LEAD_DELIVERY_KINDS, SEND_BUDGETS, sendBudgetFor, sendBudgetKey } from "@/lib/outbox/constants";

/*
 * Ruling R169: contact staff alerts get an outbox of their own, `contact`, beside the signup and
 * order outboxes; R170: they spend their own hourly send budget. The lead outbox is not touched.
 */
describe("the contact outbox's vocabulary", () => {
  it("names three outboxes", () => {
    expect(Object.keys(SEND_BUDGETS)).toEqual(["leads", "orders", "contact"]);
    expect(CONTACT_DELIVERY_KINDS).toEqual(["contact_staff_alert"]);
  });

  it("gives the contact alert its own budget (R170)", () => {
    const budget = sendBudgetFor("contact", "contact_staff_alert");
    expect(budget).toBe("contact_staff_alert");
    expect(sendBudgetKey(budget!)).toBe("send:contact_staff_alert");
  });

  it("never charges a contact alert to another outbox", () => {
    expect(sendBudgetFor("leads", "contact_staff_alert")).toBeNull();
    expect(sendBudgetFor("orders", "contact_staff_alert")).toBeNull();
    expect(sendBudgetFor("contact", "staff_alert")).toBeNull();
  });

  it("leaves the lead outbox's kinds alone (R169)", () => {
    expect(LEAD_DELIVERY_KINDS).toEqual(["acknowledgement", "staff_alert"]);
  });
});
