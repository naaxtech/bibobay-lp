import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FORM_COPY } from "@/components/forms/form-copy";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";
import { BOT_CHECK_MESSAGES, type BotCheckAction } from "@/lib/bot-check/fields";
import type { BotCheck } from "@/lib/bot-check/gate";
import type { BotCheckVerdict } from "@/lib/bot-check/turnstile";
import type { EmailMessage, EmailSender, EmailSendResult } from "@/lib/email/client";
import type { DeliveryKind, LeadRecordInput, LeadRepository } from "@/lib/leads/submit";
import * as leadSubmitModule from "@/lib/leads/submit";
import { ACK_SEND_LIMIT, LEAD_RATE_LIMIT, LEAD_SIGNUPS_CLOSED_MESSAGE, submitLead, type LeadSubmissionDependencies } from "@/lib/leads/submit";
import type { ClaimedLeadDelivery, OutboxOutcome } from "@/lib/outbox/types";
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

interface StoredEvent { id: string; leadId: string; kind: DeliveryKind; status: "pending" | "sending" | "sent" | "failed" | "skipped"; attempts: number; providerMessageId?: string; errorCode?: string }

interface StoredLead {
  id: string;
  /** What the first signup stored. Ruling R38: a later, unverified submission never changes it. */
  input: LeadRecordInput;
  consentState: "granted" | "withdrawn";
  /** Bookkeeping that a repeat submission may set (migration 0001 `last_submitted_at`, `rejoin_requested_at`). */
  lastSubmittedAt?: number;
  rejoinRequestedAt?: number;
}

/**
 * An in-memory stand-in for the Supabase repository, logging each call in order. It models
 * migrations 0001 and 0006 exactly: one row per normalised email; on a conflicting email only the
 * bookkeeping columns change (ruling R38); one outbox row per lead and kind; an acknowledgement for
 * a withdrawn adult is never claimed for an immediate send; and the claim (migration 0006) takes
 * due rows only, counts the attempt, skips every kind of a withdrawn lead (R92) and hands each row
 * to one caller only.
 */
function fakeRepository() {
  const calls: string[] = [];
  const leads = new Map<string, StoredLead>();
  const events = new Map<string, StoredEvent>();
  let clock = 0;
  const repository: LeadRepository = {
    async submitLead(input) {
      calls.push("submitLead");
      clock += 1;
      const existing = leads.get(input.email);
      if (existing) {
        existing.lastSubmittedAt = clock;
        if (existing.consentState === "withdrawn") existing.rejoinRequestedAt = clock;
        return { leadId: existing.id, created: false };
      }
      const id = `lead-${leads.size + 1}`;
      leads.set(input.email, { id, input, consentState: "granted" });
      return { leadId: id, created: true };
    },
    async enqueueDelivery(leadId, kind, { claim }) {
      calls.push(`enqueue:${kind}`);
      const key = `${leadId}:${kind}`;
      const existing = events.get(key);
      if (existing) return { eventId: existing.id, status: existing.status, created: false };
      const withdrawn = [...leads.values()].some((lead) => lead.id === leadId && lead.consentState === "withdrawn");
      const claimed = claim && !withdrawn;
      const event: StoredEvent = { id: `event-${events.size + 1}`, leadId, kind, status: claimed ? "sending" : "pending", attempts: claimed ? 1 : 0 };
      events.set(key, event);
      return { eventId: event.id, status: event.status, created: true };
    },
    async claimDeliveries({ ownerId, kinds, limit }) {
      calls.push(`claim:${kinds.join("+")}`);
      const due = [...events.values()]
        .filter((event) => (!ownerId || event.leadId === ownerId) && kinds.includes(event.kind) && (event.status === "pending" || event.status === "failed"))
        .slice(0, limit);
      let skipped = 0;
      const claimed: ClaimedLeadDelivery[] = [];
      for (const event of due) {
        const lead = [...leads.values()].find((entry) => entry.id === event.leadId)!;
        if (lead.consentState === "withdrawn") {
          event.status = "skipped";
          skipped += 1;
          continue;
        }
        event.status = "sending";
        event.attempts += 1;
        claimed.push({ id: event.id, kind: event.kind, attempt: event.attempts, email: lead.input.email, firstName: lead.input.firstName ?? null, ageBand: lead.input.ageBand ?? null, source: lead.input.source });
      }
      return { claimed, skipped, expired: 0 };
    },
    async recordDeliveryAttempt(eventId, outcome: OutboxOutcome) {
      calls.push(`record:${outcome.status}`);
      const event = [...events.values()].find((entry) => entry.id === eventId);
      if (!event) throw new Error("unknown event");
      if (event.status !== "sending") return false;
      if (outcome.status === "deferred") {
        event.attempts -= 1;
        event.status = event.attempts === 0 ? "pending" : "failed";
        return true;
      }
      event.status = outcome.status;
      if (outcome.status === "sent") event.providerMessageId = outcome.providerMessageId;
      else event.errorCode = outcome.errorCode;
      return true;
    },
  };
  /** A lead that is already on the list (as staff or an earlier signup left it), with no outbox rows. */
  const seed = (input: LeadRecordInput, consentState: StoredLead["consentState"]) => {
    const lead: StoredLead = { id: `lead-${leads.size + 1}`, input, consentState };
    leads.set(input.email, lead);
    return lead;
  };
  return { repository, calls, leads, events, seed, event: (kind: DeliveryKind) => [...events.values()].find((entry) => entry.kind === kind) };
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
    download: null,
    replyTo: null,
    log: () => {},
    // P-I1 (Ruling R125): a way to ask for removal exists; tests of the closed state pass null.
    removalChannel: { kind: "contact", email: "hello@bibobay.example" },
    botCheck: { state: "off" },
    ...overrides,
  };
}

const VALID = { email: "Parent@Example.com", consent: true, firstName: "Ana", ageBand: "3-5" };

const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function verifierReturning(verdict: BotCheckVerdict) {
  const verify = vi.fn(async (_token: string | undefined, _action: BotCheckAction): Promise<BotCheckVerdict> => verdict);
  const botCheck: BotCheck = { state: "on", verifier: { verify } };
  return { verify, botCheck };
}

describe("bot check (R215, R216, R219)", () => {
  it("is skipped when off: a signup with no token is stored", async () => {
    const repo = fakeRepository();
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, botCheck: { state: "off" } }));
    expect(result.status).toBe(200);
    expect(repo.calls).toContain("submitLead");
  });

  it("refused gives 403, and nothing is counted or stored", async () => {
    const repo = fakeRepository();
    const consume = vi.fn(allowAll.consume);
    const log = vi.fn();
    const { verify, botCheck } = verifierReturning({ outcome: "refused", reason: "rejected" });
    const result = await submitLead({ ...VALID, botCheckToken: TOKEN }, dependencies({ repository: repo.repository, rateLimiter: { consume }, botCheck, log }));
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: BOT_CHECK_MESSAGES.refused });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(consume).not.toHaveBeenCalled();
    expect(repo.calls).toEqual([]);
    expect(log).toHaveBeenCalledWith({ event: "lead_bot_check_refused", reason: "rejected" });
  });

  it("unavailable gives 503 and a reported event", async () => {
    const repo = fakeRepository();
    const consume = vi.fn(allowAll.consume);
    const log = vi.fn();
    const { botCheck } = verifierReturning({ outcome: "unavailable", reason: "timeout" });
    const result = await submitLead({ ...VALID, botCheckToken: TOKEN }, dependencies({ repository: repo.repository, rateLimiter: { consume }, botCheck, log }));
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: BOT_CHECK_MESSAGES.unavailable });
    expect(consume).not.toHaveBeenCalled();
    expect(repo.calls).toEqual([]);
    expect(log).toHaveBeenCalledWith({ event: "lead_bot_check_unavailable", reason: "timeout" });
  });

  it("misconfigured gives 503 and a reported event", async () => {
    const repo = fakeRepository();
    const log = vi.fn();
    const result = await submitLead({ ...VALID, botCheckToken: TOKEN }, dependencies({ repository: repo.repository, botCheck: { state: "misconfigured", problem: "half" }, log }));
    expect(result.status).toBe(503);
    expect(result.body.message).toBe(BOT_CHECK_MESSAGES.unavailable);
    expect(repo.calls).toEqual([]);
    expect(log).toHaveBeenCalledWith({ event: "lead_bot_check_unconfigured", reason: "half" });
  });

  it("is not asked for a honeypot hit, a validation failure or a missing removal channel", async () => {
    const { verify, botCheck } = verifierReturning({ outcome: "passed" });
    await submitLead({ ...VALID, website: "x", botCheckToken: TOKEN }, dependencies({ botCheck }));
    await submitLead({ email: "nope", consent: false, botCheckToken: TOKEN }, dependencies({ botCheck }));
    await submitLead({ ...VALID, botCheckToken: TOKEN }, dependencies({ botCheck, removalChannel: null }));
    await submitLead({ ...VALID, botCheckToken: TOKEN }, dependencies({ botCheck, repository: null }));
    expect(verify).not.toHaveBeenCalled();
  });

  it("passed proceeds: verified once for the lead action, before the rate limit, and the token goes nowhere else", async () => {
    const repo = fakeRepository();
    const order: string[] = [];
    const consume = vi.fn(async () => {
      order.push("consume");
      return { allowed: true, remaining: 4, retryAfterSeconds: 0 };
    });
    const verify = vi.fn(async (_token: string | undefined, _action: BotCheckAction): Promise<BotCheckVerdict> => {
      order.push("verify");
      return { outcome: "passed" };
    });
    const submitSpy = vi.spyOn(repo.repository, "submitLead");
    const log = vi.fn();
    const result = await submitLead({ ...VALID, botCheckToken: TOKEN }, dependencies({ repository: repo.repository, rateLimiter: { consume }, botCheck: { state: "on", verifier: { verify } }, log }));
    expect(result.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(TOKEN, "lead");
    expect(order.slice(0, 2)).toEqual(["verify", "consume"]);
    const stored = submitSpy.mock.calls[0]![0];
    expect(Object.keys(stored)).not.toContain("botCheckToken");
    expect(JSON.stringify(stored)).not.toContain(TOKEN);
    expect(JSON.stringify(stored)).not.toContain("botCheckToken");
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(log.mock.calls)).not.toContain("botCheckToken");
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
  });

  it("a refusal's log entry does not carry the token", async () => {
    const log = vi.fn();
    const { botCheck } = verifierReturning({ outcome: "refused", reason: "missing_token" });
    await submitLead({ ...VALID, botCheckToken: TOKEN }, dependencies({ botCheck, log }));
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });
});

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

describe("a real way to ask for removal (P-I1, Ruling R125)", () => {
  it("answers 503 with the honest closed message, and stores, limits and sends nothing, while no removal channel exists", async () => {
    const repo = fakeRepository();
    const consume = vi.fn(allowAll.consume);
    const { mailer, sent } = fakeMailer();
    const log = vi.fn();
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, rateLimiter: { consume }, mailer, removalChannel: null, log }));
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, persisted: false, acknowledgementQueued: false, message: LEAD_SIGNUPS_CLOSED_MESSAGE });
    expect(repo.calls).toEqual([]);
    expect(consume).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledWith({ event: "lead_removal_channel_unconfigured" });
  });

  it("says plainly that signups are not open and nothing was saved, and promises nothing", () => {
    expect(LEAD_SIGNUPS_CLOSED_MESSAGE).toMatch(/not open/i);
    expect(LEAD_SIGNUPS_CLOSED_MESSAGE).toMatch(/nothing was saved/i);
    expect(LEAD_SIGNUPS_CLOSED_MESSAGE).not.toMatch(DELIVERY_CLAIM);
    expect(LEAD_SIGNUPS_CLOSED_MESSAGE).not.toMatch(/unsubscribe|remove|reply/i);
  });

  it.each([
    ["the acknowledgement email (email sending configured)", { kind: "email" as const }],
    ["a contact address", { kind: "contact" as const, email: "hello@bibobay.example" }],
  ])("stores the signup when the removal channel is %s", async (_label, removalChannel) => {
    const repo = fakeRepository();
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, removalChannel }));
    expect(result.status).toBe(200);
    expect(result.body.persisted).toBe(true);
    expect(repo.leads.size).toBe(1);
  });

  it("still validates first, and still says storage is unavailable first when it is", async () => {
    expect((await submitLead({ consent: true }, dependencies({ removalChannel: null }))).status).toBe(400);
    expect((await submitLead(VALID, dependencies({ repository: null, removalChannel: null }))).body.message).toBe(COPY.errorMessage);
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

  // Whether separate server instances share this budget depends on the limiter: the Supabase one
  // keeps it in the database (consume_rate_limit; supabase/tests/0001_leads_rls.sql checks one bucket).
  it("refuses the signup past the lead limit for one client, even with a new email each time", async () => {
    const limiter = createMemoryRateLimiter();
    const repo = fakeRepository();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < LEAD_RATE_LIMIT.maxHits + 1; attempt += 1) {
      const result = await submitLead({ ...VALID, email: `parent${attempt}@example.com` }, dependencies({ repository: repo.repository, rateLimiter: limiter }));
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

  it("stores the lead, then writes the outbox row, then claims it through the shared claim and attempts the email (R88)", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer();
    await submitLead(VALID, dependencies({ repository: repo.repository, mailer }));
    expect(repo.calls).toEqual(["submitLead", "enqueue:acknowledgement", "claim:acknowledgement", "record:sent"]);
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

  it("claims only the rows this signup wrote: none for a kind whose outbox row could not be written", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer();
    const noAlertRow: LeadRepository = {
      ...repo.repository,
      enqueueDelivery: async (leadId, kind, options) => {
        if (kind === "staff_alert") throw new Error("outbox down");
        return repo.repository.enqueueDelivery(leadId, kind, options);
      },
    };
    await submitLead(VALID, dependencies({ repository: noAlertRow, mailer, staffEmail: "team@bibobay.example" }));
    expect(repo.calls.filter((call) => call.startsWith("claim:"))).toEqual(["claim:acknowledgement"]);
  });

  it("keeps the success when recording the attempt fails after the provider accepted the email", async () => {
    const repo = fakeRepository();
    const { mailer } = fakeMailer();
    const flaky: LeadRepository = { ...repo.repository, recordDeliveryAttempt: async () => { throw new Error("timeout"); } };
    const result = await submitLead(VALID, dependencies({ repository: flaky, mailer }));
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
  });
});

describe("duplicate normalised email (ruling R38)", () => {
  it("keeps one record for the same address in any case or spacing, changes none of it, answers the same way, and acknowledges once", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const deps = dependencies({ repository: repo.repository, mailer });
    const first = await submitLead({ ...VALID, email: "Ana@Example.com", utm: { campaign: "spring" } }, deps);
    const second = await submitLead({ ...VALID, email: "  ana@EXAMPLE.com ", firstName: "Mallory", ageBand: "9-12", source: "promo", utm: { source: "forged" } }, { ...deps, consentVersion: "8" });
    expect(repo.leads.size).toBe(1);
    // The form cannot prove who owns the address, so nothing about the person changes.
    expect(repo.leads.get("ana@example.com")).toMatchObject({
      consentState: "granted",
      input: { email: "ana@example.com", firstName: "Ana", ageBand: "3-5", consentVersion: "7", source: "landing", utm: { campaign: "spring" } },
      lastSubmittedAt: 2,
    });
    expect(repo.leads.get("ana@example.com")?.rejoinRequestedAt).toBeUndefined();
    // The answer never reveals whether the address was already on the list.
    expect(second).toEqual(first);
    expect(sent.filter((message) => message.to.includes("ana@example.com"))).toHaveLength(1);
  });

  it("never re-subscribes or emails an adult who withdrew, and answers exactly as for anyone already listed", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const deps = dependencies({ repository: repo.repository, mailer, staffEmail: "team@bibobay.example" });
    const stored = { email: "gone@example.com", firstName: "Alex", consentVersion: "1", source: "landing" };
    repo.seed(stored, "withdrawn");
    repo.seed({ email: "listed@example.com", consentVersion: "1", source: "landing" }, "granted");

    const withdrawn = await submitLead({ ...VALID, email: "Gone@Example.com", firstName: "Mallory" }, deps);
    const listed = await submitLead({ ...VALID, email: "listed@example.com" }, deps);

    expect(withdrawn).toEqual(listed);
    expect(withdrawn.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(repo.leads.get("gone@example.com")).toMatchObject({ consentState: "withdrawn", input: stored, lastSubmittedAt: 1, rejoinRequestedAt: 1 });
    // Nothing goes out now: the acknowledgement waits unclaimed, and the Task 8 worker skips withdrawn leads.
    expect(sent.filter((message) => message.to.includes("gone@example.com"))).toEqual([]);
    expect([...repo.events.values()].filter((event) => event.leadId === repo.leads.get("gone@example.com")?.id).map((event) => event.status)).toEqual(["pending", "pending"]);
  });

  it("never sends immediately for an address that was already listed, so a resubmission cannot spend the send budget", async () => {
    const repo = fakeRepository();
    repo.seed({ email: "parent@example.com", consentVersion: "1", source: "landing" }, "granted");
    const { mailer, sent } = fakeMailer();
    const consume = vi.fn(allowAll.consume);
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, rateLimiter: { consume }, mailer, staffEmail: "team@bibobay.example" }));
    expect(result.body.acknowledgementQueued).toBe(true);
    expect(sent).toEqual([]);
    expect(consume.mock.calls.map(([key]) => key)).toEqual([`${LEAD_RATE_LIMIT.scope}:client-hash`]);
    expect([...repo.events.values()].map((event) => event.status)).toEqual(["pending", "pending"]);
  });
});

describe("immediate-send budgets, one per message kind (ruling R40, fix wave D-I1)", () => {
  /** A limiter that allows the lead rule but records every key it is asked about. */
  function recordingLimiter(decide: (key: string) => boolean | Error = () => true) {
    const keys: Array<[string, { maxHits: number; windowSeconds: number }]> = [];
    const limiter: RateLimiter = {
      async consume(key, rule) {
        keys.push([key, rule]);
        const verdict = decide(key);
        if (verdict instanceof Error) throw verdict;
        return verdict ? { allowed: true, remaining: 1, retryAfterSeconds: 0 } : { allowed: false, remaining: 0, retryAfterSeconds: 900 };
      },
    };
    return { limiter, keys };
  }

  it("asks the shared limiter for one send under the acknowledgement's own bucket, send:lead_acknowledgement, 60 per hour by default", async () => {
    const { limiter, keys } = recordingLimiter();
    await submitLead(VALID, dependencies({ rateLimiter: limiter, mailer: fakeMailer().mailer }));
    expect(keys).toEqual([
      [`${LEAD_RATE_LIMIT.scope}:client-hash`, { maxHits: LEAD_RATE_LIMIT.maxHits, windowSeconds: LEAD_RATE_LIMIT.windowSeconds }],
      ["send:lead_acknowledgement", { maxHits: 60, windowSeconds: 3600 }],
    ]);
    expect(ACK_SEND_LIMIT.defaultPerHour).toBe(60);
  });

  it("uses the configured hourly cap, per kind: the staff alert has its own bucket, send:lead_staff_alert", async () => {
    const { limiter, keys } = recordingLimiter();
    await submitLead(VALID, dependencies({ rateLimiter: limiter, mailer: fakeMailer().mailer, staffEmail: "team@bibobay.example", sendLimitPerHour: 7 }));
    expect(keys.slice(1).sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ["send:lead_acknowledgement", { maxHits: 7, windowSeconds: 3600 }],
      ["send:lead_staff_alert", { maxHits: 7, windowSeconds: 3600 }],
    ]);
  });

  it("stores the lead and leaves the acknowledgement pending once the cap is spent, with the same answer", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const log = vi.fn();
    const deps = dependencies({ repository: repo.repository, rateLimiter: createMemoryRateLimiter(), mailer, sendLimitPerHour: 1, log });
    const first = await submitLead({ ...VALID, email: "first@example.com" }, deps);
    const second = await submitLead({ ...VALID, email: "second@example.com" }, deps);
    expect(second).toEqual(first);
    expect(second.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(repo.leads.size).toBe(2);
    expect(sent.map((message) => message.to)).toEqual([["first@example.com"]]);
    const secondLead = repo.leads.get("second@example.com")?.id;
    expect([...repo.events.values()].find((event) => event.leadId === secondLead)).toMatchObject({ kind: "acknowledgement", status: "pending", attempts: 0 });
    expect(log).toHaveBeenCalledWith({ event: "delivery_send_capped", kind: "acknowledgement", budget: "lead_acknowledgement" });
  });

  it("counts staff alerts against their own cap, not the acknowledgements' (D-I1), leaving them pending beyond it", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const deps = dependencies({ repository: repo.repository, rateLimiter: createMemoryRateLimiter(), mailer, staffEmail: "team@bibobay.example", sendLimitPerHour: 1 });
    await submitLead(VALID, deps);
    expect(sent.map((message) => message.to).sort()).toEqual([["parent@example.com"], ["team@bibobay.example"]]);
    expect(repo.event("acknowledgement")).toMatchObject({ status: "sent" });
    expect(repo.event("staff_alert")).toMatchObject({ status: "sent" });

    await submitLead({ ...VALID, email: "second@example.com" }, deps);
    const second = repo.leads.get("second@example.com")?.id;
    expect([...repo.events.values()].filter((event) => event.leadId === second).map((event) => [event.kind, event.status, event.attempts])).toEqual([
      ["acknowledgement", "pending", 0],
      ["staff_alert", "pending", 0],
    ]);
    expect(sent).toHaveLength(2);
  });

  it("a spent acknowledgement budget never holds up the staff alert (D-I1)", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const { limiter } = recordingLimiter((key) => key !== "send:lead_acknowledgement");
    await submitLead(VALID, dependencies({ repository: repo.repository, rateLimiter: limiter, mailer, staffEmail: "team@bibobay.example" }));
    expect(sent.map((message) => message.to)).toEqual([["team@bibobay.example"]]);
    expect(repo.event("acknowledgement")).toMatchObject({ status: "pending", attempts: 0 });
    expect(repo.event("staff_alert")).toMatchObject({ status: "sent" });
  });

  it("leaves the email pending, and still reports the stored signup, when the send budget cannot be checked", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const { limiter } = recordingLimiter((key) => (key === "send:lead_acknowledgement" ? new Error("connection refused") : true));
    const log = vi.fn();
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, rateLimiter: limiter, mailer, log }));
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(sent).toEqual([]);
    expect(repo.event("acknowledgement")).toMatchObject({ status: "pending" });
    expect(log).toHaveBeenCalledWith({ event: "delivery_send_cap_unavailable", kind: "acknowledgement", budget: "lead_acknowledgement", code: "unknown" });
  });

  it("spends no send budget while email is not configured", async () => {
    const { limiter, keys } = recordingLimiter();
    await submitLead(VALID, dependencies({ rateLimiter: limiter, mailer: null, staffEmail: "team@bibobay.example" }));
    expect(keys.map(([key]) => key)).toEqual([`${LEAD_RATE_LIMIT.scope}:client-hash`]);
  });
});

describe("sending without holding up the answer (M4)", () => {
  it("writes the outbox rows unclaimed, answers, and only then claims and sends when sends can run after the response (R88)", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const deferred: Array<() => Promise<void>> = [];
    const result = await submitLead(VALID, dependencies({
      repository: repo.repository,
      mailer,
      staffEmail: "team@bibobay.example",
      runAfterResponse: (task) => { deferred.push(task); },
    }));
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: true, message: COPY.successMessage });
    expect(sent).toEqual([]);
    expect(repo.calls).toEqual(["submitLead", "enqueue:acknowledgement", "enqueue:staff_alert"]);
    expect([...repo.events.values()].map((event) => event.status)).toEqual(["pending", "pending"]);
    expect(deferred).toHaveLength(1);

    await deferred[0]!();
    expect(sent.map((message) => message.to).sort()).toEqual([["parent@example.com"], ["team@bibobay.example"]]);
    expect([...repo.events.values()].map((event) => event.status)).toEqual(["sent", "sent"]);
    expect([...repo.events.values()].map((event) => event.attempts)).toEqual([1, 1]);
  });

  it("checks the global send budget only after the answer, so a new address and a listed one do the same work before it (N1)", async () => {
    const repo = fakeRepository();
    repo.seed({ email: "listed@example.com", consentVersion: "1", source: "landing" }, "granted");
    const consume = vi.fn(allowAll.consume);
    const deferred: Array<() => Promise<void>> = [];
    const deps = dependencies({ repository: repo.repository, rateLimiter: { consume }, mailer: fakeMailer().mailer, staffEmail: "team@bibobay.example", runAfterResponse: (task) => { deferred.push(task); } });

    await submitLead({ ...VALID, email: "new@example.com" }, deps);
    const beforeNew = { calls: [...repo.calls], keys: consume.mock.calls.map(([key]) => key) };
    repo.calls.length = 0;
    consume.mockClear();
    await submitLead({ ...VALID, email: "listed@example.com" }, deps);
    const beforeListed = { calls: [...repo.calls], keys: consume.mock.calls.map(([key]) => key) };

    expect(beforeNew).toEqual(beforeListed);
    expect(beforeNew.keys).toEqual([`${LEAD_RATE_LIMIT.scope}:client-hash`]);
    // Only the new signup has anything to send after its answer, and only then is the budget spent.
    expect(deferred).toHaveLength(1);
    consume.mockClear();
    await deferred[0]!();
    expect(consume.mock.calls.map(([key]) => key).sort()).toEqual(["send:lead_acknowledgement", "send:lead_staff_alert"]);
  });

  it("sends nothing after the answer for a row the outbox worker claimed first (no double send)", async () => {
    const repo = fakeRepository();
    const { mailer, sent } = fakeMailer();
    const deferred: Array<() => Promise<void>> = [];
    await submitLead(VALID, dependencies({ repository: repo.repository, mailer, runAfterResponse: (task) => { deferred.push(task); } }));
    // The worker's claim takes the row between the answer and the after-response task.
    await repo.repository.claimDeliveries({ kinds: ["acknowledgement"], limit: 50 });
    await deferred[0]!();
    expect(sent).toEqual([]);
    expect(repo.event("acknowledgement")).toMatchObject({ status: "sending", attempts: 1 });
  });

  it("sends the acknowledgement and the staff alert at the same time, not one after the other", async () => {
    const releases: Array<() => void> = [];
    const mailer: EmailSender = {
      send: () => new Promise<EmailSendResult>((resolve) => { releases.push(() => resolve({ status: "sent", providerMessageId: "re_1" })); }),
    };
    const pending = submitLead(VALID, dependencies({ mailer, staffEmail: "team@bibobay.example" }));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.forEach((release) => release());
    expect((await pending).status).toBe(200);
  });

  it("aborts the provider request when a send times out", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const mailer: EmailSender = {
      send: (_message, options) => {
        signals.push(options?.signal);
        return new Promise<EmailSendResult>(() => {});
      },
    };
    const repo = fakeRepository();
    await submitLead(VALID, dependencies({ repository: repo.repository, mailer, sendTimeoutMs: 25 }));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(repo.event("acknowledgement")).toMatchObject({ status: "failed", errorCode: "send_timeout" });
  }, 2_000);
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

  it("never sets the submitted, unverified address as the staff alert's reply-to, and labels it unverified", async () => {
    const { mailer, sent } = fakeMailer();
    await submitLead(VALID, dependencies({ mailer, staffEmail: "team@bibobay.example", replyTo: "hello@bibobay.example" }));
    const alert = sent.find((message) => message.to.includes("team@bibobay.example"));
    expect(alert).toBeDefined();
    expect(alert).not.toHaveProperty("replyTo");
    expect(alert?.text).toMatch(/Submitted address \(unverified\)\s+parent@example\.com/);
  });

  it("queues the staff alert even while email is not configured, as it does the acknowledgement", async () => {
    const repo = fakeRepository();
    const result = await submitLead(VALID, dependencies({ repository: repo.repository, mailer: null, staffEmail: "team@bibobay.example" }));
    expect(result.body.acknowledgementQueued).toBe(true);
    expect(repo.event("staff_alert")).toMatchObject({ status: "pending", attempts: 0 });
    expect(repo.calls).toEqual(["submitLead", "enqueue:acknowledgement", "enqueue:staff_alert"]);
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
    ["no removal channel", () => submitLead(VALID, dependencies({ removalChannel: null }))],
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

describe("the pre-outbox flow (Task 5 re-review N3)", () => {
  it("is no longer exported: it would send with an always-allow limiter, past the global cap", () => {
    expect(Object.keys(leadSubmitModule)).not.toContain("deliverSequentially");
  });

  it("is kept in the source, marked deprecated, with its reason", () => {
    const source = readFileSync(resolve("lib/leads/submit.ts"), "utf8");
    expect(source).toMatch(/@deprecated[^]*?async function deliverSequentially\(/);
    expect(source).not.toMatch(/export async function deliverSequentially/);
  });
});

describe("the download link in the answer (R140)", () => {
  const DOWNLOAD = { url: "/api/freebies/download?t=abc", title: "Bibo Bay Activity Pack" };

  it("carries exactly the configured download on a stored signup", async () => {
    const result = await submitLead(VALID, dependencies({ download: DOWNLOAD }));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, persisted: true, acknowledgementQueued: expect.any(Boolean), message: COPY.successMessage, download: DOWNLOAD });
  });

  it("has no download key when none is configured", async () => {
    const result = await submitLead(VALID, dependencies({ download: null }));
    expect(result.status).toBe(200);
    expect("download" in result.body).toBe(false);
  });

  it("never carries it on a refusal", async () => {
    const download = DOWNLOAD;
    const invalid = await submitLead({ consent: true }, dependencies({ download }));
    const closed = await submitLead(VALID, dependencies({ download, repository: null }));
    const limited = await submitLead(VALID, dependencies({ download, rateLimiter: { async consume() { return { allowed: false, remaining: 0, retryAfterSeconds: 30 }; } } }));
    const failing = fakeRepository();
    failing.repository.submitLead = async () => { throw new Error("write failed"); };
    const failed = await submitLead(VALID, dependencies({ download, repository: failing.repository }));
    expect([invalid.status, closed.status, limited.status, failed.status]).toEqual([400, 503, 429, 500]);
    for (const result of [invalid, closed, limited, failed]) expect("download" in result.body).toBe(false);
  });
});
