import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createBotCheck, runBotCheck, type BotCheck } from "@/lib/bot-check/gate";
import type { BotCheckVerdict, BotCheckVerifier } from "@/lib/bot-check/turnstile";

const SITE = "NEXT_PUBLIC_TURNSTILE_SITE_KEY";
const SECRET = "TURNSTILE_SECRET_KEY";

function stub(verdict: BotCheckVerdict) {
  const verify = vi.fn(async () => verdict);
  const verifier: BotCheckVerifier = { verify };
  const check: BotCheck = { state: "on", verifier };
  return { check, verify };
}

describe("createBotCheck", () => {
  it("is off with no keys", () => {
    expect(createBotCheck({})).toEqual({ state: "off" });
  });

  it("is misconfigured with one key", () => {
    expect(createBotCheck({ [SITE]: "0x4AAAAAAAreal_site-key01" })).toEqual({ state: "misconfigured" });
  });

  it("is on with a verifier when both keys are valid", () => {
    const check = createBotCheck({
      [SITE]: "0x4AAAAAAAreal_site-key01",
      [SECRET]: "0x4AAAAAAAreal_secret-key-0123456789",
    });
    expect(check.state).toBe("on");
    expect(check.state === "on" && typeof check.verifier.verify).toBe("function");
  });
});

describe("runBotCheck", () => {
  it("off passes without calling anything", async () => {
    expect(await runBotCheck({ state: "off" }, undefined, "lead")).toEqual({ ok: true });
  });

  it("misconfigured is a 503 unconfigured", async () => {
    expect(await runBotCheck({ state: "misconfigured" }, "tok", "lead")).toMatchObject({
      ok: false,
      status: 503,
      kind: "unconfigured",
    });
  });

  it("passes when the verifier passes, and hands it the token and action", async () => {
    const { check, verify } = stub({ outcome: "passed" });
    expect(await runBotCheck(check, "tok", "contact")).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledWith("tok", "contact");
  });

  it("refused is a 403 with its reason", async () => {
    const { check } = stub({ outcome: "refused", reason: "hostname" });
    expect(await runBotCheck(check, "tok", "lead")).toEqual({
      ok: false,
      status: 403,
      kind: "refused",
      reason: "hostname",
    });
  });

  it("unavailable is a 503 with its reason", async () => {
    const { check } = stub({ outcome: "unavailable", reason: "timeout" });
    expect(await runBotCheck(check, "tok", "order")).toEqual({
      ok: false,
      status: 503,
      kind: "unavailable",
      reason: "timeout",
    });
  });
});
