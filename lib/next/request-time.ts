import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

/**
 * Marks the caller as rendered per request (src: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md
 * · next 16.3.8 · 2026-10-13), unlike `dynamic = "force-dynamic"`, which would also turn off the
 * tag-cached Sanity reads. Called outside a request (a unit test calling the route directly) it
 * does nothing; Next's own control-flow errors (the build-time "this route is dynamic" signal) are
 * rethrown untouched.
 */
export async function atRequestTime(): Promise<void> {
  try {
    await connection();
  } catch (error) {
    unstable_rethrow(error);
  }
}
