import { createAdminRouteDependencies } from "@/lib/admin/dependencies";
import { handleQuoteRequest } from "@/lib/admin/orders";

/**
 * POST /api/admin/orders/[reference]/quote: save a quote (`{ intent: "save", ... }`, never notifies) or
 * send one saved revision (`{ intent: "send", revision }`, queued once; attempted after the answer).
 * Rules and answers: lib/admin/orders.ts (same-origin JSON only, active staff only, `private, no-store`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return handleQuoteRequest(request, reference, await createAdminRouteDependencies(request));
}
