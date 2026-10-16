// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODE_INDICATORS,
  deriveSecretRules,
  findTokenShapes,
  publicNamesFromEnvExample,
  scanBuildOutput,
  scanText,
  secretValuesFromEnv,
  serverNamesFromEnvExample,
} from "@/scripts/lib/bundle-secrets";
import { ALLOWED_PUBLIC_NAMES, isAllowedPublicName } from "@/scripts/verify-env";

/*
 * The client-bundle secret scan (plan Task 10; spec §17.9: no service-role or secret value is exposed
 * to the client bundle). Server names come from .env.example and the public allow-list from
 * scripts/verify-env.ts, so a name added there is scanned for without touching the scanner.
 *
 * Token fixtures are assembled at run time from parts, so this public file never contains a string
 * shaped like a real provider key (which a host's push protection would rightly refuse).
 */

const ENV_EXAMPLE = readFileSync(resolve(".env.example"), "utf8");
const rules = () => deriveSecretRules({ envExample: ENV_EXAMPLE, allowedPublicNames: ALLOWED_PUBLIC_NAMES, isAllowedPublicName, env: {} });

const base64url = (value: string) => Buffer.from(value).toString("base64url");
const jwt = (payload: Record<string, unknown>) => [base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), base64url(JSON.stringify(payload)), "c2lnbmF0dXJlLWZpeHR1cmUtbm90LXJlYWwtMTIzNDU2"].join(".");
const RANDOM_BODY = "q7Xk2LmP9vR4tZ8wB3nC6yH1jD5fG0sA";
const token = (...parts: string[]) => parts.join("");

describe("secret names are derived, not hard-coded", () => {
  it("reads every server-only name from .env.example", () => {
    const names = serverNamesFromEnvExample(ENV_EXAMPLE);
    for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "RESEND_FROM", "LEAD_IP_HASH_SECRET", "SANITY_REVALIDATE_SECRET", "SANITY_API_READ_TOKEN", "STAFF_NOTIFICATION_EMAIL", "CRON_SECRET"]) {
      expect(names, name).toContain(name);
    }
    expect(names.some((name) => name.startsWith("NEXT_PUBLIC_"))).toBe(false);
  });

  it("picks up a server name added to .env.example without any scanner change", () => {
    const names = serverNamesFromEnvExample(`${ENV_EXAMPLE}\n# a new one\nNEW_PROVIDER_SECRET=\n`);
    expect(names).toContain("NEW_PROVIDER_SECRET");
    expect(deriveSecretRules({ envExample: `${ENV_EXAMPLE}\nNEW_PROVIDER_SECRET=\n`, allowedPublicNames: ALLOWED_PUBLIC_NAMES, env: {} }).serverNames).toContain("NEW_PROVIDER_SECRET");
  });

  it("lists the public names separately, and every one is on verify-env's allow-list", () => {
    const publicNames = publicNamesFromEnvExample(ENV_EXAMPLE);
    expect(publicNames.length).toBeGreaterThan(0);
    for (const name of publicNames) expect(ALLOWED_PUBLIC_NAMES.has(name), name).toBe(true);
    expect(rules().configErrors).toEqual([]);
  });

  it("accepts a Vercel-namespace name that is not enumerated, and still flags other public names", () => {
    expect(scanText("NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG", "chunk.js", rules())).toEqual([]);
    expect(scanText("NEXT_PUBLIC_EVIL", "chunk.js", rules()).map((finding) => finding.rule)).toEqual(["NEXT_PUBLIC_EVIL"]);
  });

  it("reports a configuration error when .env.example lists a public name verify-env would refuse", () => {
    const derived = deriveSecretRules({ envExample: `${ENV_EXAMPLE}\nNEXT_PUBLIC_RESEND_API_KEY=\n`, allowedPublicNames: ALLOWED_PUBLIC_NAMES, env: {} });
    expect(derived.configErrors).toEqual([".env.example lists NEXT_PUBLIC_RESEND_API_KEY, which scripts/verify-env.ts does not allow"]);
  });

  it("keeps a short explicit list of strings that only server code contains", () => {
    expect([...CODE_INDICATORS]).toEqual(expect.arrayContaining(["submit_lead", "consume_rate_limit", "enqueue_lead_delivery", "api.resend.com", "createHmac"]));
  });
});

describe("secret values from the environment", () => {
  it("collects the values of secret-like server names and the sender/staff addresses, never short or numeric ones", () => {
    const serverNames = serverNamesFromEnvExample(ENV_EXAMPLE);
    const values = secretValuesFromEnv(
      {
        SUPABASE_SERVICE_ROLE_KEY: "  service-role-value-fixture  ",
        LEAD_IP_HASH_SECRET: "x".repeat(40),
        RESEND_FROM: "BIBO Bay <sender@example.com>",
        STAFF_NOTIFICATION_EMAIL: "staff@example.com",
        LEAD_ACK_SEND_LIMIT_PER_HOUR: "60",
        SANITY_STUDIO_ORIGIN: "https://studio.example.com",
        CRON_SECRET: "short",
        NEXT_PUBLIC_APP_URL: "https://site.example.com",
      },
      serverNames,
    );
    expect(values).toEqual([
      { name: "LEAD_IP_HASH_SECRET", value: "x".repeat(40) },
      { name: "RESEND_FROM", value: "sender@example.com" },
      { name: "STAFF_NOTIFICATION_EMAIL", value: "staff@example.com" },
      { name: "SUPABASE_SERVICE_ROLE_KEY", value: "service-role-value-fixture" },
    ]);
  });
});

describe("scanText", () => {
  it("passes ordinary client code", () => {
    const code = 'self.__next_f.push([1,"hello"]);const e=process.env.NODE_ENV;fetch("/api/leads",{method:"POST"});var re_render=1;';
    expect(scanText(code, "chunk.js", rules())).toEqual([]);
  });

  it.each(["SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY", "LEAD_IP_HASH_SECRET", "SANITY_REVALIDATE_SECRET", "SANITY_API_READ_TOKEN", "STAFF_NOTIFICATION_EMAIL", "RESEND_FROM"])("flags the server name %s", (name) => {
    const findings = scanText(`const k=process.env.${name};`, "chunk.js", rules());
    expect(findings).toEqual([{ file: "chunk.js", kind: "server-name", rule: name, detail: `server-only environment name ${name}` }]);
  });

  it("flags a NEXT_PUBLIC_ name that verify-env does not allow, but not an allowed one", () => {
    expect(scanText('const a="NEXT_PUBLIC_SANITY_DATASET";', "chunk.js", rules())).toEqual([]);
    const findings = scanText('const a=process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;', "chunk.js", rules());
    expect(findings).toEqual([{ file: "chunk.js", kind: "public-name", rule: "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", detail: "public name not on the verify-env allow-list: NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY" }]);
  });

  it.each([...CODE_INDICATORS])("flags the server-code indicator %s", (indicator) => {
    const findings = scanText(`x.call("${indicator}")`, "page.html", rules());
    expect(findings.map((finding) => [finding.kind, finding.rule])).toEqual([["code-indicator", indicator]]);
  });

  it("flags a planted secret value without ever repeating it", () => {
    const secret = "planted-service-role-value-0123456789";
    const withValue = deriveSecretRules({ envExample: ENV_EXAMPLE, allowedPublicNames: ALLOWED_PUBLIC_NAMES, env: { SUPABASE_SERVICE_ROLE_KEY: secret } });
    const findings = scanText(`<script>window.k="${secret}"</script>`, "index.html", withValue);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "secret-value", rule: "SUPABASE_SERVICE_ROLE_KEY" });
    expect(JSON.stringify(findings)).not.toContain(secret);
  });
});

describe("token shapes in client output", () => {
  it("flags a three-part JWT whose role is not anon (a service-role key), without repeating it", () => {
    const serviceKey = jwt({ iss: "supabase", role: "service_role", iat: 1_700_000_000 });
    const shapes = findTokenShapes(`const k="${serviceKey}";`);
    expect(shapes).toEqual([{ rule: "jwt", prefix: "eyJ", length: serviceKey.length }]);
    expect(JSON.stringify(scanText(`const k="${serviceKey}";`, "chunk.js", rules()))).not.toContain(serviceKey);
  });

  it("allows a JWT whose payload role is anon: that key is public by design", () => {
    expect(findTokenShapes(`const k="${jwt({ iss: "supabase", role: "anon" })}";`)).toEqual([]);
  });

  it.each([
    ["resend", token("re", "_", "Ab3dE6gH", "_", RANDOM_BODY)],
    ["stripe-style", token("sk", "_live_", RANDOM_BODY)],
    ["generic sk_", token("sk", "_", RANDOM_BODY)],
    ["supabase secret", token("sb", "_secret_", RANDOM_BODY)],
    ["sanity token", token("sk", RANDOM_BODY.repeat(3))],
  ])("flags a %s key", (_label, key) => {
    const shapes = findTokenShapes(`const k='${key}';`);
    expect(shapes).toHaveLength(1);
    expect(key.startsWith(shapes[0]!.prefix)).toBe(true);
  });

  it("ignores identifiers and base64 runs that only share a prefix", () => {
    const text = [
      "function re_render_children_list(){}",
      "var sk_default_options_object_value={};",
      "const skipAnimationFrameOnReducedMotionPreferenceForTheWholeBay=1;",
      `url(data:font/woff2;base64,AAAA${"Qk".repeat(20)}sk${"A1b2C3d4".repeat(12)}+/==)`,
      "sb_publishable_ is public",
    ].join("\n");
    expect(findTokenShapes(text)).toEqual([]);
  });
});

describe("scanBuildOutput (planted secrets in a scratch build)", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function scratchBuild(files: Record<string, string | Buffer>) {
    root = mkdtempSync(join(tmpdir(), "bundle-scan-"));
    for (const [path, content] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return { nextDir: join(root, ".next"), publicDir: join(root, "public") };
  }

  const CLEAN = {
    ".next/static/chunks/app.js": "self.__next_f=self.__next_f||[];console.log('bay');",
    ".next/static/css/app.css": "body{color:#14213d}",
    ".next/static/media/font.woff2": Buffer.from([0, 1, 2, 3, 0, 255]),
    ".next/server/app/_global-error.html": "<!DOCTYPE html><html><body>Error</body></html>",
    ".next/server/app/page.js": "process.env.SUPABASE_SERVICE_ROLE_KEY; // server code is never scanned",
    "public/bibo-logo.svg": "<svg xmlns='http://www.w3.org/2000/svg'/>",
  };

  it("passes a clean build and counts the client files it read", () => {
    const dirs = scratchBuild(CLEAN);
    const result = scanBuildOutput({ ...dirs, rules: rules() });
    expect(result.findings).toEqual([]);
    expect(result.scannedFiles).toBe(4);
  });

  it("fails when a secret name is planted in a client chunk", () => {
    const dirs = scratchBuild({ ...CLEAN, ".next/static/chunks/leak.js": "const k=process.env.SUPABASE_SERVICE_ROLE_KEY;" });
    const result = scanBuildOutput({ ...dirs, rules: rules() });
    expect(result.findings.map((finding) => [finding.file.replace(/\\/g, "/"), finding.rule])).toEqual([[".next/static/chunks/leak.js", "SUPABASE_SERVICE_ROLE_KEY"]]);
  });

  it("fails when a service-role JWT is planted in prerendered HTML", () => {
    const serviceKey = jwt({ role: "service_role" });
    const dirs = scratchBuild({ ...CLEAN, ".next/server/app/_global-error.html": `<html><script>var k="${serviceKey}"</script></html>` });
    const result = scanBuildOutput({ ...dirs, rules: rules() });
    expect(result.findings.map((finding) => [finding.file.replace(/\\/g, "/"), finding.kind, finding.rule])).toEqual([[".next/server/app/_global-error.html", "token-shape", "jwt"]]);
  });

  it("fails when a server-code indicator is planted in a public file", () => {
    const dirs = scratchBuild({ ...CLEAN, "public/notes.txt": "call submit_lead from the browser" });
    expect(scanBuildOutput({ ...dirs, rules: rules() }).findings.map((finding) => finding.rule)).toEqual(["submit_lead"]);
  });

  it("refuses to pass vacuously when there is no client build output", () => {
    const dirs = scratchBuild({ "public/bibo-logo.svg": "<svg/>" });
    expect(() => scanBuildOutput({ ...dirs, rules: rules() })).toThrow(/no client build output/i);
  });
});
