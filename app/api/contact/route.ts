import { CONTACT_API_MESSAGES, CONTACT_BODY_LIMIT_BYTES, submitContactMessage } from "@/lib/contact/submit";
import { createContactDependencies } from "@/lib/contact/dependencies";
import type { ContactApiBody } from "@/lib/contact/fields";
import { isJsonRequest, readBodyWithLimit } from "@/lib/leads/http";
import { reportError } from "@/lib/observability/report";

/**
 * POST /api/contact: a grown-up writes to the BIBO Bay team.
 *
 * Answers `{ ok, persisted, message }` (plus `fieldErrors` on a 400 with field problems, and
 * `closed: true` on the 503 of a form that is not open). `persisted: true` only after the database
 * confirmed the message and its outbox row; the message never says an email was sent. Statuses:
 * 200 stored · 400 invalid or honeypot · 413 too large · 415 not JSON · 429 rate limited ·
 * 500 write failed · 503 closed (R205), or the limiter is down.
 */
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" } as const;

function respond(status: number, body: ContactApiBody, retryAfterSeconds?: number) {
  return Response.json(body, {
    status,
    headers: retryAfterSeconds && retryAfterSeconds > 0 ? { ...NO_STORE, "retry-after": String(Math.ceil(retryAfterSeconds)) } : NO_STORE,
  });
}

const refuse = (status: number) => respond(status, { ok: false, persisted: false, message: CONTACT_API_MESSAGES.error });

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    // An unexpected failure goes to Sentry (tags only); the visitor gets the generic error string.
    reportError(error, { area: "contact", event: "contact_route_failed" });
    return refuse(500);
  }
}

async function handle(request: Request) {
  if (!isJsonRequest(request)) return refuse(415);
  const body = await readBodyWithLimit(request, CONTACT_BODY_LIMIT_BYTES);
  if (!body.ok) return refuse(body.reason === "too_large" ? 413 : 400);

  let input: unknown;
  try {
    input = JSON.parse(body.text);
  } catch {
    return refuse(400);
  }

  const result = await submitContactMessage(input, createContactDependencies(request));
  return respond(result.status, result.body, result.retryAfterSeconds);
}
