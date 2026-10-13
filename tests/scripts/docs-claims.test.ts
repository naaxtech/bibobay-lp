// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { MAX_WEBHOOK_BODY_BYTES } from "@/lib/security/revalidation";

/*
 * Claims in the operations docs that the Task 10 review found wrong or missing, pinned against the
 * code they describe so they cannot drift back.
 */
const read = (file: string) => readFileSync(resolve(file), "utf8");
const firstBashBlock = (markdown: string) => /```bash\r?\n([\s\S]*?)```/.exec(markdown)?.[1] ?? "";
const section = (markdown: string, heading: string) => {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return "";
  const next = markdown.slice(start + 3).search(/\r?\n## /);
  return next < 0 ? markdown.slice(start) : markdown.slice(start, start + 3 + next);
};

describe("operations docs", () => {
  it("lists every status the revalidation webhook route answers with (review M6)", () => {
    const statuses = new Set([...read("lib/security/revalidation.ts").matchAll(/json\((\d{3}),/g)].map((match) => match[1]!));
    expect([...statuses].sort()).toEqual(["200", "400", "401", "413", "503"]);
    const webhook = section(read("docs/deployment.md"), "Sanity webhook and Studio origin");
    for (const status of statuses) expect(webhook, `status ${status}`).toMatch(new RegExp(`\\b${status}\\b`));
    expect(webhook).toContain(`${MAX_WEBHOOK_BODY_BYTES / 1024} KiB`);
  });

  it("does not promise that a deployment refreshes cached CMS content (review I2: the Data Cache outlives deployments)", () => {
    const publishing = section(read("docs/cms-operations.md"), "Publishing and when the site updates");
    expect(publishing).not.toMatch(/until the next deployment/i);
    expect(publishing).toMatch(/persists across deployments/i);
  });

  it("installs the Studio before the root gates that import its schema (review C1)", () => {
    // Windows checkouts (core.autocrlf) turn the docs CRLF; the block must still be found.
    expect(firstBashBlock("# x\r\n```bash\r\nnpm ci\r\n```\r\n")).toBe("npm ci\r\n");
    expect(section("## A\r\none\r\n## B\r\ntwo", "A")).toBe("## A\r\none");
    const gates = firstBashBlock(read("docs/qa-checklist.md"));
    const studioInstall = gates.indexOf("npm --prefix studio ci");
    expect(studioInstall).toBeGreaterThan(-1);
    for (const gate of ["npm run typecheck", "npm run test:run", "npm run build"]) expect(studioInstall, gate).toBeLessThan(gates.indexOf(gate));
    const verifyRow = read("docs/deployment.md").split(/\r?\n/).find((line) => line.startsWith("| `verify` |")) ?? "";
    expect(verifyRow.indexOf("npm --prefix studio ci")).toBeGreaterThan(-1);
    expect(verifyRow.indexOf("npm --prefix studio ci")).toBeLessThan(verifyRow.indexOf("typecheck"));
  });

  it("says where server-rendered pages are scanned, since the build output holds none (review I1)", () => {
    const scan = section(read("docs/deployment.md"), "Client bundle secret scan");
    expect(scan).toMatch(/rendered per request/i);
    expect(scan).toContain("verify:deployment");
    const criterion9 = read("docs/qa-checklist.md").split(/\r?\n/).find((line) => line.startsWith("| 9 |")) ?? "";
    expect(criterion9).toContain("npm run verify:deployment");
  });
});
