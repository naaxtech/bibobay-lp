import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";
import { createLeadDependencies } from "@/lib/leads/dependencies";
import { reportError } from "@/lib/observability/report";
import { isJsonRequest, readBodyWithLimit } from "@/lib/leads/http";
import { submitLead, type LeadApiBody } from "@/lib/leads/submit";

/**
 * POST /api/leads: the founding-family signup.
 *
 * Answers `{ ok, persisted, acknowledgementQueued, message }` (plus `download` on a stored signup when a download is
 * configured, and `fieldErrors` on a 400 with field problems). `persisted: true` only after the database confirmed the write; the message never
 * says an email was sent. Statuses: 200 stored · 400 invalid or honeypot · 403 bot check refused (R219) · 413 too large ·
 * 415 not JSON · 429 rate limited · 500 write failed · 503 storage not configured, limiter down, or
 * (P-I1, Ruling R125) no way to ask for removal: neither email sending nor a CMS contact address is
 * configured, answered with `LEAD_SIGNUPS_CLOSED_MESSAGE` (lib/leads/submit.ts) in the same shape.
 */
export const runtime = "nodejs";
// A siteverify timeout and its retry stay inside this budget; on Hobby without Fluid compute the default is shorter.
// src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md · next 16.3.8 · 2026-10-22
export const maxDuration = 30;

const NO_STORE = { "cache-control": "no-store" } as const;

function respond(status: number, body: LeadApiBody, retryAfterSeconds?: number) {
  return Response.json(body, {
    status,
    headers: retryAfterSeconds && retryAfterSeconds > 0 ? { ...NO_STORE, "retry-after": String(Math.ceil(retryAfterSeconds)) } : NO_STORE,
  });
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    // Task 10M-a rule 6: an unexpected failure goes to Sentry (tags only); the visitor gets the
    // repository's generic error copy, since the CMS copy may be what failed to load.
    reportError(error, { area: "leads", event: "lead_route_failed" });
    return respond(500, { ok: false, persisted: false, acknowledgementQueued: false, message: SAFE_FALLBACK_CONTENT.lead.errorMessage });
  }
}

async function handle(request: Request) {
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
