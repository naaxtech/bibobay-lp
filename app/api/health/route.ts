/**
 * Liveness (ruling R37): the process answers. No configuration detail, no dependency call.
 * src: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md · next 16.3.8 · 2026-10-13
 * (Route Handlers are not cached by default.)
 */
export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  // Only a commit hash is echoed; anything else in the variable is never reflected.
  const version = /^[0-9a-f]{7,40}$/i.test(sha) ? sha : "local";
  return Response.json({ status: "ok", version, time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
