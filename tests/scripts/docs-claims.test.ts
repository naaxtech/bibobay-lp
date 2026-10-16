// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

// lib/admin/session.ts (the staff sign-in limits) is server-only.
vi.mock("server-only", () => ({}));

import { STAFF_SIGN_IN_RATE_LIMIT } from "@/lib/admin/session";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";
import { ADMIN_ORDER_ROUTE, maskAdminOrderPaths } from "@/lib/observability/admin-paths";
import { SEND_BUDGETS, sendBudgetKey } from "@/lib/outbox/constants";
import { MAX_WEBHOOK_BODY_BYTES } from "@/lib/security/revalidation";
import { parse } from "yaml";

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
    // Task 8b built the staff sign-in and APIs; Task 8c built the staff pages over them.
    expect(readme.find((line) => line.startsWith("| Staff order administration pages")) ?? "", "README staff pages row").toMatch(/\| built \(Task 8c/);
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
  it("documents the staff sign-in and APIs as built, and the staff pages as built in the route table (Task 8c)", () => {
    const readme = read("README.md").split(/\r?\n/);
    expect(readme.find((line) => line.startsWith("| Staff sign-in and the staff order APIs")) ?? "", "README staff API row").toMatch(/\| built \(Task 8b/);
    const architecture = read("docs/architecture.md");
    const rows = architecture.split(/\r?\n/);
    for (const route of ["`/api/admin/session`", "`/api/admin/orders/[reference]/quote`", "`/api/admin/orders/[reference]/status`", "`/api/admin/orders/[reference]/tracking-link`"]) {
      expect(rows.find((line) => line.startsWith(`| ${route}`)) ?? "", route).toMatch(/^\| [^|]+ \| ƒ \|/);
    }
    expect(rows.find((line) => line.startsWith("| `/admin/login`")) ?? "").toMatch(/^\| [^|]+ \| ƒ \|/);
    expect(rows.find((line) => line.startsWith("| `/admin` |")) ?? "").toMatch(/\/admin\/orders/);
    expect(architecture).not.toMatch(/not built yet \(Task 8c\)/);
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

  it("gives the owner the staff steps, and keeps commerce off until the live preview pass has been done", () => {
    const operations = read("docs/manual-checkout-operations.md");
    expect(operations).not.toMatch(/not used by any code yet|staff area and quote sending are not built yet/);
    expect(operations).toMatch(/insert into public\.staff_users \(user_id, display_name\)/);
    expect(operations).toMatch(/set active = false, disabled_at = now\(\)/);
    expect(operations).toMatch(/sign-ups/i);
    expect(operations).toMatch(/Task 8c/);
    expect(operations).toMatch(/`commerceEnabled` is `false` by default and must stay off until that pass has been done/);
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


describe("final fix wave docs (rulings R130 to R134, findings O-I1 to O-I8)", () => {
  const deployment = () => read("docs/deployment.md");
  const lines = (file: string) => read(file).split(/\r?\n/);

  it("names Node 24 as the runtime on Vercel and in CI, with 26 accepted locally (O-I1, R133)", () => {
    expect(read(".nvmrc").trim()).toBe("24");
    expect(deployment()).toMatch(/\*\*Node\.js 24\*\* on Vercel and in CI/);
    expect(deployment()).toMatch(/never from `\.nvmrc`/);
    expect(deployment()).toMatch(/Node 26 is accepted locally/);
    expect(deployment()).not.toMatch(/Node\.js 26 \(matches/);
    expect(read("README.md")).toMatch(/Node\.js 24 \(the version in \[`\.nvmrc`\]/);
    expect(read("README.md")).not.toMatch(/Node\.js 26 \(the version/);
  });

  it("requires a Pro plan, because Hobby is non-commercial, and runs the cron every 15 minutes (O-I2, R134)", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons).toEqual([{ path: "/api/cron/email-outbox", schedule: "*/15 * * * *" }]);
    expect(deployment()).toMatch(/\*\*A Vercel Pro plan is required\*\*/);
    expect(deployment().replace(/\s+/g, " ")).toMatch(/Hobby plan is restricted to non-commercial personal use/);
    expect(deployment()).not.toMatch(/once a day, 06:00 UTC|accepts at most one run a day, so a failed email can wait/);
    expect(read("README.md")).toMatch(/Vercel needs a Pro plan, because Hobby is for non-commercial use only/);
    expect(read("docs/observability.md")).toMatch(/every 15 minutes/);
    for (const file of ["README.md", "docs/architecture.md", "docs/observability.md"]) expect(read(file), file).not.toMatch(/once a day|daily Vercel cron/i);
  });

  it("documents every order, tracking and staff-page event that reaches Sentry (O-I5)", () => {
    const observability = read("docs/observability.md");
    const warning = /_(failed|unavailable|unconfigured|invalid)$/;
    const loggedEvents = (file: string) => [...read(file).matchAll(/\{ event: "(\w+)"/g)].map((match) => match[1]!);
    const reported = [...loggedEvents("lib/orders/submit.ts"), ...loggedEvents("lib/orders/track.ts")].filter((event) => warning.test(event));
    expect(reported.length).toBeGreaterThanOrEqual(8);
    const thrown = ["app/api/orders/route.ts", "app/api/orders/track/route.ts", "app/admin/orders/page.tsx", "app/admin/orders/[reference]/page.tsx", "lib/admin/orders.ts", "lib/admin/session.ts"].flatMap((file) =>
      [...read(file).matchAll(/(?:reportError\([^)]*event: |guarded\(deps, )"(\w+)"/g)].map((match) => match[1]!),
    );
    expect([...thrown].sort()).toEqual(["admin_order_read_failed", "admin_orders_list_failed", "admin_quote_failed", "admin_status_failed", "admin_tracking_link_failed", "order_route_failed", "order_track_route_failed", "staff_sign_in_failed", "staff_sign_out_failed"]);
    for (const event of [...reported, ...thrown]) expect(observability, event).toContain(`\`${event}\``);
    expect(observability).toMatch(/Alerts from the order and tracking routes/);
    expect(observability).toMatch(/Set a Sentry alert on this one/);
  });

  it("describes the pre-merge state no more (O-I7): the release rows, the Vite prototype, orders management", () => {
    const rows = lines("docs/qa-checklist.md");
    const six = rows.find((line) => line.startsWith("| 6 |")) ?? "";
    const seven = rows.find((line) => line.startsWith("| 7 |")) ?? "";
    for (const row of [six, seven]) expect(row).not.toMatch(/not built yet/i);
    expect(seven).toMatch(/not yet tried end to end on a live preview/);
    for (const file of ["README.md", "docs/architecture.md", "docs/deployment.md"]) {
      expect(read(file), file).not.toMatch(/`main` (?:branch )?still (?:holds|builds)|`main` holds|Vite prototype on `main`|the old Vite prototype on/);
    }
    expect(read("README.md")).toMatch(/That branch is frozen/);
    expect(read("README.md").replace(/\s+/g, " ")).toMatch(/`package\.json` has no Vite/);
    expect(read("docs/architecture.md")).toMatch(/`package\.json` has no Vite/);
    expect(read("docs/deployment.md")).toMatch(/\(`package\.json` has no Vite\)/);
    expect(read("docs/cms-operations.md")).not.toMatch(/Nobody can manage orders yet/);
    expect(read("docs/cms-operations.md")).toMatch(/Staff can manage orders from `\/admin\/orders`/);
    expect(read("docs/manual-checkout-operations.md")).not.toMatch(/It is not a procedure/);
    const manifest = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect({ ...manifest.dependencies, ...manifest.devDependencies }).not.toHaveProperty("vite");
  });

  it("documents the two extra CI jobs with the workflow's own commands, and the same commands in the QA checklist (O-I4, T-I6, R130)", () => {
    const workflow = parse(read(".github/workflows/ci.yml")) as { jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }> };
    const table = deployment();
    for (const id of ["e2e-commerce", "e2e-keyed"]) expect(lines("docs/deployment.md").find((line) => line.startsWith(`| \`${id}\` (after \`verify\`) |`)), id).toBeTruthy();
    const keyedBuild = workflow.jobs["e2e-keyed"]!.steps.find((step) => step.run === "npm run build")!.env!;
    expect(Object.keys(keyedBuild).sort()).toEqual(["NEXT_PUBLIC_POSTHOG_HOST", "NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_SENTRY_DSN"]);
    for (const [name, value] of Object.entries(keyedBuild)) {
      expect(table, name).toContain(`${name}=${value}`);
      expect(read("docs/qa-checklist.md"), name).toContain(`${name}=${value}`);
    }
    expect(table).toContain("CRON_SECRET=e2e-placeholder-cron-secret-0123456789abcdef");
    expect(read("docs/qa-checklist.md")).toContain("CRON_SECRET=e2e-placeholder-cron-secret-0123456789abcdef");
    expect(read("docs/qa-checklist.md")).toContain("node scripts/e2e/enable-commerce-fixture.mjs <copy>");
    expect(read("docs/qa-checklist.md")).toContain("E2E_PRODUCTION=1 E2E_COMMERCE=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3260 npx playwright test e2e/shop e2e/commerce");
    expect(read("docs/qa-checklist.md")).toContain("E2E_PRODUCTION=1 E2E_ANALYTICS=1 E2E_SENTRY=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3261 npx playwright test e2e/analytics e2e/observability");
    expect(table).toContain("E2E_PRODUCTION=1 E2E_COMMERCE=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test e2e/shop e2e/commerce");
    expect(table).toContain("E2E_PRODUCTION=1 E2E_ANALYTICS=1 E2E_SENTRY=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3200 npx playwright test e2e/analytics e2e/observability");
  });

  it("names the preview-pass switch and the protection-bypass secret where the owner reads them (O-I3)", () => {
    for (const file of ["docs/qa-checklist.md", "docs/qa-report-2026-10-02.md"]) {
      expect(read(file), file).toContain("E2E_CONFIGURED=1");
      expect(read(file), file).toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    }
    expect(read("docs/qa-checklist.md")).toContain("x-vercel-protection-bypass");
    expect(read("docs/qa-checklist.md")).toMatch(/E2E_PRODUCTION=1 E2E_CONFIGURED=1 PLAYWRIGHT_BASE_URL=https:\/\/<preview-url> npx playwright test/);
  });

  it("keeps the QA report free of counts from an earlier commit and honest about what nothing proves (O-M8, T-I5)", () => {
    const report = read("docs/qa-report-2026-10-02.md");
    expect(report).toMatch(/Final verification: appended by the controller after the fix wave/);
    expect(report).not.toMatch(/\b300 passed\b|\b10 failed\b|\b165 passed\b|c703a2e/);
    expect(report).toMatch(/`app\/global-error\.tsx` is rendered in a unit test/);
    expect(report).toMatch(/never sees 401 for a signed-out visitor or 403/);
    expect(report).toMatch(/proven in Vitest only/);
  });

  it("documents the analytics exclusion and the staff-path masking exactly as the code does (8c-M1)", () => {
    const observability = read("docs/observability.md");
    expect(read("lib/analytics/events.ts")).toContain("export function isExcludedPagePath");
    expect(read("lib/analytics/events.ts")).toContain("(?:admin|studio)");
    expect(observability).toContain("`isExcludedPagePath`");
    expect(observability).toMatch(/under `\/admin` or `\/studio`/);
    expect(maskAdminOrderPaths("https://x.example/admin/orders/BB-AB12-CD34")).toBe(`https://x.example${ADMIN_ORDER_ROUTE}`);
    expect(observability).toContain(`\`${ADMIN_ORDER_ROUTE}\``);
    expect(maskAdminOrderPaths("/api/admin/orders/BB-AB12-CD34/quote")).toBe("/api/admin/orders/[reference]/quote");
    expect(observability).toContain("`/api/admin/orders/[reference]/quote`");
  });

  it("documents each per-kind send bucket and the removal-channel readiness key by their code names (D-I1, P-I1)", () => {
    const deploymentText = read("docs/deployment.md");
    const buckets = [...Object.values(SEND_BUDGETS.leads), ...Object.values(SEND_BUDGETS.orders)];
    expect(buckets).toHaveLength(5);
    for (const budget of buckets) {
      expect(deploymentText, budget).toContain(`\`${sendBudgetKey(budget)}\``);
      expect(read("docs/database-security.md"), budget).toContain(`\`${sendBudgetKey(budget)}\``);
    }
    expect(deploymentText).not.toContain("ack-send:global");
    expect(read("docs/database-security.md")).not.toContain("ack-send:global");
    expect(read("lib/ops/readiness.ts")).toContain("leadRemovalChannel: boolean");
    expect(deploymentText).toContain("`leadRemovalChannel`");
    expect(deploymentText).toMatch(/readiness is 503 without it/);
  });
});
