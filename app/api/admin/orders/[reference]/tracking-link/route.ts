import { createAdminRouteDependencies } from "@/lib/admin/dependencies";
import { handleTrackingLinkRequest } from "@/lib/admin/orders";

/**
 * POST /api/admin/orders/[reference]/tracking-link: issue a new private tracking link, shown once
 * (the old one stops working).
 * Rules and answers: lib/admin/orders.ts (same-origin JSON only, active staff only, `private, no-store`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return handleTrackingLinkRequest(request, reference, await createAdminRouteDependencies(request));
}
