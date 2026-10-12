import { readinessChecks } from "@/lib/ops/readiness";
import { getLegalSettings } from "@/lib/sanity/fetch";
import { legalReviewed } from "@/lib/seo/metadata";

/** The legal read is tag-cached; if Sanity is slow, readiness still answers within this budget. */
const LEGAL_READ_BUDGET_MS = 2500;

async function legalTextReviewed(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), LEGAL_READ_BUDGET_MS);
  });
  try {
    return await Promise.race([getLegalSettings().then(legalReviewed, () => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Readiness (ruling R37): 200 when Sanity, lead storage and revalidation are configured, else 503.
 * The body is booleans only. Email and reviewed legal text are reported but not required.
 */
export async function GET() {
  const checks = readinessChecks(process.env, { legalReviewed: await legalTextReviewed() });
  return Response.json(checks, { status: checks.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
