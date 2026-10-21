import { cookies, draftMode } from "next/headers";

import { handleDraftModeDisable } from "@/lib/sanity/draft-mode";

/**
 * Leaves draft mode (src: node_modules/next/dist/docs/01-app/02-guides/draft-mode.md · next 16.3.8 · 2026-10-13),
 * clearing the Studio's perspective and any partitioned copy of the draft cookie too (R162, R163).
 */
export async function GET() {
  const draft = await draftMode();
  return handleDraftModeDisable({ disable: () => draft.disable(), cookies: await cookies(), secure: process.env.NODE_ENV === "production" });
}
