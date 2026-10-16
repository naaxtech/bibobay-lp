// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// lib/admin/session.ts (the staff sign-in limits) is server-only.
vi.mock("server-only", () => ({}));

import { STAFF_SIGN_IN_RATE_LIMIT } from "@/lib/admin/session";
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
    // Task 8b built the staff sign-in and APIs; the staff pages are still to come (Task 8c).
    expect(readme.find((line) => line.startsWith("| Staff order administration pages")) ?? "", "README staff pages row").toMatch(/not built yet \(Task 8c\)/);
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

describe("staff access docs (Task 8b)", () => {
  it("documents the staff sign-in and APIs as built and the staff pages as still to come", () => {
    const readme = read("README.md").split(/\r?\n/);
    expect(readme.find((line) => line.startsWith("| Staff sign-in and the staff order APIs")) ?? "", "README staff API row").toMatch(/\| built \(Task 8b/);
    const architecture = read("docs/architecture.md");
    const rows = architecture.split(/\r?\n/);
    for (const route of ["`/api/admin/session`", "`/api/admin/orders/[reference]/quote`", "`/api/admin/orders/[reference]/status`", "`/api/admin/orders/[reference]/tracking-link`"]) {
      expect(rows.find((line) => line.startsWith(`| ${route}`)) ?? "", route).toMatch(/^\| [^|]+ \| ƒ \|/);
    }
    expect(rows.find((line) => line.startsWith("| `/admin/login`")) ?? "").toMatch(/not built yet \(Task 8c\)/);
    for (const path of ["lib/admin/{dependencies,http,orders,session}.ts", "lib/orders/admin.ts", "lib/supabase/{admin,auth,leads,orders,server}.ts", "lib/supabase/staff-session.ts"]) {
      expect(architecture, path).toContain(path);
    }
  });

  it("documents PAYMENT_HOST_ALLOWLIST and the Supabase public settings as used", () => {
    const rows = read("docs/deployment.md").split(/\r?\n/);
    for (const name of ["PAYMENT_HOST_ALLOWLIST", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
      const row = rows.find((line) => line.startsWith(`| \`${name}\` |`)) ?? "";
      expect(row, name).not.toMatch(/not used yet|nothing reads it/i);
      expect(row, name).toMatch(/staff/i);
    }
    expect(rows.find((line) => line.startsWith("| `PAYMENT_HOST_ALLOWLIST` |"))).toMatch(/exact host/i);
    const example = read(".env.example").split(/\r?\n/);
    expect(example[example.indexOf("PAYMENT_HOST_ALLOWLIST=") - 1]).toMatch(/^# .*exact hosts/);
  });

  it("lists the staff table, policies and functions, and the sign-in limits the code uses, in the database notes", () => {
    const database = read("docs/database-security.md");
    for (const name of ["0007_staff_access.sql", "staff_users", "is_active_staff", "staff_save_order_quote", "staff_queue_order_quote", "staff_advance_order_status", "staff_rotate_order_tracking_token", "_staff_read", "supabase/tests/0005_staff_access.sql", "tests/admin/staff-migration-policy.test.ts"]) {
      expect(database, name).toContain(name);
    }
    expect(database).not.toMatch(/staff access are not built yet|Task 8b must raise/);
    const { client, email } = STAFF_SIGN_IN_RATE_LIMIT;
    expect(database).toContain(`\`${client.scope}:<HMAC of the client address>\` | ${client.maxHits} per ${client.windowSeconds / 60} minutes`);
    expect(database).toContain(`\`${email.scope}:<HMAC of the email>\` | ${email.maxHits} per ${email.windowSeconds / 60} minutes`);
  });

  it("gives the owner the staff steps, and keeps commerce off until the staff pages exist", () => {
    const operations = read("docs/manual-checkout-operations.md");
    expect(operations).not.toMatch(/not used by any code yet|staff area and quote sending are not built yet/);
    expect(operations).toMatch(/insert into public\.staff_users \(user_id, display_name\)/);
    expect(operations).toMatch(/set active = false, disabled_at = now\(\)/);
    expect(operations).toMatch(/sign-ups/i);
    expect(operations).toMatch(/Task 8c/);
    expect(operations).toMatch(/`commerceEnabled` is `false` by default and\s+must stay off/);
  });

  it("names every staff API warning in the observability notes", () => {
    // The warning events are the AdminLogEvent names lib/admin/http.ts sends to Sentry.
    const source = read("lib/admin/http.ts");
    const pattern = new RegExp(/const WARNING_EVENT = \/(.+)\/;/.exec(source)![1]!);
    const events = [...source.matchAll(/\{ event: "(\w+)"/g)].map((match) => match[1]!).filter((event) => pattern.test(event));
    expect(events.length).toBeGreaterThanOrEqual(5);
    const observability = read("docs/observability.md");
    for (const event of events) expect(observability, event).toContain(`\`${event}\``);
  });
});
