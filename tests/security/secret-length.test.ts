import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LEAD_IP_HASH_SECRET_MIN_LENGTH as SERVER_MINIMUM } from "@/lib/leads/dependencies";
import { SERVER_SECRET_MIN_LENGTH } from "@/lib/security/secrets";
import { LEAD_IP_HASH_SECRET_MIN_LENGTH as BUILD_MINIMUM } from "@/scripts/verify-env";

/*
 * Task 5 re-review N4: the 32-character minimum for server secrets (the client-address HMAC key,
 * and since Task 8a the cron secret) is defined once. The server and the build check import it, so
 * they cannot drift apart.
 */
const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("one shared minimum for server secrets (N4)", () => {
  it("is 32 characters", () => {
    expect(SERVER_SECRET_MIN_LENGTH).toBe(32);
  });

  it("is the value the lead server and the build check both use", () => {
    expect(SERVER_MINIMUM).toBe(SERVER_SECRET_MIN_LENGTH);
    expect(BUILD_MINIMUM).toBe(SERVER_SECRET_MIN_LENGTH);
  });

  it("is written as a number in exactly one file", () => {
    for (const file of ["lib/leads/dependencies.ts", "scripts/verify-env.ts"]) {
      expect(read(file), file).not.toMatch(/MIN_LENGTH\s*=\s*\d/);
      expect(read(file), file).toMatch(/SERVER_SECRET_MIN_LENGTH/);
    }
    // The build script cannot use the "@/" alias (tsx runs it directly), so it imports the module by path.
    expect(read("scripts/verify-env.ts")).toContain('from "../lib/security/secrets"');
  });
});
