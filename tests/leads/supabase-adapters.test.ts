import { describe, expect, it, vi } from "vitest";

import { getSupabaseAdminEnvironment } from "@/lib/supabase/admin";
import { createSupabaseLeadRepository } from "@/lib/supabase/leads";
import { getSupabasePublicEnvironment } from "@/lib/supabase/server";
import type { RpcClient } from "@/lib/security/rate-limit";

vi.mock("server-only", () => ({}));

function fakeRpc(responses: Record<string, { data: unknown; error: { code?: string; message: string } | null }>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client: RpcClient = {
    rpc(fn, args) {
      calls.push([fn, args]);
      const response = responses[fn];
      if (!response) throw new Error(`unexpected rpc ${fn}`);
      return Promise.resolve(response);
    },
  };
  return { client, calls };
}

const RECORD = {
  email: "parent@example.com",
  firstName: "Ana",
  ageBand: "3-5" as const,
  consentVersion: "4",
  source: "landing",
  locale: "en-AU",
  utm: { campaign: "founding" },
};

describe("Supabase lead repository (service-role RPCs only)", () => {
  it("stores a lead through submit_lead with bounded, named arguments", async () => {
    const { client, calls } = fakeRpc({ submit_lead: { data: [{ lead_id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", created: true }], error: null } });
    const result = await createSupabaseLeadRepository(client).submitLead(RECORD);
    expect(calls).toEqual([["submit_lead", {
      p_email: "parent@example.com",
      p_consent: true,
      p_consent_version: "4",
      p_first_name: "Ana",
      p_age_band: "3-5",
      p_source: "landing",
      p_locale: "en-AU",
      p_utm: { campaign: "founding" },
    }]]);
    expect(result).toEqual({ leadId: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", created: true });
  });

  it("sends null for optional details the adult left out", async () => {
    const { client, calls } = fakeRpc({ submit_lead: { data: { lead_id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", created: false }, error: null } });
    await createSupabaseLeadRepository(client).submitLead({ email: "parent@example.com", consentVersion: "1", source: "landing" });
    expect(calls[0]?.[1]).toMatchObject({ p_first_name: null, p_age_band: null, p_locale: null, p_utm: {} });
  });

  it("throws an error naming only the RPC and database code, never the submitted values", async () => {
    const { client } = fakeRpc({ submit_lead: { data: null, error: { code: "22023", message: "invalid email parent@example.com" } } });
    const failure = await createSupabaseLeadRepository(client).submitLead(RECORD).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).toContain("submit_lead");
    expect(String((failure as Error).message)).toContain("22023");
    expect(String((failure as Error).message)).not.toContain("parent@example.com");
  });

  it("refuses an answer that is not a lead id and a created flag", async () => {
    const { client } = fakeRpc({ submit_lead: { data: [{ lead_id: 7 }], error: null } });
    await expect(createSupabaseLeadRepository(client).submitLead(RECORD)).rejects.toThrow(/submit_lead/);
  });

  it("writes an outbox row through enqueue_lead_delivery, claiming it when it will send at once", async () => {
    const { client, calls } = fakeRpc({ enqueue_lead_delivery: { data: [{ event_id: "9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f", status: "sending", created: true }], error: null } });
    const result = await createSupabaseLeadRepository(client).enqueueDelivery("4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", "acknowledgement", { claim: true });
    expect(calls).toEqual([["enqueue_lead_delivery", { p_lead_id: "4f8c1c1e-1b51-4a43-9d1c-0d7c1d1f1a11", p_kind: "acknowledgement", p_claim: true }]]);
    expect(result).toEqual({ eventId: "9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f", status: "sending", created: true });
  });

  it("records a delivery outcome through record_lead_delivery_attempt", async () => {
    const { client, calls } = fakeRpc({ record_lead_delivery_attempt: { data: true, error: null } });
    const repository = createSupabaseLeadRepository(client);
    await repository.recordDeliveryAttempt("9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f", { status: "sent", providerMessageId: "re_123" });
    await repository.recordDeliveryAttempt("9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f", { status: "failed", errorCode: "daily_quota_exceeded" });
    expect(calls).toEqual([
      ["record_lead_delivery_attempt", { p_event_id: "9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f", p_status: "sent", p_provider_message_id: "re_123", p_error_code: null }],
      ["record_lead_delivery_attempt", { p_event_id: "9d7c2a10-7a8b-4c4e-8c0f-1a2b3c4d5e6f", p_status: "failed", p_provider_message_id: null, p_error_code: "daily_quota_exceeded" }],
    ]);
  });
});

describe("Supabase environment", () => {
  it("is unconfigured without a project URL and a server key", () => {
    expect(getSupabaseAdminEnvironment({})).toBeNull();
    expect(getSupabaseAdminEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" })).toBeNull();
    expect(getSupabaseAdminEnvironment({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc" })).toBeNull();
  });

  it("reads the project URL and the server-only key", () => {
    expect(getSupabaseAdminEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: " sb_secret_abc " })).toEqual({ url: "https://abc.supabase.co", serviceRoleKey: "sb_secret_abc" });
  });

  it("refuses a publishable key where the server key belongs", () => {
    expect(getSupabaseAdminEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_abc" })).toBeNull();
  });

  it.each(["http://abc.supabase.co", "ftp://abc.supabase.co", "not a url", "https://user:pass@abc.supabase.co"])("refuses the project URL %j", (url) => {
    expect(getSupabaseAdminEnvironment({ NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc" })).toBeNull();
  });

  it("allows plain http only for a local Supabase stack", () => {
    expect(getSupabaseAdminEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc" })?.url).toBe("http://127.0.0.1:54321");
  });

  it("gives public configuration only the publishable key, never a secret one", () => {
    expect(getSupabasePublicEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc" })).toEqual({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_abc" });
    expect(getSupabasePublicEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abc" })).toBeNull();
  });
});
