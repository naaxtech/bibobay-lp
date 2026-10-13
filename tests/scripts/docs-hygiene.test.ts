// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Repository documentation (rulings R45, R47, R48). The repository is public, so its docs must hold
 * no local machine paths, no real email addresses (only @example.com placeholders) and no names of
 * private reference projects or internal tooling; and they must describe the code as it is: every
 * command they mention exists, every environment name is documented, and unbuilt parts say so.
 */

const DOCS_DIR = resolve("docs");
const docFiles = () => [
  "README.md",
  "AGENTS.md",
  ...readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => posix.join("docs", entry.name)),
];
/** Also public and also written for this project: the CI workflow and the archived reference note. */
const hygieneFiles = () => [...docFiles(), ".github/workflows/ci.yml", "references/test.md", "studio/README.md"];
const read = (file: string) => readFileSync(resolve(file), "utf8");

const REQUIRED_DOCS = [
  "README.md",
  "AGENTS.md",
  "docs/architecture.md",
  "docs/cms-operations.md",
  "docs/database-security.md",
  "docs/deployment.md",
  "docs/manual-checkout-operations.md",
  "docs/qa-checklist.md",
];

const ABSOLUTE_PATHS = [
  { name: "Windows drive path", pattern: /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?!\/)/ },
  { name: "Unix home path", pattern: /(?:^|[\s`'"(=])(?:\/home\/|\/Users\/|~\/)[^\s]/m },
  { name: "Windows user folder", pattern: /\\Users\\/i },
];
/** An address: the domain ends in a letters-only top-level domain, so `package@1.2.3` is not one. */
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])/g;
/**
 * Private words that must not appear in public files, stored as SHA-256 hashes of the lower-case word
 * so this public test does not publish them itself (two private reference projects and an internal
 * agent tool). Any word token in a scanned file is hashed and compared; `privateWordsIn` returns the
 * offending tokens. The git-ignored working ledger is caught separately by its dotted folder name
 * (`docs/superpowers/`, where the spec and plan live, is a tracked public path and is allowed).
 */
const PRIVATE_WORD_HASHES = new Set([
  "8cfde6efdfc4ed5ab1f6acbbd1ba49bf31932f84d0a4c090eb41c7d151e8b180",
  "8ff92747045c7feb5994066bfbb321915b85f4570e0fbf0ffc50db99621d1c42",
  "52ecbf3904d68afdd0d27116f26ef521220f74bdbca3f58a41c02f9690d721ff",
]);
const LEDGER_FOLDER = /(?<![\w/-])\.superpowers\b/;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function privateWordsIn(text: string, hashes: ReadonlySet<string> = PRIVATE_WORD_HASHES): string[] {
  const tokens = new Set((text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? []).map((token) => token.toLowerCase()));
  return [...tokens].filter((token) => hashes.has(sha256(token)));
}

describe("public-repository hygiene", () => {
  it("has every document the repository promises", () => {
    for (const file of REQUIRED_DOCS) expect(existsSync(resolve(file)), file).toBe(true);
  });

  it.each(["README.md", "AGENTS.md", "docs/architecture.md", ".github/workflows/ci.yml"])("scans %s among the public files", (file) => {
    expect(hygieneFiles()).toContain(file);
  });

  it("contains no local absolute path", () => {
    for (const file of hygieneFiles()) {
      const text = read(file);
      for (const { name, pattern } of ABSOLUTE_PATHS) expect(pattern.exec(text)?.[0] ?? null, `${file}: ${name}`).toBeNull();
    }
  });

  it("contains no email address except @example.com placeholders", () => {
    for (const file of hygieneFiles()) {
      const domains = [...read(file).matchAll(EMAIL)].map((match) => match[1]!.toLowerCase());
      expect(domains.filter((domain) => domain !== "example.com"), file).toEqual([]);
    }
  });

  it("names no private reference project, internal tool or internal ledger", () => {
    for (const file of hygieneFiles()) {
      const text = read(file);
      expect(privateWordsIn(text), file).toEqual([]);
      expect(LEDGER_FOLDER.exec(text)?.[0] ?? null, `${file}: internal ledger folder`).toBeNull();
    }
  });

  it("catches each kind of leak it is meant to catch", () => {
    const leaks = ["see D:/Work/project", "open C:\\Users\\someone\\x", "cd /Users/someone/x", "cat ~/.config", "/home/dev/app"];
    for (const leak of leaks) expect(ABSOLUTE_PATHS.some(({ pattern }) => pattern.test(leak)), leak).toBe(true);
    for (const fine of ["https://example.com/a", "node:fs", "`app/api/health/route.ts`", "a:b"]) expect(ABSOLUTE_PATHS.some(({ pattern }) => pattern.test(fine)), fine).toBe(false);
    expect([..."owner@example.com, staff@example.org".matchAll(EMAIL)].map((match) => match[1])).toEqual(["example.com", "example.org"]);
    expect([..."eslint-config-next@16.3.8 and braces@3.0.3".matchAll(EMAIL)]).toEqual([]);
    expect([..."reach someone.private@gmail.com".matchAll(EMAIL)].map((match) => match[1])).toEqual(["gmail.com"]);
    // The private-word matcher, exercised with a stand-in hash list (the real list is never spelled out here).
    const standIn = new Set([sha256("zebrafish")]);
    expect(privateWordsIn("See the ZebraFish notes.", standIn)).toEqual(["zebrafish"]);
    expect(privateWordsIn("zebrafishes and zebra", standIn)).toEqual([]);
    expect(PRIVATE_WORD_HASHES.size).toBe(3);
    expect(privateWordsIn("Sanity, Supabase, Resend and Vercel host the site.")).toEqual([]);
    expect(LEDGER_FOLDER.test("see .superpowers/sdd/notes.md")).toBe(true);
    expect(LEDGER_FOLDER.test("the plan under `docs/superpowers/plans/`")).toBe(false);
  });
});

describe("documentation matches the code", () => {
  const rootScripts = Object.keys((JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts);
  const studioScripts = Object.keys((JSON.parse(read("studio/package.json")) as { scripts: Record<string, string> }).scripts);

  it("mentions only npm scripts that exist", () => {
    for (const file of [...docFiles(), "studio/README.md"]) {
      const text = read(file);
      const inStudioReadme = file === "studio/README.md";
      for (const match of text.matchAll(/npm (--prefix studio )?run ([\w:-]+)/g)) {
        const scripts = match[1] || inStudioReadme ? studioScripts : rootScripts;
        expect(scripts, `${file}: ${match[0]}`).toContain(match[2]);
      }
    }
  });

  it("documents every environment name from .env.example in docs/deployment.md", () => {
    const names = read(".env.example")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0]!);
    const deployment = read("docs/deployment.md");
    for (const name of names) expect(deployment, name).toContain(`\`${name}\``);
  });

  it("states that manual checkout is not built yet, and promises no procedure", () => {
    const text = read("docs/manual-checkout-operations.md");
    expect(text).toMatch(/not built yet/i);
    expect(text).toMatch(/Task 7/);
    expect(text).toMatch(/Task 8/);
  });

  it("never documents a commerce, tracking or admin route as present", () => {
    const architecture = read("docs/architecture.md");
    for (const route of ["/shop", "/order", "/track", "/admin"]) {
      for (const line of architecture.split(/\r?\n/).filter((entry) => entry.includes(`\`${route}`))) {
        expect(line, line).toMatch(/not built yet/i);
      }
    }
  });

  it("keeps Next's managed agent block in AGENTS.md current and intact", () => {
    const require = createRequire(import.meta.url);
    const { hasCurrentAgentRules, AGENT_RULES_START_MARKER, AGENT_RULES_END_MARKER } = require("next/dist/server/lib/generate-agent-files.js") as {
      hasCurrentAgentRules: (dir: string) => boolean;
      AGENT_RULES_START_MARKER: string;
      AGENT_RULES_END_MARKER: string;
    };
    expect(hasCurrentAgentRules(resolve("."))).toBe(true);
    const agents = read("AGENTS.md");
    expect(agents.split(AGENT_RULES_START_MARKER)).toHaveLength(2);
    expect(agents.split(AGENT_RULES_END_MARKER)).toHaveLength(2);
  });

  // Skipped deliberately: writing AGENTS.md was refused during Task 10, so the project rules are
  // pending owner approval. Remove `.skip` once AGENTS.md carries them.
  it.skip("AGENTS.md carries the project rules below the managed block", () => {
    const agents = read("AGENTS.md");
    const end = agents.indexOf("<!-- END:nextjs-agent-rules -->") + "<!-- END:nextjs-agent-rules -->".length;
    const guidance = agents.slice(end);
    expect(guidance.trim().length).toBeGreaterThan(200);
    for (const rule of [/npm only/i, /never run bun/i, /never delete files/i, /not built yet/i, /no child data/i, /NEXT_PUBLIC_/, /page\.route/, /new numbered migration/i]) expect(guidance, String(rule)).toMatch(rule);
  });

  it("marks the archived reference note as audit-only", () => {
    expect(read("references/test.md").split(/\r?\n/)[0]).toMatch(/audit-only/i);
  });

  it("replaces the AI Studio boilerplate README", () => {
    const readme = read("README.md");
    expect(readme).not.toMatch(/AI Studio|GEMINI_API_KEY|ai\.studio/);
    expect(readme).toMatch(/gh-pages/);
  });
});
