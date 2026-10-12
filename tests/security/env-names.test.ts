import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyEnvironment } from "@/scripts/verify-env";

/*
 * Task 9 environment names. Every one is server-only: documented in .env.example without a public
 * prefix and refused by scripts/verify-env.ts under NEXT_PUBLIC_.
 */
const TASK_9_SERVER_NAMES = ["SANITY_REVALIDATE_SECRET", "SANITY_API_READ_TOKEN", "SANITY_STUDIO_ORIGIN"];

const envExampleNames = () =>
  readFileSync(resolve(".env.example"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]!);

describe("Task 9 environment names", () => {
  it("documents each server name in .env.example, unprefixed", () => {
    const names = envExampleNames();
    for (const name of TASK_9_SERVER_NAMES) {
      expect(names, name).toContain(name);
      expect(names, name).not.toContain(`NEXT_PUBLIC_${name}`);
    }
  });

  it.each(TASK_9_SERVER_NAMES)("refuses NEXT_PUBLIC_%s", (name) => {
    expect(verifyEnvironment({ [`NEXT_PUBLIC_${name}`]: "value" }, "production").forbiddenPublic).toEqual([`NEXT_PUBLIC_${name}`]);
  });

  it("refuses the revalidation secret copied into an allowed public value, without echoing it", () => {
    const secret = ["revalidate", "fixture", "secret"].join("-");
    const report = verifyEnvironment({ SANITY_REVALIDATE_SECRET: secret, NEXT_PUBLIC_SANITY_DATASET: secret }, "production");
    expect(report.forbiddenPublic).toEqual(["NEXT_PUBLIC_SANITY_DATASET"]);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});
