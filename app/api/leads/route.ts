import { createLeadDependencies } from "@/lib/leads/dependencies";
import { isJsonRequest, readBodyWithLimit } from "@/lib/leads/http";
import { submitLead, type LeadApiBody } from "@/lib/leads/submit";

/**
 * POST /api/leads: the founding-family signup.
 *
 * Answers `{ ok, persisted, acknowledgementQueued, message }` (plus `fieldErrors` on a 400 with
 * field problems). `persisted: true` only after the database confirmed the write; the message never
 * says an email was sent. Statuses: 200 stored · 400 invalid or honeypot · 413 too large ·
 * 415 not JSON · 429 rate limited · 500 write failed · 503 storage not configured or limiter down.
 */
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" } as const;

function respond(status: number, body: LeadApiBody, retryAfterSeconds?: number) {
  return Response.json(body, {
    status,
    headers: retryAfterSeconds && retryAfterSeconds > 0 ? { ...NO_STORE, "retry-after": String(Math.ceil(retryAfterSeconds)) } : NO_STORE,
  });
}

export async function POST(request: Request) {
  const dependencies = await createLeadDependencies(request);
  const refuse = (status: number) => respond(status, { ok: false, persisted: false, acknowledgementQueued: false, message: dependencies.copy.errorMessage });

  if (!isJsonRequest(request)) return refuse(415);
  const body = await readBodyWithLimit(request);
  if (!body.ok) return refuse(body.reason === "too_large" ? 413 : 400);

  let input: unknown;
  try {
    input = JSON.parse(body.text);
  } catch {
    return refuse(400);
  }

  const result = await submitLead(input, dependencies);
  return respond(result.status, result.body, result.retryAfterSeconds);
}
