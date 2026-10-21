// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
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

/** Every send bucket of every outbox (leads, orders and the contact alert), so a new outbox cannot go undocumented (R165 #17). */
const ALL_SEND_BUDGETS = Object.values(SEND_BUDGETS).flatMap((budgets) => Object.values(budgets));

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

  it("documents CRON_SECRET as used, its 32-character minimum, and the once-a-day schedule (R88, restored by R180) with how to raise it", () => {
    const deployment = read("docs/deployment.md");
    const row = deployment.split(/\r?\n/).find((line) => line.startsWith("| `CRON_SECRET` |")) ?? "";
    expect(row).not.toMatch(/not used yet|Nothing reads it/);
    expect(row).toMatch(/32/);
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    expect(deployment).toContain(`\`${vercel.crons[0]!.schedule}\``);
    expect(deployment).toContain(`\`${vercel.crons[0]!.path}\``);
    expect(deployment).toMatch(/Hobby/);
    expect(deployment).toMatch(/Pro/);
    expect(vercel.crons[0]!.schedule).toBe("0 6 * * *");
    expect(deployment.replace(/\s+/g, " ")).toMatch(/once a day/);
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

  it("stays on Hobby by owner ruling R180 (2026-10-21), runs the cron once a day, and requires Pro before commerce is switched on (supersedes R134)", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons).toEqual([{ path: "/api/cron/email-outbox", schedule: "0 6 * * *" }]);
    const flat = (text: string) => text.replace(/\s+/g, " ");
    expect(flat(deployment())).toMatch(/runs on the Hobby plan by owner decision \(ruling R180, 2026-10-21\)/);
    expect(flat(deployment())).toMatch(/Hobby plan is restricted to non-commercial personal use; its fair-use guidelines \(https:\/\/vercel\.com\/docs\/limits\/fair-use-guidelines\) count advertising the sale of a product as commercial/);
    expect(flat(deployment())).toMatch(/a Pro plan is required at the latest before commerce is switched on \(`commerceEnabled`\)/);
    expect(flat(deployment())).toMatch(/restore `\*\/15 \* \* \* \*` \(R134\) in `vercel\.json` together with the tests and docs: change every file that says once a day, which are `vercel\.json`, `README\.md`, `docs\/deployment\.md`, `docs\/architecture\.md`, `docs\/database-security\.md`, `docs\/observability\.md`, `docs\/incident-runbook\.md`, `lib\/outbox\/constants\.ts`, `studio\/schemaTypes\/documents\/singletons\.ts` and the tests in `tests\/scripts`/);
    expect(flat(deployment())).toMatch(/fires between 06:00 and 06:59 UTC/);
    expect(flat(deployment())).toMatch(/retried at the next daily run/);
    expect(flat(deployment())).toMatch(/leaves at most one retry[\s\S]{0,500}parked at the next run as `delivery_expired`/);
    expect(flat(deployment())).toMatch(/emails deferred by the hourly per-kind cap, and repeat-signup rows that are never sent straight away, drain at most `LEAD_ACK_SEND_LIMIT_PER_HOUR` \(default 60\) per kind per day \(and at most 100 rows per outbox per run\)/);
    expect(flat(deployment())).toMatch(/every email is still attempted right after the API answer \(R88\), except repeat-signup rows/);
    expect(deployment()).not.toMatch(/retried within about 15 minutes|leaves many tries/);
    for (const file of ["docs/deployment.md", "docs/observability.md", "docs/incident-runbook.md", "CHANGELOG.md"]) {
      expect(read(file), file).not.toMatch(/usually misses/);
    }
    expect(flat(read("docs/observability.md"))).toMatch(/at most one retry before it is parked/);
    expect(flat(read("docs/incident-runbook.md"))).toMatch(/at most one retry before it is parked/);
    expect(flat(read("docs/incident-runbook.md"))).toMatch(/attempted up to 8 times in all \(right after the answer, then once per daily run\)/);
    expect(flat(read("CHANGELOG.md"))).toMatch(/at most one retry before it is parked/);
    for (const file of ["docs/observability.md", "docs/database-security.md"]) {
      expect(read(file), file).not.toMatch(/re-sent after\s+15\s+minutes|after\s+15\s+minutes a claim takes it again/);
      expect(flat(read(file)), file).toMatch(/stays `sending`; the next cron run \(once a day on Hobby, and never before 15 minutes\) re-sends it under the same idempotency key if that run is within 23 hours of the stuck claim; otherwise it is parked as `stale_unconfirmed`/);
    }
    expect(flat(read("docs/incident-runbook.md"))).toMatch(/The next cron run sends it \(once a day, 06:00–06:59 UTC on Hobby; to send it now, call the worker by hand as in \[deployment\.md\]\(deployment\.md#email-outbox-worker-task-8a\)\)/);
    expect(read("docs/deployment.md")).toMatch(/^## Email outbox worker \(Task 8a\)$/m);
    expect(read("docs/deployment.md")).toMatch(/curl -H "Authorization: Bearer <secret>"/);
    for (const file of ["README.md", "docs/architecture.md"]) {
      expect(read(file), file).not.toMatch(/non-commercial only|non-commercial use only/);
      expect(flat(read(file)), file).toMatch(/restricted to non-commercial personal use[\s\S]{0,300}fair-use guidelines[\s\S]{0,300}Pro plan is required at the latest before commerce is switched on/);
    }
    expect(flat(read("docs/architecture.md"))).toMatch(/scheduled 06:00 UTC \(Hobby fires it between 06:00 and 06:59\)/);
    const singletons = read("studio/schemaTypes/documents/singletons.ts");
    expect(singletons).toContain("Before switching this on, a Vercel Pro plan and the 15-minute email schedule must be in place (docs/deployment.md).");
    expect(deployment()).not.toMatch(/\*\*A Vercel Pro plan is required\*\*|\*\/15 \* \* \* \*` \(every 15 minutes\)/);
    expect(read("README.md")).toMatch(/Vercel stays on Hobby \(R180, 2026-10-21\)/);
    expect(flat(read("docs/observability.md"))).toMatch(/runs once a day[\s\S]{0,700}at most one retry[\s\S]{0,200}`delivery_expired`/);
    for (const file of ["README.md", "docs/architecture.md", "docs/observability.md", "docs/incident-runbook.md", "lib/outbox/constants.ts"]) {
      expect(read(file), file).not.toMatch(/every 15 minutes|every-15-minutes|needs a Pro plan|cron worker \(every 15/i);
    }
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
    const buckets = ALL_SEND_BUDGETS;
    expect(buckets).toHaveLength(6);
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

  it("names every per-kind bucket in the observability doc, with the removal-channel warning event (residual fixer, item 5)", () => {
    const observability = read("docs/observability.md");
    for (const budget of ALL_SEND_BUDGETS) {
      expect(observability, budget).toContain(`\`${sendBudgetKey(budget)}\``);
    }
    expect(observability).toContain("`LEAD_ACK_SEND_LIMIT_PER_HOUR`");
    expect(observability).not.toMatch(/global send budget/i);
    expect(read("docs/database-security.md")).not.toMatch(/global send budget/i);
    expect(read("lib/leads/submit.ts")).toContain('event: "lead_removal_channel_unconfigured"');
    expect(observability).toContain("`lead_removal_channel_unconfigured`");
  });

  it("says saving a quote clears quote_sent_at and that it is set only for the current revision (C-I1)", () => {
    const database = read("docs/database-security.md");
    expect(database).toMatch(/clears `quote_sent_at` in one statement/);
    expect(database).toMatch(/only if the accepted email is for the order's current revision/);
    expect(read("supabase/migrations/0007_staff_access.sql")).toMatch(/quote_sent_at\s*=\s*null/);
    expect(read("supabase/migrations/0006_order_events_and_email_outbox.sql")).toContain("only if the quote's revision is the order's current revision");
    expect(read("docs/manual-checkout-operations.md")).toMatch(/clears the "quote email accepted" mark/);
  });

  it("describes the bypass as a host-scoped cookie, not a header on every request (residual fixer, item 4)", () => {
    for (const file of ["docs/qa-checklist.md", "docs/qa-report-2026-10-02.md"]) {
      expect(read(file), file).toContain("cookie");
      expect(read(file), file).not.toMatch(/Playwright send it as `x-vercel-protection-bypass`|verifier and Playwright send it/);
    }
    expect(read("docs/qa-checklist.md")).toContain("e2e/support/vercel-bypass.setup.ts");
    expect(read("docs/qa-checklist.md")).toContain("x-vercel-set-bypass-cookie=true");
    expect(read("e2e/support/vercel-bypass.ts")).toContain("x-vercel-set-bypass-cookie");
  });

  it("keeps the sign-in oversized-body expectation at what the route answers: 400 (O-I3)", () => {
    expect(read("lib/admin/session.ts")).toMatch(/adminJson\(400, \{ ok: false, message: ADMIN_COPY\.session\.checkDetails \}\)/);
    expect(read("e2e/admin/admin-security.spec.ts")).toMatch(/CONFIGURED \? 400 : 503/);
    expect(read("e2e/ops/health.spec.ts")).toContain("expect(body.leadRemovalChannel).toBe(CONFIGURED)");
  });
});

/*
 * The contact form docs (rulings R158-R177): each claim is pinned to the code it describes, so the
 * docs cannot drift from the route, the migration or the worker.
 */
describe("contact form docs (R158-R177)", () => {
  const flat = (text: string) => text.replace(/\s+/g, " ");
  const lines = (file: string) => read(file).split(/\r?\n/);

  it("documents the readiness key, the staff address that opens the form, and the open condition (R161, R173)", () => {
    expect(read("lib/ops/readiness.ts")).toContain("contact: boolean");
    const deployment = read("docs/deployment.md");
    const readinessRow = lines("docs/deployment.md").find((line) => line.startsWith("| `GET /api/readiness` |")) ?? "";
    expect(readinessRow).toContain("`contact`");
    const staffRow = lines("docs/deployment.md").find((line) => line.startsWith("| `STAFF_NOTIFICATION_EMAIL` |")) ?? "";
    expect(staffRow).toMatch(/also opens the contact form/);
    expect(flat(deployment)).toMatch(/the contact form is open only when[^.]*Supabase[^.]*`RESEND_API_KEY`[^.]*`RESEND_FROM`[^.]*`STAFF_NOTIFICATION_EMAIL`[^.]*`LEAD_IP_HASH_SECRET`/);
    expect(flat(deployment)).toMatch(/`contact` never changes `ready`/);
    expect(deployment).toContain("`/api/contact`");
  });

  it("names the contact tables, functions, buckets and limits in the database doc (R159, R169-R171, R175)", () => {
    const database = read("docs/database-security.md");
    for (const name of ["contact_messages", "contact_message_deliveries", "submit_contact_message", "claim_contact_deliveries", "record_contact_delivery_attempt", "contact:global", "contact:<HMAC of the client address>"]) {
      expect(database, name).toContain(`\`${name}\``);
    }
    expect(database).toContain("`send:contact_staff_alert`");
    expect(database).toMatch(/\| Contact messages per client \| `contact:<HMAC of the client address>` \| 3 per 10 minutes/);
    expect(database).toMatch(/\| Contact messages in all \| `contact:global` \| `LEAD_ACK_SEND_LIMIT_PER_HOUR` per hour \(default 60\) from everyone together, the contact alert's own send cap \(R186\)/);
    expect(flat(database)).toMatch(/no `skipped` status[^.]*"skipped": 0/);
    expect(flat(database)).toMatch(/lead outbox[^.]*not altered/i);
    expect(read("supabase/migrations/0008_contact_messages.sql")).toContain("create table if not exists public.contact_message_deliveries");
  });

  it("states the limits the code enforces (R171, R186)", () => {
    const submit = read("lib/contact/submit.ts");
    expect(submit).toContain('{ scope: "contact", maxHits: 3, windowSeconds: 600 }');
    expect(submit).toContain('{ key: "contact:global", windowSeconds: ACK_SEND_LIMIT.windowSeconds }');
    expect(submit).toContain("maxHits: dependencies.globalLimitPerHour");
    expect(read("lib/contact/dependencies.ts")).toContain("globalLimitPerHour: sendLimitPerHour");
    expect(submit).toContain("CONTACT_BODY_LIMIT_BYTES = 32 * 1024");
    expect(flat(read("docs/architecture.md"))).toMatch(/3 per 10 minutes per hashed client, then LEAD_ACK_SEND_LIMIT_PER_HOUR \(default 60, the alert's own send cap\) per hour in all/);
  });

  it("documents the contact events, the route failure and every contact warning that reaches Sentry (R166)", () => {
    const observability = read("docs/observability.md");
    const warning = /_(failed|unavailable|unconfigured|invalid)$/;
    const reported = [...read("lib/contact/submit.ts").matchAll(/\{ event: "(\w+)"/g)].map((match) => match[1]!).filter((event) => warning.test(event));
    expect([...new Set(reported)].sort()).toEqual(["contact_rate_limit_unavailable", "contact_store_failed", "contact_unconfigured"]);
    for (const event of ["contact_submitted", "contact_route_failed", "contact_stored", "contact_rate_limited", "contact_honeypot", ...reported]) expect(observability, event).toContain(`\`${event}\``);
    expect(read("app/api/contact/route.ts")).toContain('event: "contact_route_failed"');
    expect(read("lib/analytics/events.ts")).toContain('contact_submitted: ["persisted", "topic"]');
    expect(observability).toMatch(/\| `contact_submitted` \|[^|]*\| `persisted`, `topic` \|/);
    expect(observability).toMatch(/`channel` `leads`,\s+`orders`, `contact` or `worker`/);
    expect(observability).toContain("`send:contact_staff_alert`");
  });

  it("documents the Contact page document, the footer label and 33 seeded documents (R158, R163)", () => {
    const cms = read("docs/cms-operations.md");
    expect(cms).toContain("`contactPage`");
    expect(cms).toContain("`contactPageLabel`");
    expect(cms).toMatch(/lists the 33 claim-safe starter documents/);
    expect(cms).not.toMatch(/\b32 claim-safe/);
    expect(cms).toMatch(/Four singletons sit at the top of the desk/);
    expect(read("studio/structure.ts")).toContain('"contactPage"');
    expect(flat(cms)).toMatch(/after a schema change[^.]*redeploy/i);
  });

  it("describes the routes, the contact flow and the worker's three outboxes in the architecture doc (R158-R161, R169)", () => {
    const architecture = read("docs/architecture.md");
    const rows = lines("docs/architecture.md");
    expect(rows.some((line) => line.startsWith("| `/contact` |"))).toBe(true);
    expect(rows.some((line) => line.startsWith("| `/api/contact` |"))).toBe(true);
    expect(architecture).toMatch(/^## Contact flow$/m);
    expect(flat(architecture)).toMatch(/orders \(quotes first\), then signups, then contact alerts/);
    expect(flat(architecture)).toMatch(/no email goes to the sender/i);
    expect(flat(architecture)).toMatch(/Reply-To[^.]*sender/);
  });

  it("adds the contact messages to the data-protection record, its legal-review question and retention item (R164, R174)", () => {
    const text = read("docs/data-protection.md");
    expect(text).toContain("`contact_messages`");
    expect(text).toContain("`contact_message_deliveries`");
    const retention = flat(text.slice(text.indexOf("9. **Retention.**"), text.indexOf("10. **Withdrawn signups**")));
    expect(retention).toMatch(/how long contact messages are kept \(none is set; the code never deletes them\)/);
    const review = flat(text.slice(text.indexOf("8. **The lawyer's review**"), text.indexOf("9. **Retention.**")));
    expect(review).toMatch(/The basis for contact messages[^]*legitimate interest in replying to people who write to us/);
    expect(read("lib/content/legal-fallback.ts")).toContain("legitimate interest in replying to people who write to us");
    expect(flat(text.slice(text.indexOf("## Handling a request from a person")))).toMatch(/delete from public\.contact_messages[^]*delivery rows cascade|cascade[^]*contact_messages/i);
  });

  it("tells staff how to find a parked contact alert and read the message (R168, R177)", () => {
    const runbook = read("docs/incident-runbook.md");
    expect(runbook).toContain("contact_message_deliveries");
    expect(runbook).toContain("'infinity'");
    expect(runbook).toContain("public.contact_messages");
    expect(flat(runbook)).toMatch(/STAFF_NOTIFICATION_EMAIL[^.]*removed[^.]*wait/i);
    expect(flat(runbook)).toMatch(/contact-delivery\/<row id>/);
  });

  it("adds a contact-open run to the QA checklist (R167)", () => {
    const qa = read("docs/qa-checklist.md");
    expect(qa).toContain("E2E_CONTACT_OPEN=1");
    expect(qa).toContain("e2e/contact");
    expect(read("e2e/contact/contact-form.spec.ts")).toContain("E2E_CONTACT_OPEN");
  });

  it("lists the contact form in the README and the changelog, with the owner's steps after merge", () => {
    expect(read("README.md")).toMatch(/\| Contact form \(`\/contact`, `\/api\/contact`\)/);
    const changelog = read("CHANGELOG.md");
    const head = changelog.slice(changelog.indexOf("## 2026-10-21"), changelog.indexOf("## 2026-10-21", changelog.indexOf("## 2026-10-21") + 5));
    expect(head).toMatch(/^## 2026-10-21 — Contact form/);
    expect(head).toContain("R158-R177");
    expect(changelog.indexOf("## 2026-10-21 — Contact form")).toBeLessThan(changelog.indexOf("## 2026-10-21 — Email cron back"));
    expect(flat(read("docs/deployment.md"))).toMatch(/0008_contact_messages\.sql/);
    expect(flat(read("docs/deployment.md"))).toMatch(/Contact form: steps after merge/);
  });

  it("covers the deployment verifier's contact checks as built (R167)", () => {
    expect(read("scripts/lib/deployment-checks.ts")).toContain('FORM_API_PATHS = ["/api/leads", "/api/contact"]');
    expect(flat(read("docs/deployment.md"))).toMatch(/fetches `\/`, `\/privacy`, `\/terms`, `\/thank-you` and `\/contact`/);
    expect(flat(read("docs/deployment.md"))).toMatch(/blocks and fails any request to `\/api\/leads` or `\/api\/contact`/);
  });

  it("names every doc that says once a day in the restore sentence (R176)", () => {
    const sentence = flat(read("docs/deployment.md")).match(/change every file that says once a day, which are[^]*?and the tests in `tests\/scripts`/)?.[0] ?? "";
    expect(sentence).not.toBe("");
    const files = ["README.md", ...readdirSync(resolve("docs")).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`)];
    const saying = files.filter((file) => /once a day/.test(read(file)) && file !== "docs/deployment.md");
    expect(saying).toContain("docs/database-security.md");
    expect(sentence).toContain("`docs/deployment.md`");
    for (const file of saying) expect(sentence, file).toContain(`\`${file}\``);
  });

  it("says the overall contact limit is the alert's send cap, with no fixed number, everywhere it is described (R186)", () => {
    for (const file of ["docs/deployment.md", "docs/database-security.md", "docs/observability.md", "docs/architecture.md", "CHANGELOG.md"]) {
      expect(read(file), file).not.toMatch(/100 per hour|100 messages in an hour/);
    }
    expect(read("docs/superpowers/plans/2026-10-21-contact-form.md")).toMatch(/\*\*R171 Rate limits\.\*\*[^\n]*superseded by R186/);
    expect(flat(read("docs/deployment.md"))).toMatch(/3 messages per 10 minutes per client and, in all, as many per hour as the alert's send cap \(`LEAD_ACK_SEND_LIMIT_PER_HOUR`, default 60; R186\)/);
    expect(read("docs/observability.md")).toMatch(/`global` for the overall one, `LEAD_ACK_SEND_LIMIT_PER_HOUR` per hour \(default 60\), the alert's own send cap, R186/);
    // The privacy text names no number: the cap is an operator setting.
    const legal = read("lib/content/legal-fallback.ts");
    const paragraph = legal.slice(legal.indexOf("Messages sent through the contact form are counted"), legal.indexOf("Those counts are not linked to your message."));
    expect(paragraph).toMatch(/all messages together by the hour/);
    expect(paragraph.slice(paragraph.indexOf("all messages together"))).not.toMatch(/\d/);
  });

  it("says a contact alert is parked only at the attempt cap, never for the age of an unconfirmed send (R185)", () => {
    expect(flat(read("docs/deployment.md"))).toMatch(/Contact staff alerts are the exception \(R185\): an unconfirmed contact alert is never parked for its age/);
    const database = flat(section(read("docs/database-security.md"), "Contact messages (migration 0008)"));
    expect(database).not.toMatch(/retried only within 23 hours/);
    expect(database).toMatch(/an alert of unknown outcome is retried at any age, under the same key, until its eighth attempt \(R185\)/);
    const runbook = read("docs/incident-runbook.md");
    expect(flat(section(runbook, "Parked emails"))).toMatch(/\*\*`stale_unconfirmed`\*\*: a signup or order email whose outcome is unknown/);
    expect(flat(section(runbook, "Contact messages"))).toMatch(/A contact alert is parked only after its eighth attempt, or on `invalid_idempotent_request` \(R185\)/);
    const observability = flat(read("docs/observability.md"));
    expect(observability).toMatch(/A `delivery_expired` for that kind means an alert is parked for a person after its eighth attempt or an `invalid_idempotent_request`; a contact alert is never parked for the age of an unconfirmed send \(R185\)/);
    expect(observability).toMatch(/as a count, with the `outbox` whose claim parked them/);
    for (const file of ["docs/observability.md", "docs/database-security.md"]) expect(flat(read(file)), file).toMatch(/A contact staff alert is re-sent whatever its age, until its eighth attempt \(R185\)/);
    expect(read("CHANGELOG.md").slice(0, read("CHANGELOG.md").indexOf("## 2026-10-21 — Email cron back"))).toContain("R185");
  });

  it("documents the contact-open CI job with the workflow's own command and environment, and the same in the QA checklist (R187)", () => {
    const workflow = parse(read(".github/workflows/ci.yml")) as { jobs: Record<string, { steps: Array<{ run?: string; env?: Record<string, string> }> }> };
    const start = workflow.jobs["e2e-contact"]!.steps.find((step) => step.run?.includes("next start"))!.env!;
    const row = lines("docs/deployment.md").find((line) => line.startsWith("| `e2e-contact` (after `verify`) |")) ?? "";
    expect(row).not.toBe("");
    const qa = read("docs/qa-checklist.md");
    for (const [name, value] of Object.entries(start)) {
      const pair = `${name}=${value.includes(" ") ? `"${value}"` : value}`;
      expect(row, name).toContain(pair);
      expect(qa, name).toContain(pair);
    }
    expect(row).toContain("E2E_PRODUCTION=1 E2E_CONTACT_OPEN=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3300 npx playwright test e2e/contact");
    expect(qa).toContain("E2E_PRODUCTION=1 E2E_CONTACT_OPEN=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3262 npx playwright test e2e/contact");
    expect(flat(read("docs/deployment.md"))).toMatch(/`e2e-commerce`, `e2e-keyed` and `e2e-contact` run the commands in/);
    expect(flat(qa)).toMatch(/CI runs them as three more jobs \(`e2e-commerce`, `e2e-keyed` and `e2e-contact`/);
  });

  it("keeps the daily-schedule words out of the files the restore sentence does not list", () => {
    const changelog = read("CHANGELOG.md");
    const entry = changelog.slice(changelog.indexOf("## 2026-10-21 — Contact form"), changelog.indexOf("## 2026-10-21 — Email cron back"));
    expect(entry).not.toBe("");
    expect(entry).not.toMatch(/once a day/);
    for (const file of ["docs/cms-operations.md", "docs/data-protection.md", "docs/qa-checklist.md"]) expect(read(file), file).not.toMatch(/once a day/);
  });
});
