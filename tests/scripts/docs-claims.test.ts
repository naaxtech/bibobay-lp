// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";
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

  it("states the Vercel install and build commands exactly as vercel.json sets them (re-review minor)", () => {
    const vercel = JSON.parse(read("vercel.json")) as { installCommand: string; buildCommand: string };
    const project = section(read("docs/deployment.md"), "Vercel project").replace(/\s+/g, " ");
    expect(project).toContain(`\`installCommand: ${vercel.installCommand}\``);
    expect(project).toContain(`\`buildCommand: ${vercel.buildCommand}\``);
  });

  it("says where server-rendered pages are scanned, since the build output holds none (review I1)", () => {
    const scan = section(read("docs/deployment.md"), "Client bundle secret scan");
    expect(scan).toMatch(/rendered per request/i);
    expect(scan).toContain("verify:deployment");
    const criterion9 = read("docs/qa-checklist.md").split(/\r?\n/).find((line) => line.startsWith("| 9 |")) ?? "";
    expect(criterion9).toContain("npm run verify:deployment");
  });
});

describe("rebrand docs (rebrand review C1, M3)", () => {
  it("gives the manual QA run the repository fallback's own hero heading", () => {
    const headings = [...read("docs/qa-checklist.md").matchAll(/--expect-heading "([^"]+)"/g)].map((match) => match[1]);
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(heading).toBe(SAFE_FALLBACK_CONTENT.hero.title);
  });

  it("names the channel mark as the logo's source, and the channel as the brand authority", () => {
    for (const file of ["README.md", "docs/architecture.md"]) {
      const text = read(file);
      expect(text, file).toContain("references/bibo-channel-mark.jpg");
      expect(text, file).not.toMatch(/bibo-logo\.jpg`?[^\n|]*(?:traced|canonical logo)/);
    }
  });

  it("tells editors what an empty image slot shows and how repository art is matched", () => {
    const images = section(read("docs/cms-operations.md"), "Images");
    expect(images).toMatch(/channel/i);
    expect(images).toContain("lib/content/brand-art.ts");
    expect(images).toMatch(/first name/i);
    expect(images).toMatch(/YouTube/);
    // Rebrand re-review N3: the hero's artwork description only names the drawn fallback scene.
    expect(images).toMatch(/artwork description/i);
    const map = read("docs/architecture.md");
    for (const name of ["public/brand/art/", "lib/content/brand-art.ts", "ReefBackdrop"]) expect(map, name).toContain(name);
  });
});

describe("email outbox worker docs (Task 8a)", () => {
  it("documents the worker as built in the README, and the staff side as still to come", () => {
    const readme = read("README.md").split(/\r?\n/);
    expect(readme.find((line) => line.includes("outbox worker")) ?? "", "README worker row").toMatch(/\| built \(Task 8a/);
    expect(readme.find((line) => line.startsWith("| Staff order administration")) ?? "", "README staff row").toMatch(/not built yet \(Task 8b, 8c\)/);
  });

  it("documents CRON_SECRET as used, its 32-character minimum, and the once-a-day schedule with how to raise it (R88)", () => {
    const deployment = read("docs/deployment.md");
    const row = deployment.split(/\r?\n/).find((line) => line.startsWith("| `CRON_SECRET` |")) ?? "";
    expect(row).not.toMatch(/not used yet|Nothing reads it/);
    expect(row).toMatch(/32/);
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    expect(deployment).toContain(`\`${vercel.crons[0]!.schedule}\``);
    expect(deployment).toContain(`\`${vercel.crons[0]!.path}\``);
    expect(deployment).toMatch(/Hobby/);
    expect(deployment).toMatch(/Pro/);
    const example = read(".env.example").split(/\r?\n/);
    const index = example.indexOf("CRON_SECRET=");
    expect(example[index - 1]).toMatch(/^# .*32/);
  });

  it("lists the outbox functions, their grants and the skipped status in the database notes", () => {
    const database = read("docs/database-security.md");
    for (const name of ["claim_lead_deliveries", "claim_order_emails", "record_order_email_attempt", "outbox_failure_unconfirmed", "idempotency_key", "quote_revision", "stale_unconfirmed", "`skipped`"]) {
      expect(database, name).toContain(name);
    }
    expect(database).not.toMatch(/Not built yet \(Task 8\)/);
  });

  it("maps the cron route and names the outbox's alerts", () => {
    expect(read("docs/architecture.md").split(/\r?\n/).find((line) => line.startsWith("| `/api/cron/email-outbox` |")) ?? "").toMatch(/CRON_SECRET/);
    const observability = read("docs/observability.md");
    for (const event of ["delivery_claim_failed", "delivery_message_invalid", "delivery_expired", "outbox_worker_failed", "worker_run"]) expect(observability, event).toContain(`\`${event}\``);
  });
});

describe("outbox docs after the Task 8a review", () => {
  it("says a withdrawn lead's rows are written pending and skipped by the claim (M1), never answered skipped", () => {
    const notes = read("docs/database-security.md");
    expect(notes).not.toMatch(/answers `skipped`|written as anything but `skipped`/);
    expect(notes).toMatch(/written `pending`/);
  });

  it("documents that a final failure is reported with its kind and code (I1), and the run's 40 seconds (M6)", () => {
    expect(read("docs/observability.md")).toMatch(/final failure[\s\S]{0,120}kind and code/);
    expect(read("docs/deployment.md")).toMatch(/40 seconds after the request started/);
    expect(read("docs/deployment.md")).not.toMatch(/45 seconds/);
  });
});

