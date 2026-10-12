import { afterEach, describe, expect, it, vi } from "vitest";

import { FORM_COPY } from "@/components/forms/form-copy";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";
import type { EmailMessage, EmailSender, EmailSendResult } from "@/lib/email/client";
import type { DeliveryKind, DeliveryOutcome, LeadRecordInput, LeadRepository } from "@/lib/leads/submit";
import { LEAD_RATE_LIMIT, submitLead, type LeadSubmissionDependencies } from "@/lib/leads/submit";
import { createMemoryRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.useRealTimers();
});

const COPY = {
  successMessage: SAFE_FALLBACK_CONTENT.lead.successMessage,
  errorMessage: SAFE_FALLBACK_CONTENT.lead.errorMessage,
};

/** Words that would claim an email reached someone, or promise a file. Public copy must never say them. */
const DELIVERY_CLAIM = /\b(sent|deliver(ed|y)?|inbox|check your (email|mail)|we('ve| have) emailed|download)\b/i;

interface StoredEvent { id: string; leadId: string; kind: DeliveryKind; status: "pending" | "sending" | "sent" | "failed"; attempts: number; providerMessageId?: string; errorCode?: string }

/** An in-memory stand-in for the Supabase repository, logging each call in order. */
function fakeRepository() {
  const calls: string[] = [];
  const leads = new Map<string, { id: string; input: LeadRecordInput }>();
  const events = new Map<string, StoredEvent>();
  const repository: LeadRepository = {
    async submitLead(input) {
      calls.push("submitLead");
      const existing = leads.get(input.email);
      if (existing) {
        existing.input = input;
        return { leadId: existing.id, created: false };
      }
      const id = `lead-${leads.size + 1}`;
      leads.set(input.email, { id, input });
      return { leadId: id, created: true };
    },
    async enqueueDelivery(leadId, kind, { claim }) {
      calls.push(`enqueue:${kind}`);
      const key = `${leadId}:${kind}`;
      const existing = events.get(key);
      if (existing) return { eventId: existing.id, status: existing.status, created: false };
      const event: StoredEvent = { id: `event-${events.size + 1}`, leadId, kind, status: claim ? "sending" : "pending", attempts: claim ? 1 : 0 };
      events.set(key, event);
      return { eventId: event.id, status: event.status, created: true };
    },
    async recordDeliveryAttempt(eventId, outcome: DeliveryOutcome) {
      calls.push(`record:${outcome.status}`);
      const event = [...events.values()].find((entry) => entry.id === eventId);
      if (!event) throw new Error("unknown event");
      event.status = outcome.status;
      if (outcome.status === "sent") event.providerMessageId = outcome.providerMessageId;
      else event.errorCode = outcome.errorCode;
    },
  };
  return { repository, calls, leads, events, event: (kind: DeliveryKind) => [...events.values()].find((entry) => entry.kind === kind) };
}

function fakeMailer(result: EmailSendResult | (() => Promise<EmailSendResult>) = { status: "sent", providerMessageId: "re_123" }) {
  const sent: EmailMessage[] = [];
  const mailer: EmailSender = {
    async send(message) {
      sent.push(message);
      return typeof result === "function" ? result() : result;
    },
  };
  return { mailer, sent };
}

const allowAll: RateLimiter = { async consume() { return { allowed: true, remaining: 99, retryAfterSeconds: 0 }; } };

function dependencies(overrides: Partial<LeadSubmissionDependencies> = {}): LeadSubmissionDependencies {
  return {
    repository: fakeRepository().repository,
    rateLimiter: allowAll,
    mailer: null,
    copy: COPY,
    consentVersion: "7",
    clientKey: "client-hash",
    staffEmail: null,
    leadMagnet: null,
    replyTo: null,
    log: () => {},
    ...overrides,
  };
}

const VALID = { email: "Parent@Example.com", consent: true, firstName: "Ana", ageBand: "3-5" };

describe("validation and consent", () => {
  it("persists nothing and answers 400 with field errors when the email is missing", async () => {
    const repo = fakeRepository();
    const result = await submitLead({ consent: true }, dependencies({ repository: repo.repository }));
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false, persisted: false, acknowledgementQueued: false, fieldErrors: { email: "required" } });
    expect(repo.calls).toEqual([]);
  });

  it("refuses a signup without the consent tick, and stores nothing", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const result = await submitLead({ ...VALID, consent: false }, dependencies({ repository: repo.repository, mailer }));
    expect(result.status).toBe(400);
    expect(result.body.fieldErrors).toEqual({ consent: "required" });
    expect(result.body.persisted).toBe(false);
    expect(repo.leads.size).toBe(0);
    expect(sent).toEqual([]);
  });

  it("stores the server's consent version, never one the browser supplies", async () => {
    const repo = fakeRepository();
    await submitLead(VALID, dependencies({ repository: repo.repository, consentVersion: "7" }));
    expect(repo.leads.get("parent@example.com")?.input.consentVersion).toBe("7");
    const forged = await submitLead({ ...VALID, consentVersion: "0" }, dependencies({ repository: repo.repository }));
    expect(forged.status).toBe(400);
  });

  it("hands the repository only adult details and broad, bounded metadata", async () => {
    const repo = fakeRepository();
    await submitLead({ ...VALID, source: "landing", locale: "en-AU", utm: { campaign: "founding" } }, dependencies({ repository: repo.repository }));
    expect(repo.leads.get("parent@example.com")?.input).toEqual({
      email: "parent@example.com",
      firstName: "Ana",
      ageBand: "3-5",
      consentVersion: "7",
      source: "landing",
      locale: "en-AU",
      utm: { campaign: "founding" },
    });
  });
});

describe("honeypot", () => {
  it("answers a filled honeypot with a generic 400 and records nothing at all", async () => {
    const repo = fakeRepository();
    const consume = vi.fn(allowAll.consume);
    const { mailer, sent } = fakeMailer();
    const log = vi.fn();
    const result = await submitLead({ ...VALID, website: "http://spam.example" }, dependencies({ repository: repo.repository, rateLimiter: { consume }, mailer, log }));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: COPY.errorMessage });
    expect(repo.calls).toEqual([]);
    expect(consume).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("never answers a honeypot hit with success, even when nothing is configured", async () => {
    const result = await submitLead({ ...VALID, website: "x" }, dependencies({ repository: null, rateLimiter: null }));
    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(result.body.message).toBe(COPY.errorMessage);
  });
});

describe("unconfigured storage", () => {
  it("answers 503 with the CMS error message and never pretends success", async () => {
    const { mailer, sent } = fakeMailer();
    const result = await submitLead(VALID, dependencies({ repository: null, mailer }));
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: COPY.errorMessage });
    expect(sent).toEqual([]);
  });
});

describe("shared rate limit", () => {
  it("asks the shared limiter about this client under the lead rule before storing anything", async () => {
    const consume = vi.fn(allowAll.consume);
    const repo = fakeRepository();
    await submitLead(VALID, dependencies({ repository: repo.repository, rateLimiter: { consume }, clientKey: "abc123" }));
    expect(consume).toHaveBeenCalledWith(`${LEAD_RATE_LIMIT.scope}:abc123`, { maxHits: LEAD_RATE_LIMIT.maxHits, windowSeconds: LEAD_RATE_LIMIT.windowSeconds });
    expect(repo.calls[0]).toBe("submitLead");
  });

  it("answers 429 once the limit is spent, without storing the request", async () => {
    const repo = fakeRepository();
    const result = await submitLead(VALID, dependencies({
      repository: repo.repository,
      rateLimiter: { async consume() { return { allowed: false, remaining: 0, retryAfterSeconds: 420 }; } },
    }));
    expect(result.status).toBe(429);
    expect(result.retryAfterSeconds).toBe(420);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: FORM_COPY.outcome.rateLimited });
    expect(repo.calls).toEqual([]);
  });

  it("counts every server instance against one shared budget", async () => {
    const shared = createMemoryRateLimiter();
    const repo = fakeRepository();
    const instanceA = dependencies({ repository: repo.repository, rateLimiter: shared });
    const instanceB = dependencies({ repository: repo.repository, rateLimiter: shared });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < LEAD_RATE_LIMIT.maxHits + 1; attempt += 1) {
      const result = await submitLead({ ...VALID, email: `parent${attempt}@example.com` }, attempt % 2 === 0 ? instanceA : instanceB);
      statuses.push(result.status);
    }
    expect(statuses).toEqual([...Array(LEAD_RATE_LIMIT.maxHits).fill(200), 429]);
  });

  it("fails closed with 503 when the limiter itself is unavailable", async () => {
    const repo = fakeRepository();
    const result = await submitLead(VALID, dependencies({
      repository: repo.repository,
      rateLimiter: { async consume() { throw new Error("connection refused"); } },
    }));
    expect(result.status).toBe(503);
    expect(result.body.persisted).toBe(false);
    expect(result.body.message).toBe(COPY.errorMessage);
    expect(repo.calls).toEqual([]);
  });

  it("refuses to run without a limiter while storage is configured", async () => {
    const result = await submitLead(VALID, dependencies({ rateLimiter: null }));
    expect(result.status).toBe(503);
    expect(result.body.persisted).toBe(false);
  });
});

describe("persistence comes first", () => {
  it("reports success only after the record is durably stored", async () => {
    let finishWrite: (value: { leadId: string; created: boolean }) => void = () => {};
    const repo = fakeRepository();
    const slowRepository: LeadRepository = {
      ...repo.repository,
      submitLead: () => new Promise((resolve) => { finishWrite = resolve; }),
    };
    let settled = false;
    const pending = submitLead(VALID, dependencies({ repository: slowRepository })).then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    finishWrite({ leadId: "lead-1", created: true });
    const result = await pending;
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, persisted: true, message: COPY.successMessage });
  });

  it("reports the CMS error, never success, when the write fails, and sends nothing", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const failing: LeadRepository = { ...repo.repository, submitLead: async () => { throw new Error("db down"); } };
    const result = await submitLead(VALID, dependencies({ repository: failing, mailer }));
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: COPY.errorMessage });
    expect(sent).toEqual([]);
    expect(repo.calls).toEqual([]);
  });

  it("stores the lead, then writes the outbox row, then attempts the email", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer();
    await submitLead(VALID, dependencies({ repository: repo.repository, mailer }));
    expect(repo.calls).toEqual(["submitLead", "enqueue:acknowledgement", "record:sent"]);
  });
});

describe("email outbox", () => {
  it("leaves the acknowledgement pending in the outbox when email is not configured", async () => {
    const repo = fakeRepository();
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, mailer: null }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(repo.event("acknowledgement")).toMatchObject({ status: "pending", attempts: 0 });
    expect(repo.calls).toEqual(["submitLead", "enqueue:acknowledgement"]);
  });

  it("marks the event sent with the provider id when Resend accepts the email", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer({ status: "sent", providerMessageId: "re_abc" });
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, mailer }));
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(repo.event("acknowledgement")).toMatchObject({ status: "sent", providerMessageId: "re_abc" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toEqual(["parent@example.com"]);
    expect(sent[0]?.idempotencyKey).toBe(`lead-delivery/${repo.event("acknowledgement")?.id}`);
  });

  it("still reports the signup stored when the email fails after persistence, and records the failure for retry", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer({ status: "failed", errorCode: "daily_quota_exceeded" });
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, mailer }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(repo.event("acknowledgement")).toMatchObject({ status: "failed", errorCode: "daily_quota_exceeded" });
  });

  it("treats a thrown send as a recorded failure, not a failed signup", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer(async () => { throw new Error("socket hang up for parent@example.com"); });
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, mailer }));
    expect(result.status).toBe(200);
    expect(result.body.persisted).toBe(true);
    expect(repo.event("acknowledgement")).toMatchObject({ status: "failed", errorCode: "send_exception" });
  });

  it("stops waiting for a hung email provider, records a timeout for retry and still reports the signup stored", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer(() => new Promise<EmailSendResult>(() => {}));
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, mailer, sendTimeoutMs: 25 }));
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(repo.event("acknowledgement")).toMatchObject({ status: "failed", errorCode: "send_timeout" });
  }, 2_000);

  it("says the acknowledgement is not queued when the outbox row could not be written, but keeps the stored signup", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const noOutbox: LeadRepository = { ...repo.repository, enqueueDelivery: async () => { throw new Error("outbox down"); } };
    const result = await submitLead(VALID, dependencies({ repository: noOutbox, mailer }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: false, message: COPY.successMessage });
    expect(sent).toEqual([]);
  });

  it("keeps the success when recording the attempt fails after the provider accepted the email", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer();
    const flaky: LeadRepository = { ...repo.repository, recordDeliveryAttempt: async () => { throw new Error("timeout"); } };
    const result = await submitLead(VALID, dependencies({ repository: flaky, mailer }));
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
  });
});

describe("duplicate normalised email", () => {
  it("updates one record for the same address in any case or spacing, answers the same way, and acknowledges once", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const deps = dependencies({ repository: repo.repository, mailer });
    const first = await submitLead({ ...VALID, email: "Ana@Example.com" }, deps);
    const second = await submitLead({ ...VALID, email: "  ana@EXAMPLE.com ", firstName: "Ana B" }, deps);
    expect(repo.leads.size).toBe(1);
    expect(repo.leads.get("ana@example.com")?.input.firstName).toBe("Ana B");
    // The answer never reveals whether the address was already on the list.
    expect(second).toEqual(first);
    expect(sent.filter((message) => message.to.includes("ana@example.com"))).toHaveLength(1);
  });
});

describe("staff alert", () => {
  it("queues and sends a generic staff alert through the same outbox when a staff address is set", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    await submitLead(VALID, dependencies({ repository: repo.repository, mailer, staffEmail: "team@bibobay.example" }));
    expect(repo.event("staff_alert")).toMatchObject({ status: "sent" });
    const alert = sent.find((message) => message.to.includes("team@bibobay.example"));
    expect(alert?.subject).toBe("New BIBO Bay founding-family signup");
    expect(alert?.subject).not.toContain("parent@example.com");
    expect(alert?.text).toContain("parent@example.com");
  });

  it("sends no staff alert without a staff address", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    await submitLead(VALID, dependencies({ repository: repo.repository, mailer, staffEmail: null }));
    expect(repo.event("staff_alert")).toBeUndefined();
    expect(sent).toHaveLength(1);
  });

  it("never lets a failed staff alert change what the adult is told", async () => {
    const repo = fakeRepository();
    const mailer: EmailSender = {
      async send(message) {
        return message.to.includes("team@bibobay.example") ? { status: "failed", errorCode: "application_error" } : { status: "sent", providerMessageId: "re_1" };
      },
    };
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, mailer, staffEmail: "team@bibobay.example" }));
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(repo.event("staff_alert")).toMatchObject({ status: "failed" });
  });
});

describe("truthful messages", () => {
  const outcomes: Array<[string, () => Promise<{ body: { message: string } }>]> = [
    ["stored, email sent", () => submitLead(VALID, dependencies({ mailer: fakeMailer().mailer }))],
    ["stored, email failed", () => submitLead(VALID, dependencies({ mailer: fakeMailer({ status: "failed", errorCode: "application_error" }).mailer }))],
    ["stored, email unconfigured", () => submitLead(VALID, dependencies())],
    ["invalid", () => submitLead({}, dependencies())],
    ["honeypot", () => submitLead({ ...VALID, website: "x" }, dependencies())],
    ["unconfigured", () => submitLead(VALID, dependencies({ repository: null }))],
    ["rate limited", () => submitLead(VALID, dependencies({ rateLimiter: { async consume() { return { allowed: false, remaining: 0, retryAfterSeconds: 60 }; } } }))],
  ];

  it.each(outcomes)("never claims an email was sent or a file is on its way (%s)", async (_label, run) => {
    const { body } = await run();
    expect(body.message.trim()).not.toBe("");
    expect(body.message).not.toMatch(DELIVERY_CLAIM);
  });

  it("logs outcomes without the adult's email or name", async () => {
    const log = vi.fn();
    const { mailer } = fakeMailer({ status: "failed", errorCode: "application_error" });
    await submitLead({ ...VALID, email: "secret.parent@example.com", firstName: "Zelda" }, dependencies({ mailer, log }));
    await submitLead({ ...VALID, email: "secret.parent@example.com" }, dependencies({ repository: { ...fakeRepository().repository, submitLead: async () => { throw new Error("insert failed for secret.parent@example.com"); } }, log }));
    const logged = JSON.stringify(log.mock.calls);
    expect(log).toHaveBeenCalled();
    expect(logged).not.toContain("secret.parent");
    expect(logged).not.toContain("Zelda");
  });
});
