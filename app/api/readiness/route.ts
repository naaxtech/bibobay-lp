import type { SiteSettings } from "@/lib/content/types";
import { readinessChecks } from "@/lib/ops/readiness";
import { getLegalSettings, getSiteSettings } from "@/lib/sanity/fetch";
import { legalReviewed } from "@/lib/seo/metadata";

/** The CMS reads are tag-cached; if Sanity is slow, readiness still answers within this budget. */
const LEGAL_READ_BUDGET_MS = 2500;

/** One CMS read, or `fallback` when it fails or takes longer than the budget. */
async function withinBudget<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), LEGAL_READ_BUDGET_MS);
  });
  try {
    return await Promise.race([read().catch(() => fallback), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const legalTextReviewed = () => withinBudget(() => getLegalSettings().then(legalReviewed), false);

/** P-I1: only the contact address is read; an unreadable CMS counts as no address. */
const contactSettings = (): Promise<Pick<SiteSettings, "contactEmail">> =>
  withinBudget<Pick<SiteSettings, "contactEmail">>(async () => ({ contactEmail: (await getSiteSettings())?.contactEmail }), {});

/**
 * Readiness (ruling R37): 200 when Sanity, lead storage, revalidation and (P-I1, Ruling R125) a way
 * to ask for removal (email sending or the CMS contact address) are configured, else 503. The body is
 * booleans only (`leadRemovalChannel` is the removal channel; `contact` is whether the contact
 * form is open, R173). Email on its own, the contact form and reviewed legal text are reported but
 * not required.
 */
export async function GET() {
  const [reviewed, settings] = await Promise.all([legalTextReviewed(), contactSettings()]);
  const checks = readinessChecks(process.env, { legalReviewed: reviewed, settings });
  return Response.json(checks, { status: checks.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
