import { draftMode } from "next/headers";

/** Leaves draft mode (src: node_modules/next/dist/docs/01-app/02-guides/draft-mode.md · next 16.3.8 · 2026-10-13). */
export async function GET() {
  (await draftMode()).disable();
  return new Response(null, { status: 307, headers: { location: "/", "cache-control": "no-store" } });
}
