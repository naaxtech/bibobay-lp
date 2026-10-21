import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CONTACT_API_MESSAGES,
  CONTACT_BODY_LIMIT_BYTES,
  CONTACT_GLOBAL_RATE_LIMIT,
  CONTACT_RATE_LIMIT,
  submitContactMessage,
  type ContactLogEvent,
  type ContactSubmissionDependencies,
} from "@/lib/contact/submit";
import type { ContactRecordInput, ContactRepository } from "@/lib/contact/types";
import { createMemoryRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";

const VALID = { name: "Ada", email: "Ada@Example.com", topic: "press", message: "Hello from a parent.\r\nSecond line.", website: "" };
const STORED = { messageId: "11111111-1111-4111-8111-111111111111", deliveryId: "22222222-2222-4222-8222-222222222222" };

function setup(overrides: Partial<ContactSubmissionDependencies> = {}) {
  const stored: ContactRecordInput[] = [];
  const logs: ContactLogEvent[] = [];
  const consumed: Array<[string, { maxHits: number; windowSeconds: number }]> = [];
  const memory = createMemoryRateLimiter();
  const rateLimiter: RateLimiter = {
    consume: async (key, rule) => (consumed.push([key, rule]), memory.consume(key, rule)),
  };
  const repository = {
    submitMessage: async (record: ContactRecordInput) => (stored.push(record), STORED),
  } as ContactRepository;
  const afterTasks: Array<() => Promise<void>> = [];
  const sendAlert = vi.fn(async (messageId: string) => void messageId);
  const dependencies: ContactSubmissionDependencies = {
    open: true,
    repository,
    rateLimiter,
    clientKey: "k",
    globalLimitPerHour: 60,
    log: (event) => logs.push(event),
    sendAlert,
    runAfterResponse: (task) => void afterTasks.push(task),
    ...overrides,
  };
  return { dependencies, stored, logs, consumed, afterTasks, sendAlert, repository };
}

describe("submitContactMessage", () => {
  it("a filled honeypot gets the generic 400 and touches nothing", async () => {
    const { dependencies, stored, logs, consumed } = setup();
    const result = await submitContactMessage({ ...VALID, website: "http://spam.example" }, dependencies);
    expect(result).toEqual({ status: 400, body: { ok: false, persisted: false, message: CONTACT_API_MESSAGES.error } });
    expect(result.body).not.toHaveProperty("fieldErrors");
    expect(consumed).toEqual([]);
    expect(stored).toEqual([]);
    expect(logs).toEqual([{ event: "contact_honeypot" }]);
  });

  it("field errors answer 400 in field order and store nothing", async () => {
    const { dependencies, stored, consumed } = setup();
    const result = await submitContactMessage({ name: "", email: "nope", topic: "other", message: "short" }, dependencies);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ ok: false, persisted: false, message: CONTACT_API_MESSAGES.checkDetails, fieldErrors: { name: "required", email: "invalid", topic: "invalid", message: "too_short" } });
    expect(Object.keys(result.body.fieldErrors ?? {})).toEqual(["name", "email", "topic", "message"]);
    expect(stored).toEqual([]);
    expect(consumed).toEqual([]);
  });

  it("answers a malformed body as the generic 400 without field errors", async () => {
    const { dependencies } = setup();
    for (const input of [null, "text", { ...VALID, childName: "Sam" }]) {
      const result = await submitContactMessage(input, dependencies);
      expect(result).toEqual({ status: 400, body: { ok: false, persisted: false, message: CONTACT_API_MESSAGES.error } });
    }
  });

  it("an unknown key rejects the whole body with the generic 400 first, even when fields are also invalid (C5)", async () => {
    const { dependencies, stored, consumed } = setup();
    for (const input of [{ name: "", email: "nope", topic: "other", message: "short", childName: "Sam" }, { ...VALID, message: "short", age: 4 }]) {
      const result = await submitContactMessage(input, dependencies);
      expect(result).toEqual({ status: 400, body: { ok: false, persisted: false, message: CONTACT_API_MESSAGES.error } });
      expect(result.body).not.toHaveProperty("fieldErrors");
    }
    expect(stored).toEqual([]);
    expect(consumed).toEqual([]);
  });

  it("while closed it answers 503 with closed: true before any limiter or write", async () => {
    for (const overrides of [{ open: false }, { repository: null }]) {
      const { dependencies, stored, consumed, logs } = setup(overrides);
      const result = await submitContactMessage(VALID, dependencies);
      expect(result).toEqual({ status: 503, body: { ok: false, persisted: false, closed: true, message: CONTACT_API_MESSAGES.closed } });
      expect(consumed).toEqual([]);
      expect(stored).toEqual([]);
      expect(logs).toEqual([{ event: "contact_unconfigured" }]);
    }
  });

  it("limits each client to 3 per 10 minutes under contact:<clientKey>", async () => {
    const { dependencies, consumed } = setup();
    for (let index = 0; index < 3; index += 1) expect((await submitContactMessage(VALID, dependencies)).status).toBe(200);
    const fourth = await submitContactMessage(VALID, dependencies);
    expect(fourth.status).toBe(429);
    expect(fourth.body).toEqual({ ok: false, persisted: false, message: CONTACT_API_MESSAGES.rateLimited });
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
    expect(consumed[0]).toEqual(["contact:k", { maxHits: 3, windowSeconds: 600 }]);
    expect(CONTACT_RATE_LIMIT).toEqual({ scope: "contact", maxHits: 3, windowSeconds: 600 });
  });

  it("caps all messages per hour under contact:global at the alert's hourly send cap it is given, checked after the client limit (R212)", async () => {
    const { dependencies, consumed, stored } = setup();
    await submitContactMessage(VALID, dependencies);
    expect(consumed.map(([key]) => key)).toEqual(["contact:k", "contact:global"]);
    expect(consumed[1]).toEqual(["contact:global", { maxHits: 60, windowSeconds: 3600 }]);
    expect(CONTACT_GLOBAL_RATE_LIMIT).toEqual({ key: "contact:global", windowSeconds: 3600 });

    const other = setup({ globalLimitPerHour: 7 });
    await submitContactMessage(VALID, other.dependencies);
    expect(other.consumed[1]).toEqual(["contact:global", { maxHits: 7, windowSeconds: 3600 }]);

    const spent = setup({ rateLimiter: { consume: async (key) => ({ allowed: key !== "contact:global", remaining: 0, retryAfterSeconds: key === "contact:global" ? 90 : 0 }) } });
    const result = await submitContactMessage(VALID, spent.dependencies);
    expect(result).toEqual({ status: 429, body: { ok: false, persisted: false, message: CONTACT_API_MESSAGES.rateLimited }, retryAfterSeconds: 90 });
    expect(spent.stored).toEqual([]);
    expect(spent.logs).toEqual([{ event: "contact_rate_limited", scope: "global" }]);
    expect(stored).toHaveLength(1);
  });

  it("never stores more messages in an hour than the alert budget can announce (R212)", async () => {
    const { dependencies, stored, logs } = setup({ globalLimitPerHour: 2 });
    const answers = [];
    for (const clientKey of ["a", "b", "c"]) answers.push((await submitContactMessage(VALID, { ...dependencies, clientKey })).status);
    expect(answers).toEqual([200, 200, 429]);
    expect(stored).toHaveLength(2);
    expect(logs.at(-1)).toEqual({ event: "contact_rate_limited", scope: "global" });
  });

  it("fails closed with 503, not closed, when the limiter is missing or throws", async () => {
    const throwing = setup({ rateLimiter: { consume: async () => Promise.reject(Object.assign(new Error("down"), { code: "57P01" })) } });
    const missing = setup({ rateLimiter: null });
    for (const { dependencies, stored } of [throwing, missing]) {
      const result = await submitContactMessage(VALID, dependencies);
      expect(result).toEqual({ status: 503, body: { ok: false, persisted: false, message: CONTACT_API_MESSAGES.error } });
      expect(result.body).not.toHaveProperty("closed");
      expect(stored).toEqual([]);
    }
    expect(throwing.logs).toEqual([{ event: "contact_rate_limit_unavailable", code: "57P01" }]);
  });

  it("stores exactly the normalised record and answers persisted only after both ids return", async () => {
    const { dependencies, stored, logs } = setup();
    const result = await submitContactMessage(VALID, dependencies);
    expect(stored).toEqual([{ name: "Ada", email: "ada@example.com", topic: "press", message: "Hello from a parent.\nSecond line." }]);
    expect(result).toEqual({ status: 200, body: { ok: true, persisted: true, message: CONTACT_API_MESSAGES.received } });
    expect(logs).toEqual([{ event: "contact_stored" }]);
    expect(CONTACT_API_MESSAGES.received).not.toMatch(/\b(sent|emailed|delivered)\b/i);
  });

  it("a write failure answers 500 and calls sendAlert never", async () => {
    const { dependencies, afterTasks, sendAlert, logs } = setup({
      repository: { submitMessage: async () => Promise.reject(Object.assign(new Error("boom"), { code: "22023" })) } as unknown as ContactRepository,
    });
    const result = await submitContactMessage(VALID, dependencies);
    expect(result).toEqual({ status: 500, body: { ok: false, persisted: false, message: CONTACT_API_MESSAGES.error } });
    expect(afterTasks).toEqual([]);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(logs).toEqual([{ event: "contact_store_failed", code: "22023" }]);
  });

  it("after the answer, calls sendAlert once with the stored message id", async () => {
    const { dependencies, afterTasks, sendAlert } = setup();
    await submitContactMessage(VALID, dependencies);
    expect(sendAlert).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(1);
    await afterTasks[0]!();
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith(STORED.messageId);
  });

  it("a sendAlert that throws, or none at all, leaves the answer 200 persisted", async () => {
    const throwing = setup({ sendAlert: async () => Promise.reject(new Error("mail down")) });
    const result = await submitContactMessage(VALID, throwing.dependencies);
    expect(result.status).toBe(200);
    await expect(throwing.afterTasks[0]!()).resolves.toBeUndefined();

    const none = setup({ sendAlert: null });
    expect((await submitContactMessage(VALID, none.dependencies)).body.persisted).toBe(true);
    expect(none.afterTasks).toEqual([]);
  });

  it("runs the alert inline when no after-response hook is given", async () => {
    const { dependencies, sendAlert } = setup({ runAfterResponse: undefined });
    await submitContactMessage(VALID, dependencies);
    expect(sendAlert).toHaveBeenCalledWith(STORED.messageId);
  });

  it("logs names and codes only", async () => {
    const all = setup();
    await submitContactMessage(VALID, all.dependencies);
    await submitContactMessage({ ...VALID, website: "x" }, all.dependencies);
    const failing = setup({ repository: { submitMessage: async () => Promise.reject(new Error("Ada ada@example.com Hello")) } as unknown as ContactRepository });
    await submitContactMessage(VALID, failing.dependencies);
    const logged = JSON.stringify([...all.logs, ...failing.logs]);
    for (const secret of ["Ada", "ada@example.com", "Hello"]) expect(logged).not.toContain(secret);
  });

  it("limits the body to 32 KB", () => {
    expect(CONTACT_BODY_LIMIT_BYTES).toBe(32 * 1024);
  });
});
