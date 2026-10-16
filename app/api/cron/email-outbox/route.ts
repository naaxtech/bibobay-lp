import { reportError } from "@/lib/observability/report";
import { cronSecretFrom, isCronAuthorized } from "@/lib/outbox/config";
import { createOutboxWorker } from "@/lib/outbox/dependencies";
import { logWorkerRun } from "@/lib/outbox/log";

/**
 * GET /api/cron/email-outbox: the email outbox worker (Task 8a, R88), called by Vercel Cron
 * (vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
 *
 * Statuses: 503 `{ ok: false }` while `CRON_SECRET` (32+ characters) is unset · 401 `{ ok: false }`
 * for any other authorization · 503 `{ ok: false }` while Supabase or Resend is unconfigured (which
 * one is never said) · 500 `{ ok: false }` when the run broke · 200 with counts only:
 * `{ sent, failed, skipped, deferred }`. Never cached.
 *
 * src: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md · next 16.3.8 · 2026-10-16
 * src: node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md#route-segment-config · next 16.3.8 · 2026-10-16
 * (`dynamic` is allowed because Cache Components is off in next.config.ts.)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" } as const;
const refuse = (status: number) => Response.json({ ok: false }, { status, headers: NO_STORE });

export async function GET(request: Request) {
  // Review M6: the run's 40 seconds count from here, so the CMS reads and client setup are inside it.
  const startedAt = Date.now();
  const secret = cronSecretFrom();
  if (!secret) return refuse(503);
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) return refuse(401);

  try {
    const worker = await createOutboxWorker();
    if (!worker) return refuse(503);
    const tally = await worker.run(startedAt);
    logWorkerRun(tally);
    return Response.json(tally, { status: 200, headers: NO_STORE });
  } catch (error) {
    reportError(error, { area: "outbox", event: "outbox_worker_failed" });
    return refuse(500);
  }
}
