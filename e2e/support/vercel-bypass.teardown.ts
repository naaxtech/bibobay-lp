import { rm } from "node:fs/promises";

import { BYPASS_STATE_ENV, bypassStateDir } from "./vercel-bypass";

/** Playwright global teardown: removes this run's private folder holding the bypass cookie. */
export default async function globalTeardown(): Promise<void> {
  const path = process.env[BYPASS_STATE_ENV];
  const dir = path ? bypassStateDir(path) : null;
  if (dir) await rm(dir, { recursive: true, force: true });
}
