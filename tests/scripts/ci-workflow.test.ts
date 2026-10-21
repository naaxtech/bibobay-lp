// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

// lib/contact/availability.ts (the contact form's open condition) is server-only.
vi.mock("server-only", () => ({}));

import { contactFormOpen } from "@/lib/contact/availability";
import { SAFE_FALLBACK_CONTENT } from "@/lib/content/fallback";

/*
 * .github/workflows/ci.yml (ruling R43). Neither actionlint nor action-validator runs here (no
 * network for new tools), so the workflow is parsed and its shape asserted: triggers, least
 * privilege, SHA-pinned actions, no secrets anywhere (it must pass in a fork), and the exact gate
 * order the repository's own scripts define.
 */

const WORKFLOW_PATH = resolve(".github/workflows/ci.yml");
const raw = () => readFileSync(WORKFLOW_PATH, "utf8");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  shell?: string;
  "continue-on-error"?: boolean;
}
interface Job {
  name?: string;
  needs?: string | string[];
  "runs-on"?: string;
  "timeout-minutes"?: number;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  name: string;
  on: { push?: { "branches-ignore"?: string[]; branches?: string[] }; pull_request?: unknown; [key: string]: unknown };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  env?: Record<string, string>;
  jobs: Record<string, Job>;
}

const workflow = () => parse(raw()) as Workflow;
const job = (id: string) => workflow().jobs[id]!;
const runs = (id: string) => job(id).steps.filter((step) => step.run).map((step) => step.run!.trim());
const stepRunning = (id: string, command: string) => job(id).steps.find((step) => step.run?.includes(command));

/** R187: what the e2e-contact job starts `next start` with. Placeholders on reserved domains only; no secret. */
const CONTACT_PLACEHOLDERS = {
  NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.com",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture-value",
  LEAD_IP_HASH_SECRET: "e2e-placeholder-hash-secret-0123456789abcdef",
  RESEND_API_KEY: "re_fixture",
  RESEND_FROM: "BIBO Bay <hello@example.com>",
  STAFF_NOTIFICATION_EMAIL: "staff@example.com",
};

/** Pinned by commit; verified with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` (see docs/deployment.md). */
const PINNED_ACTIONS: Record<string, { sha: string; version: string }> = {
  "actions/checkout": { sha: "3d3c42e5aac5ba805825da76410c181273ba90b1", version: "v7.0.1" },
  "actions/setup-node": { sha: "949feb2413d6458794dcd2491c4babbbce0c15c1", version: "v7.1.0" },
  "actions/upload-artifact": { sha: "cf430e030ddbb5b0abf93d22962f4752f3646cd9", version: "v7.0.2" },
};

describe("CI workflow", () => {
  it("exists and parses", () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
    expect(workflow().name).toBeTruthy();
  });

  it("runs on every push except the GitHub Pages branch, and on pull requests", () => {
    const on = workflow().on;
    expect(on.push?.["branches-ignore"]).toEqual(["gh-pages"]);
    expect(on.push?.branches).toBeUndefined();
    expect("pull_request" in on).toBe(true);
    // pull_request_target runs fork code with the base repository's token and secrets.
    expect(Object.keys(on).sort()).toEqual(["pull_request", "push"]);
  });

  it("asks for read-only repository access and cancels superseded runs of the same ref", () => {
    expect(workflow().permissions).toEqual({ contents: "read" });
    for (const [id, definition] of Object.entries(workflow().jobs)) expect((definition as { permissions?: unknown }).permissions, id).toBeUndefined();
    expect(workflow().concurrency.group).toContain("${{ github.ref }}");
    expect(workflow().concurrency["cancel-in-progress"]).toBe(true);
  });

  it("references no secret and no token, so it passes in a fork", () => {
    const text = raw();
    expect(text).not.toMatch(/secrets\s*[.[]/);
    expect(text).not.toMatch(/GITHUB_TOKEN|github\.token|ACTIONS_RUNTIME_TOKEN/i);
    expect(text).not.toMatch(/pull_request_target|workflow_run/);
  });

  it("pins every action to a full commit SHA with its version as a comment", () => {
    const uses = raw()
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:-\s*)?uses:/.test(line))
      .map((line) => line.trim().replace(/^-\s*/, ""));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      const match = /^uses:\s*([\w.-]+\/[\w.-]+)@([0-9a-f]{40})\s+#\s*(v\d+\.\d+\.\d+)$/.exec(line);
      expect(match, line).not.toBeNull();
      const [, action, sha, version] = match!;
      expect(PINNED_ACTIONS[action!], `${action} is not an approved action`).toBeDefined();
      expect({ sha, version }).toEqual(PINNED_ACTIONS[action!]);
    }
  });

  it("checks out without persisting credentials and sets up Node from .nvmrc with the npm cache", () => {
    for (const [id, definition] of Object.entries(workflow().jobs)) {
      const checkout = definition.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
      expect(checkout?.with?.["persist-credentials"], id).toBe(false);
      const node = definition.steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
      expect(node?.with?.["node-version-file"], id).toBe(".nvmrc");
      expect(node?.with?.cache, id).toBe("npm");
    }
  });

  it("pins Node with an .nvmrc major that package.json engines accept", () => {
    const major = Number(readFileSync(resolve(".nvmrc"), "utf8").trim());
    expect(Number.isInteger(major)).toBe(true);
    const engines = (JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { engines: { node: string } }).engines.node;
    expect(engines).toMatch(new RegExp(`(?:\\^${major}\\.|>=\\s*(?:${major}|${major - 2}|${major - 4})\\.)`));
  });

  it("has the verify, studio and four browser jobs, each browser job after verify", () => {
    expect(Object.keys(workflow().jobs).sort()).toEqual(["e2e", "e2e-commerce", "e2e-contact", "e2e-keyed", "studio", "verify"]);
    for (const id of ["e2e", "e2e-commerce", "e2e-keyed", "e2e-contact"]) expect([job(id).needs].flat(), id).toEqual(["verify"]);
    expect(job("verify").needs).toBeUndefined();
    expect(job("studio").needs).toBeUndefined();
    for (const id of ["verify", "studio", "e2e", "e2e-commerce", "e2e-keyed", "e2e-contact"]) {
      expect(job(id)["runs-on"], id).toBe("ubuntu-latest");
      expect(job(id)["timeout-minutes"], id).toBeGreaterThan(0);
    }
  });

  it("verify installs the Studio before the gates that read its schema, caching both lockfiles", () => {
    // Root typecheck and unit tests import studio/schemaTypes, which needs `sanity` from studio/node_modules.
    const node = job("verify").steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
    expect(String(node?.with?.["cache-dependency-path"]).split(/\s+/).filter(Boolean).sort()).toEqual(["package-lock.json", "studio/package-lock.json"]);
  });

  it("verify runs the gates in order, with the production audit blocking", () => {
    expect(runs("verify").slice(0, 9)).toEqual([
      "npm ci",
      "npm --prefix studio ci",
      "npm run verify:env",
      "npm run typecheck",
      "npm run lint",
      "npm run test:run",
      "npm run build",
      "npm run verify:bundle",
      "npm audit --omit=dev --audit-level=high",
    ]);
    expect(stepRunning("verify", "npm audit --omit=dev --audit-level=high")?.["continue-on-error"]).toBeUndefined();
  });

  it("reports the full audit (dev tooling included) without blocking, and keeps its output", () => {
    const full = job("verify").steps.find((step) => step.run && /npm audit --audit-level=high/.test(step.run) && !step.run.includes("--omit=dev"));
    expect(full?.["continue-on-error"]).toBe(true);
    expect(full?.shell).toBe("bash");
    expect(full?.run).toContain("$GITHUB_STEP_SUMMARY");
    const upload = job("verify").steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("always()");
  });

  it("builds the Studio with placeholder settings and reports its audit without blocking", () => {
    const studio = job("studio");
    expect(studio.env).toEqual({ SANITY_STUDIO_PROJECT_ID: "ci-placeholder", SANITY_STUDIO_DATASET: "production" });
    expect(runs("studio").slice(0, 3)).toEqual(["npm --prefix studio ci", "npm --prefix studio run typecheck", "npm --prefix studio run build"]);
    const node = studio.steps.find((step) => step.uses?.startsWith("actions/setup-node@"));
    expect(node?.with?.["cache-dependency-path"]).toBe("studio/package-lock.json");
    const audit = stepRunning("studio", "npm --prefix studio audit --omit=dev --audit-level=high");
    expect(audit?.["continue-on-error"]).toBe(true);
  });

  it("e2e runs Playwright against next start, waits for health, and uploads the report on failure", () => {
    const e2e = job("e2e");
    expect(e2e.env).toMatchObject({ E2E_PRODUCTION: "1", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3000", PLAYWRIGHT_HTML_OPEN: "never" });
    const commands = runs("e2e");
    const order = ["npm ci", "npx playwright install --with-deps chromium", "npm run build", "next start -p 3000 -H 127.0.0.1", "npx playwright test"].map((command) =>
      commands.findIndex((run) => run.includes(command)),
    );
    expect(order.every((index) => index >= 0), String(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(stepRunning("e2e", "next start")?.run).toContain("http://127.0.0.1:3000/api/health");
    // The e2e build is shaped like Vercel's: root install only, so it proves the deploy builds without the Studio.
    expect(commands.some((run) => run.includes("--prefix studio"))).toBe(false);
    expect(commands.some((run) => run.includes("verify:deployment") && run.includes("--browser"))).toBe(true);
    const upload = e2e.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("failure()");
    expect(String(upload?.with?.path)).toContain("playwright-report");
  });

  it("e2e-commerce mirrors the local commerce run: a sibling copy with the fixture, its own install and build, the shop and commerce specs (T-I6, R130)", () => {
    const commerce = job("e2e-commerce");
    expect(commerce.env).toMatchObject({ E2E_PRODUCTION: "1", E2E_COMMERCE: "1", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3100" });
    const commands = runs("e2e-commerce");
    const order = ["node scripts/e2e/enable-commerce-fixture.mjs ../commerce-copy", "npm ci", "npx playwright install --with-deps chromium", "npm run build", "next start -p 3100 -H 127.0.0.1", "npx playwright test e2e/shop e2e/commerce"].map((command) =>
      commands.findIndex((run) => run.includes(command)),
    );
    expect(order.every((index) => index >= 0), String(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The copy has no .git folder (the fixture refuses one) and the install, build and run all happen inside it.
    expect(stepRunning("e2e-commerce", "enable-commerce-fixture")?.run).toContain("--exclude=./.git");
    for (const command of ["npm ci", "npx playwright install", "npm run build", "next start", "npx playwright test"]) {
      expect(stepRunning("e2e-commerce", command)?.["working-directory" as keyof Step], command).toBe("../commerce-copy");
    }
    expect(stepRunning("e2e-commerce", "next start")?.run).toContain("http://127.0.0.1:3100/api/health");
    const upload = commerce.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("failure()");
    expect(String(upload?.with?.path)).toContain("playwright-report");
  });

  it("e2e-keyed mirrors the local keyed run: placeholder keys at build time, a placeholder cron secret at start, the analytics and observability specs (T-I6, R130)", () => {
    const keyed = job("e2e-keyed");
    expect(keyed.env).toMatchObject({ E2E_PRODUCTION: "1", E2E_ANALYTICS: "1", E2E_SENTRY: "1", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3200" });
    const build = stepRunning("e2e-keyed", "npm run build");
    expect(build?.env).toEqual({
      NEXT_PUBLIC_POSTHOG_KEY: "phc_e2eplaceholder0000000000000000000000000",
      NEXT_PUBLIC_POSTHOG_HOST: "https://ph.example.com",
      NEXT_PUBLIC_SENTRY_DSN: "https://0123456789abcdef0123456789abcdef@o0.ingest.example.com/1",
    });
    const start = stepRunning("e2e-keyed", "next start");
    expect(start?.env).toEqual({ CRON_SECRET: "e2e-placeholder-cron-secret-0123456789abcdef" });
    expect(start?.run).toContain("next start -p 3200 -H 127.0.0.1");
    expect(start?.run).toContain("http://127.0.0.1:3200/api/health");
    const commands = runs("e2e-keyed");
    const order = ["npm ci", "npx playwright install --with-deps chromium", "npm run build", "next start", "npx playwright test e2e/analytics e2e/observability"].map((command) => commands.findIndex((run) => run.includes(command)));
    expect(order.every((index) => index >= 0), String(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const upload = keyed.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("failure()");
    expect(String(upload?.with?.path)).toContain("playwright-report");
  });

  it("e2e-contact runs the open-form contact specs against next start with the placeholder contact environment, so they never sit skipped (R187)", () => {
    const contact = job("e2e-contact");
    expect(contact.name).toBe("Playwright, contact form open (placeholders)");
    expect(contact.env).toMatchObject({ E2E_PRODUCTION: "1", E2E_CONTACT_OPEN: "1", PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3300" });
    const start = stepRunning("e2e-contact", "next start");
    expect(start?.env).toEqual(CONTACT_PLACEHOLDERS);
    expect(start?.run).toContain("next start -p 3300 -H 127.0.0.1");
    expect(start?.run).toContain("http://127.0.0.1:3300/api/health");
    // The placeholders must open the form (R173), or every open-form spec would be skipped or fail.
    expect(contactFormOpen({ ...CONTACT_PLACEHOLDERS })).toBe(true);
    // The build needs none of them: every page renders per request, so `next start` decides.
    expect(stepRunning("e2e-contact", "npm run build")?.env).toBeUndefined();
    const commands = runs("e2e-contact");
    const order = ["npm ci", "npx playwright install --with-deps chromium", "npm run build", "next start", "npx playwright test e2e/contact"].map((command) => commands.findIndex((run) => run.includes(command)));
    expect(order.every((index) => index >= 0), String(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const upload = contact.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(upload?.if).toBe("failure()");
    expect(upload?.with?.name).toBe("playwright-report-contact");
    // The keyless job keeps running the closed-form specs.
    expect(job("e2e").env).not.toHaveProperty("E2E_CONTACT_OPEN");
  });

  it("only calls npm scripts that exist, and never bun", () => {
    const rootScripts = Object.keys((JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { scripts: Record<string, string> }).scripts);
    const studioScripts = Object.keys((JSON.parse(readFileSync(resolve("studio/package.json"), "utf8")) as { scripts: Record<string, string> }).scripts);
    for (const id of Object.keys(workflow().jobs)) {
      for (const run of runs(id)) {
        expect(run, id).not.toMatch(/\bbunx?\b/);
        for (const match of run.matchAll(/npm (--prefix studio )?run ([\w:-]+)/g)) {
          expect(match[1] ? studioScripts : rootScripts, `${id}: ${match[0]}`).toContain(match[2]);
        }
      }
    }
  });
});

/*
 * Ruling R4: npm is the canonical package manager. bun.lock is kept in the repository (never
 * deleted), so Vercel is told explicitly to install from package-lock.json instead of guessing.
 */
describe("Vercel build settings", () => {
  it("installs with npm ci, builds with the repository's build script, then scans the bundle with the deployment's own values (review M7)", () => {
    expect(existsSync(resolve("vercel.json"))).toBe(true);
    const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as Record<string, unknown>;
    // The secret-value rule needs real values, and only the deployment build has them (CI has no
    // secrets). Findings name the file and rule, never the value, so the build log stays clean.
    expect(config).toMatchObject({ framework: "nextjs", installCommand: "npm ci", buildCommand: "npm run build && npm run verify:bundle" });
    expect(JSON.stringify(config)).not.toMatch(/\bbunx?\b|\$\{|secret|token/i);
  });

  it("schedules the email outbox worker once a day, scheduled 06:00 UTC (Hobby fires it between 06:00 and 06:59), because the site stays on Hobby (R180, 2026-10-21; supersedes R134's every-15-minutes Pro schedule, restores R88)", () => {
    const config = JSON.parse(readFileSync(resolve("vercel.json"), "utf8")) as { crons?: unknown };
    expect(config.crons).toEqual([{ path: "/api/cron/email-outbox", schedule: "0 6 * * *" }]);
    expect(existsSync(resolve("app/api/cron/email-outbox/route.ts"))).toBe(true);
  });
});

describe("deployment verifier step (rebrand review C1)", () => {
  it("expects the repository fallback's own hero heading, so a copy change cannot leave CI checking the old one", () => {
    const verify = runs("e2e").find((run) => run.includes("verify:deployment"));
    expect(/--expect-heading "([^"]+)"/.exec(verify ?? "")?.[1]).toBe(SAFE_FALLBACK_CONTENT.hero.title);
  });
});
