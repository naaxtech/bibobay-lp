import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { verifyEnvironment } from "@/scripts/verify-env";

/*
 * The secret boundary for lead capture (plan Global Constraints; spec §3 ruling 10): every key the
 * lead route needs is a server name, documented in .env.example without a public prefix, refused by
 * scripts/verify-env.ts if anyone adds a NEXT_PUBLIC_ copy, and unreachable from the browser form.
 */
const SERVER_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "RESEND_FROM", "RESEND_REPLY_TO", "STAFF_NOTIFICATION_EMAIL", "LEAD_IP_HASH_SECRET", "LEAD_ACK_SEND_LIMIT_PER_HOUR"];

function envExampleNames() {
  return readFileSync(resolve(".env.example"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]!);
}

describe("lead environment names", () => {
  it("documents every server name the lead route reads in .env.example, unprefixed", () => {
    const names = envExampleNames();
    for (const name of SERVER_NAMES) expect(names, name).toContain(name);
    for (const name of SERVER_NAMES) expect(names, name).not.toContain(`NEXT_PUBLIC_${name}`);
  });

  it("adds no new public name: the browser needs nothing for leads", () => {
    const publicNames = envExampleNames().filter((name) => name.startsWith("NEXT_PUBLIC_")).sort();
    expect(publicNames).toEqual([
      "NEXT_PUBLIC_APP_URL",
      // Ruling R70 (visit statistics), not leads: the PostHog project key and host.
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_SANITY_API_VERSION",
      "NEXT_PUBLIC_SANITY_DATASET",
      "NEXT_PUBLIC_SANITY_PROJECT_ID",
      // Task 10M-a (error monitoring), not leads.
      "NEXT_PUBLIC_SENTRY_DSN",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      // Bot check (Cloudflare Turnstile): a site key is public by design; its secret stays a server name.
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    ]);
  });

  it("documents TURNSTILE_SECRET_KEY as a server name and refuses a public copy", () => {
    expect(envExampleNames()).toContain("TURNSTILE_SECRET_KEY");
    expect(envExampleNames()).not.toContain("NEXT_PUBLIC_TURNSTILE_SECRET_KEY");
    expect(verifyEnvironment({ NEXT_PUBLIC_TURNSTILE_SECRET_KEY: "value" }, "production").forbiddenPublic).toContain("NEXT_PUBLIC_TURNSTILE_SECRET_KEY");
  });

  it.each(["NEXT_PUBLIC_LEAD_IP_HASH_SECRET", "NEXT_PUBLIC_RESEND_FROM", "NEXT_PUBLIC_STAFF_NOTIFICATION_EMAIL"])("refuses %s", (name) => {
    const report = verifyEnvironment({ [name]: "value" }, "production");
    expect(report.forbiddenPublic).toContain(name);
  });

  it("refuses the address-hash secret copied into an allowed public field, without echoing it", () => {
    const secret = ["hash", "secret", "fixture"].join("-");
    const report = verifyEnvironment({ LEAD_IP_HASH_SECRET: secret, NEXT_PUBLIC_APP_URL: secret }, "production");
    expect(report.forbiddenPublic).toEqual(["NEXT_PUBLIC_APP_URL"]);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it.each([
    ["CRON_SECRET", "NEXT_PUBLIC_CRON_SECRET"],
    ["LEAD_ACK_SEND_LIMIT_PER_HOUR", "NEXT_PUBLIC_LEAD_ACK_SEND_LIMIT_PER_HOUR"],
  ])("keeps %s server-only", (_name, publicName) => {
    expect(verifyEnvironment({ [publicName]: "60" }, "production").forbiddenPublic).toEqual([publicName]);
  });
});

describe("address-hash secret strength (M8)", () => {
  it("fails a production check when the secret is set but shorter than 32 characters, without echoing it", () => {
    const secret = "s".repeat(31);
    const report = verifyEnvironment({ LEAD_IP_HASH_SECRET: secret }, "production");
    expect(report.ok).toBe(false);
    expect(report.forbiddenPublic).toEqual([]);
    expect(report.errors).toEqual(["LEAD_IP_HASH_SECRET must be at least 32 characters"]);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("passes a production check with a secret of 32 or more characters", () => {
    expect(verifyEnvironment({ LEAD_IP_HASH_SECRET: "s".repeat(32) }, "production").ok).toBe(true);
  });

  it("passes a production check with no secret at all: leads then stay unconfigured and the route answers 503", () => {
    expect(verifyEnvironment({}, "production").ok).toBe(true);
    expect(verifyEnvironment({ LEAD_IP_HASH_SECRET: "   " }, "production").ok).toBe(true);
  });

  it("does not fail a development or test check for a short local secret; the route still treats storage as unconfigured", () => {
    expect(verifyEnvironment({ LEAD_IP_HASH_SECRET: "short" }, "development").ok).toBe(true);
    expect(verifyEnvironment({ LEAD_IP_HASH_SECRET: "short" }, "test").ok).toBe(true);
  });
});

describe("cron secret strength (Task 8a, N4)", () => {
  it("fails a production check when CRON_SECRET is set but shorter than the shared 32-character minimum, without echoing it", () => {
    const secret = "c".repeat(31);
    const report = verifyEnvironment({ CRON_SECRET: secret }, "production");
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual(["CRON_SECRET must be at least 32 characters"]);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("passes with 32 or more characters, with none (the worker answers 503), and for short local values", () => {
    expect(verifyEnvironment({ CRON_SECRET: "c".repeat(32) }, "production").ok).toBe(true);
    expect(verifyEnvironment({}, "production").ok).toBe(true);
    expect(verifyEnvironment({ CRON_SECRET: "short" }, "development").ok).toBe(true);
  });
});

describe("Cloudflare origin secret (R248)", () => {
  it("fails a production check when CLOUDFLARE_ORIGIN_SECRET is set but malformed, naming the variable and never the value", () => {
    for (const secret of ["s".repeat(31), "s".repeat(257), `${"s".repeat(40)} x`, `${"s".repeat(40)}!`]) {
      const report = verifyEnvironment({ CLOUDFLARE_ORIGIN_SECRET: secret }, "production");
      expect(report.ok).toBe(false);
      expect(report.errors).toEqual(["CLOUDFLARE_ORIGIN_SECRET: must be 32 to 256 letters, digits, hyphens or underscores; the visitor address would not be read from Cloudflare"]);
      expect(JSON.stringify(report)).not.toContain(secret);
    }
  });

  it("passes with a valid secret, with none, and for any value outside production", () => {
    expect(verifyEnvironment({ CLOUDFLARE_ORIGIN_SECRET: "a-B_9".repeat(8) }, "production").ok).toBe(true);
    expect(verifyEnvironment({}, "production").ok).toBe(true);
    expect(verifyEnvironment({ CLOUDFLARE_ORIGIN_SECRET: "" }, "production").ok).toBe(true);
    expect(verifyEnvironment({ CLOUDFLARE_ORIGIN_SECRET: "short" }, "development").ok).toBe(true);
  });

  it("keeps CLOUDFLARE_ORIGIN_SECRET server-only", () => {
    expect(verifyEnvironment({ NEXT_PUBLIC_CLOUDFLARE_ORIGIN_SECRET: "x" }, "production").forbiddenPublic).toEqual(["NEXT_PUBLIC_CLOUDFLARE_ORIGIN_SECRET"]);
  });
});

/** Relative and `@/` imports of one source file, resolved to files on disk. */
function localImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers = Array.from(source.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm), (match) => match[1] ?? match[2]!);
  return specifiers.flatMap((specifier) => {
    if (specifier === "server-only") return ["server-only"];
    const base = specifier.startsWith("@/") ? resolve(specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
    if (!base) return [];
    for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]) {
      try {
        readFileSync(candidate);
        return [candidate];
      } catch {
        // try the next extension
      }
    }
    return [];
  });
}

describe("the browser form's import graph", () => {
  it("never reaches a server-only module, Supabase, Resend or process.env", () => {
    const seen = new Set<string>();
    const queue = [resolve("components/forms/LeadForm.tsx")];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      expect(file, "client graph imports server-only").not.toBe("server-only");
      if (file === "server-only") continue;
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/@supabase\/|from ["']resend["']|process\.env|SERVICE_ROLE|RESEND_API_KEY|LEAD_IP_HASH_SECRET/);
      queue.push(...localImports(file));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("is matched by the order and tracking forms' graphs (Task 7c): no server-only module, Supabase or secret", () => {
    const seen = new Set<string>();
    const queue = ["components/shop/OrderRequest.tsx", "components/forms/OrderForm.tsx", "components/forms/TrackOrderForm.tsx", "components/orders/OrderStatusView.tsx"].map((file) => resolve(file));
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      expect(file, "client graph imports server-only").not.toBe("server-only");
      if (file === "server-only") continue;
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/@supabase\/|from ["']resend["']|from ["']zod["']|process\.env|SERVICE_ROLE|RESEND_API_KEY|LEAD_IP_HASH_SECRET/);
      queue.push(...localImports(file));
    }
    expect([...seen].some((file) => file.endsWith(resolve("lib/orders/fields.ts")))).toBe(true);
  });

  it("the contact form's graph never reaches server-only, Supabase, zod, process.env or a secret, and includes the shared field rules", () => {
    const seen = new Set<string>();
    const queue = [resolve("components/forms/ContactForm.tsx")];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      expect(file, "client graph imports server-only").not.toBe("server-only");
      if (file === "server-only") continue;
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/@supabase\/|from ["']resend["']|from ["']zod["']|process\.env|SERVICE_ROLE|RESEND_API_KEY|LEAD_IP_HASH_SECRET/);
      queue.push(...localImports(file));
    }
    expect([...seen].some((file) => file.endsWith(resolve("lib/contact/fields.ts")))).toBe(true);
  });
});
