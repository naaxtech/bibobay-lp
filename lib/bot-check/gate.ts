import "server-only";

import { botCheckConfig, type BotCheckProblem } from "@/lib/bot-check/config";
import type { BotCheckAction } from "@/lib/bot-check/fields";
import { createTurnstileVerifier, type BotCheckVerifier } from "@/lib/bot-check/turnstile";

/*
 * The one gate every form pipeline calls (R215, R216, R219): build a BotCheck from the environment
 * once, then ask it about each submission's token. The pipelines decide what the answers cost
 * (logging, reporting, status copy); this module only decides the verdict.
 */

type Env = Readonly<Record<string, string | undefined>>;

export type BotCheck = { state: "off" } | { state: "misconfigured"; problem: BotCheckProblem } | { state: "on"; verifier: BotCheckVerifier };

export type BotCheckGate =
  | { ok: true }
  | { ok: false; status: 403; kind: "refused"; reason: string }
  | { ok: false; status: 503; kind: "unavailable" | "unconfigured"; reason: string };

export function createBotCheck(
  env: Env,
  options?: Parameters<typeof createTurnstileVerifier>[1],
): BotCheck {
  const config = botCheckConfig(env);
  if (config.state === "off") return { state: "off" };
  if (config.state === "misconfigured") return { state: "misconfigured", problem: config.problem };
  return { state: "on", verifier: createTurnstileVerifier(config, options) };
}

export async function runBotCheck(
  check: BotCheck,
  token: string | undefined,
  action: BotCheckAction,
): Promise<BotCheckGate> {
  if (check.state === "off") return { ok: true };
  if (check.state === "misconfigured") {
    return { ok: false, status: 503, kind: "unconfigured", reason: check.problem };
  }
  const verdict = await check.verifier.verify(token, action);
  if (verdict.outcome === "passed") return { ok: true };
  if (verdict.outcome === "refused") return { ok: false, status: 403, kind: "refused", reason: verdict.reason };
  return { ok: false, status: 503, kind: "unavailable", reason: verdict.reason };
}
