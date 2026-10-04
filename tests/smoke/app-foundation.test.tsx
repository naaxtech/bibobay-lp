import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { metadata } from "@/app/layout";
import Home from "@/app/page";
import { verifyEnvironment } from "@/scripts/verify-env";

// The page reads Sanity through server-only modules; with no Sanity env it serves the safe fallback.
vi.mock("server-only", () => ({}));

afterEach(() => {
  cleanup();
});

describe("root page", () => {
  it("renders the landing hero title as its single level-one heading", async () => {
    render(await Home());
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("Where bright little adventures begin.");
  });

  it("names the BIBO brand with the canonical logo in the site header", async () => {
    render(await Home());
    expect(within(screen.getByRole("banner")).getByRole("img", { name: "BIBO" }).getAttribute("src")).toBe("/bibo-logo.svg");
  });

  it("states the brand idea without unsupported claims", async () => {
    const { container } = render(await Home());
    const text = container.textContent ?? "";
    expect(text).toContain("Bright minds. Kind hearts. Better humans.");
    // No fabricated social proof, counts, experts, testimonials or dates.
    expect(text).not.toMatch(/\d[\d,.]*\s*\+?\s*(families|parents|users|kids|children|downloads)/i);
    expect(text).not.toMatch(/testimonial|expert|trusted by|award|coming (in|on) \d/i);
  });

  it("renders inside a main landmark", async () => {
    render(await Home());
    expect(screen.getByRole("main")).toBeTruthy();
  });
});

describe("root metadata", () => {
  it("uses the BIBO title", () => {
    const title = typeof metadata.title === "string" ? metadata.title : JSON.stringify(metadata.title);
    expect(title).toMatch(/BIBO/);
  });

  it("does not carry unsupported skeleton metadata", () => {
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toMatch(/trusted children/i);
    expect(serialized).not.toMatch(/AI Studio|Gemini/i);
    expect(serialized).not.toMatch(/react-example/i);
    // Large-image twitter card without a real image is unsupported until assets exist.
    expect(serialized).not.toMatch(/summary_large_image/);
  });
});

describe("verifyEnvironment", () => {
  it("passes an empty environment in development", () => {
    const report = verifyEnvironment({}, "development");
    expect(report.ok).toBe(true);
    expect(report.phase).toBe("development");
    expect(report.errors).toEqual([]);
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SANITY_REVALIDATE_SECRET",
    "NEXT_PUBLIC_SANITY_API_READ_TOKEN",
    "NEXT_PUBLIC_SANITY_WRITE_TOKEN",
    "NEXT_PUBLIC_RESEND_API_KEY",
    "NEXT_PUBLIC_PRIVATE_KEY",
    "NEXT_PUBLIC_CRON_SECRET",
  ])("rejects server secret name %s under NEXT_PUBLIC_", (name) => {
    const report = verifyEnvironment({ [name]: "super-sensitive-value-123" }, "production");
    expect(report.ok).toBe(false);
    expect(report.forbiddenPublic).toContain(name);
    expect(report.errors.join("\n")).toContain(name);
  });

  it("rejects a Supabase secret key value exposed under a public name", () => {
    const report = verifyEnvironment(
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_abcdef0123456789" },
      "production",
    );
    expect(report.ok).toBe(false);
    expect(report.forbiddenPublic).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("rejects a server credential copied into an allowed public field", () => {
    const report = verifyEnvironment(
      {
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "copied-private-value",
        SUPABASE_SERVICE_ROLE_KEY: "copied-private-value",
      },
      "production",
    );
    expect(report.ok).toBe(false);
    expect(report.forbiddenPublic).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    expect(JSON.stringify(report)).not.toContain("copied-private-value");
  });

  it("allows legitimate public configuration", () => {
    const report = verifyEnvironment(
      {
        NEXT_PUBLIC_SANITY_PROJECT_ID: "abc123",
        NEXT_PUBLIC_SANITY_DATASET: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
        SUPABASE_SERVICE_ROLE_KEY: "server-only-value",
      },
      "production",
    );
    expect(report.ok).toBe(true);
    expect(report.forbiddenPublic).toEqual([]);
  });

  it("never includes secret values in the report", () => {
    const secret = ["fixture", "private", "value"].join("-");
    const report = verifyEnvironment(
      { NEXT_PUBLIC_RESEND_API_KEY: secret, RESEND_API_KEY: secret },
      "production",
    );
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("rejects an unknown phase", () => {
    expect(() => verifyEnvironment({}, "staging" as never)).toThrow(/phase/i);
  });
});

describe("environment CLI", () => {
  it("rejects a forbidden public variable supplied only by .env.local without printing its value", () => {
    const projectDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bibobay-env-"));
    const secret = "synthetic-private-fixture-value";
    writeFileSync(join(projectDir, ".env.local"), `NEXT_PUBLIC_RESEND_API_KEY=${secret}\n`);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("NEXT_PUBLIC_")),
    );
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/verify-env.ts"), "production"],
      { cwd: projectDir, env: { ...env, NODE_ENV: "production" }, encoding: "utf8" },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_RESEND_API_KEY");
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });
  it("uses production file precedence over a secret value in .env.local", () => {
    const projectDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bibobay-env-"));
    writeFileSync(join(projectDir, ".env.local"), "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_secret_fixture\n");
    writeFileSync(join(projectDir, ".env.production.local"), "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fixture\n");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("NEXT_PUBLIC_")),
    );
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/verify-env.ts"), "production"],
      { cwd: projectDir, env: { ...env, NODE_ENV: "production" }, encoding: "utf8" },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });
  it("loads .env.test but skips .env.local during the test phase", () => {
    const projectDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bibobay-env-"));
    writeFileSync(join(projectDir, ".env.local"), "NEXT_PUBLIC_RESEND_API_KEY=ignored-local-value\n");
    writeFileSync(join(projectDir, ".env.test"), "NEXT_PUBLIC_RESEND_API_KEY=forbidden-test-value\n");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("NEXT_PUBLIC_")),
    );
    const result = spawnSync(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/verify-env.ts"), "test"],
      { cwd: projectDir, env: { ...env, NODE_ENV: "production" }, encoding: "utf8" },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_RESEND_API_KEY");
    expect(`${result.stdout}${result.stderr}`).not.toContain("forbidden-test-value");
  });
});

describe("Node compatibility", () => {
  it("declares only Node versions supported by the pinned test environment", () => {
    const app = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { engines: { node: string } };
    const jsdom = JSON.parse(readFileSync(resolve("node_modules/jsdom/package.json"), "utf8")) as { engines: { node: string } };
    expect(app.engines.node).toBe(jsdom.engines.node);
  });
});

describe("production build gate", () => {
  it("blocks a secret in an isolated .env.local before Next compiles", () => {
    const projectDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "bibobay-build-"));
    writeFileSync(join(projectDir, ".env.local"), "NEXT_PUBLIC_RESEND_API_KEY=synthetic-fixture-only\n");
    const app = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: { build: string };
    };
    const verifier = `node ${[resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/verify-env.ts")]
      .map((part) => `"${part.replaceAll("\\", "/")}"`).join(" ")}`;
    writeFileSync(join(projectDir, "package.json"), JSON.stringify({
      private: true,
      scripts: { build: app.scripts.build, "verify:env": verifier },
    }));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("NEXT_PUBLIC_")),
    );
    const result = spawnSync("npm run build", {
      cwd: projectDir,
      env: { ...env, NODE_ENV: "production" },
      encoding: "utf8",
      shell: true,
      timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_RESEND_API_KEY");
    expect(`${result.stdout}${result.stderr}`).not.toContain("Creating an optimized production build");
    expect(`${result.stdout}${result.stderr}`).not.toContain("synthetic-fixture-only");
  }, 35_000);

  it("checks production environment before launching the Next compiler", () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("NEXT_PUBLIC_")),
    );
    const result = spawnSync("npm run build", {
      cwd: process.cwd(),
      env: { ...env, NODE_ENV: "production", NEXT_PUBLIC_RESEND_API_KEY: "synthetic-build-gate-value" },
      encoding: "utf8",
      shell: true,
      timeout: 120_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NEXT_PUBLIC_RESEND_API_KEY");
    expect(`${result.stdout}${result.stderr}`).not.toContain("Creating an optimized production build");
    expect(`${result.stdout}${result.stderr}`).not.toContain("synthetic-build-gate-value");
  }, 125_000);
});
