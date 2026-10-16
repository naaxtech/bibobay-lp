import { createAdminRouteDependencies } from "@/lib/admin/dependencies";
import { handleStatusRequest } from "@/lib/admin/orders";

/**
 * POST /api/admin/orders/[reference]/status: move an order one step (`{ from, to }`, ruling R98).
 * Rules and answers: lib/admin/orders.ts (same-origin JSON only, active staff only, `private, no-store`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return handleStatusRequest(request, reference, await createAdminRouteDependencies(request));
}
