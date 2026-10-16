import { createSessionDependencies } from "@/lib/admin/dependencies";
import { handleSignIn, handleSignOut } from "@/lib/admin/session";

/**
 * POST /api/admin/session: staff sign-in (email and password, Supabase Auth; ruling R94).
 * DELETE /api/admin/session: sign-out. Rules and answers: lib/admin/session.ts. Same-origin JSON only
 * (R99); every answer is `private, no-store`. Works whether commerce is on or off.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleSignIn(request, await createSessionDependencies(request));
}

export async function DELETE(request: Request) {
  return handleSignOut(request, await createSessionDependencies(request));
}
