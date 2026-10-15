// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Repository hygiene (rulings R45, R47, R48). The repository is public, so no tracked file may hold
 * a local machine path, a real email address (only domains reserved for examples) or the name of a
 * private reference project or internal tooling; and the docs must describe the code as it is: every
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
/**
 * Review M5: every tracked text file is public, not just the docs, so all of them are scanned: code
 * comments, tests, specs, workflows and configuration included. Left out: the planning documents
 * under docs/superpowers/ (an owner decision is pending on them), lockfiles (generated), binary
 * files, and the legacy skeleton archive (never edited).
 */
const HYGIENE_EXCLUDED = [/^docs\/superpowers\//, /(^|\/)(package-lock\.json|bun\.lock)$/, /^bibo-skeleton-1$/];
const BINARY_FILE = /\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|webm|glb)$/i;
const trackedFiles = () => execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const hygieneFiles = () => trackedFiles().filter((file) => !BINARY_FILE.test(file) && !HYGIENE_EXCLUDED.some((pattern) => pattern.test(file)) && existsSync(resolve(file)));
/**
 * This file holds the deliberate probes for the path, address and ledger rules (the self-test at the
 * end), so it is the one file those three rules skip. The private-word rule still scans it.
 */
const SELF = "tests/scripts/docs-hygiene.test.ts";
const probeFreeFiles = () => hygieneFiles().filter((file) => file !== SELF);
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
/** URL credentials (`scheme://user:pass@host`) are not an address; test fixtures use them to probe URL checks. */
const IN_URL_CREDENTIALS = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@"'`:]*:[^\s/@"'`]*$/;
/** Domains reserved for documentation and tests (RFC 2606, RFC 6761): never a real person's address. */
const RESERVED_DOMAIN = /(?:^|\.)example\.(?:com|net|org)$|\.(?:example|test|invalid|localhost)$/i;
function addressDomainsIn(text: string): string[] {
  return [...text.matchAll(EMAIL)].filter((match) => !IN_URL_CREDENTIALS.test(text.slice(0, match.index))).map((match) => match[1]!.toLowerCase());
}
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
const LEDGER_FOLDER = /(?<![\w-])\.superpowers\b/;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/**
 * Word tokens to hash: each full token (`[A-Za-z][A-Za-z0-9_-]*`) and also each letter run and
 * camel-case part inside it, so `<word>-agent`, `<word>_notes` and `<Word>Agent` are all caught.
 */
function wordsOf(text: string): Set<string> {
  const words = new Set<string>();
  for (const token of text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? []) {
    words.add(token.toLowerCase());
    for (const run of token.match(/[A-Za-z]+/g) ?? []) {
      words.add(run.toLowerCase());
      for (const part of run.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? []) words.add(part.toLowerCase());
    }
  }
  return words;
}
function privateWordsIn(text: string, hashes: ReadonlySet<string> = PRIVATE_WORD_HASHES): string[] {
  return [...wordsOf(text)].filter((word) => hashes.has(sha256(word)));
}

describe("public-repository hygiene", () => {
  it("has every document the repository promises", () => {
    for (const file of REQUIRED_DOCS) expect(existsSync(resolve(file)), file).toBe(true);
  });

  it.each(["README.md", "AGENTS.md", "docs/architecture.md", ".github/workflows/ci.yml", "scripts/lib/deployment-checks.ts", "lib/leads/submit.ts", "tests/scripts/docs-hygiene.test.ts", "e2e/leads/lead-form.spec.ts", "supabase/migrations/0001_leads_and_security.sql", "studio/schemaTypes/index.ts", "next.config.ts"])("scans %s among the public files", (file) => {
    expect(hygieneFiles()).toContain(file);
  });

  it("leaves out only the pending planning docs, lockfiles, binaries and the legacy archive", () => {
    const scanned = new Set(hygieneFiles());
    const skipped = trackedFiles().filter((file) => !scanned.has(file));
    for (const file of skipped) expect(BINARY_FILE.test(file) || HYGIENE_EXCLUDED.some((pattern) => pattern.test(file)), file).toBe(true);
  });

  it("contains no local absolute path", () => {
    for (const file of probeFreeFiles()) {
      const text = read(file);
      for (const { name, pattern } of ABSOLUTE_PATHS) expect(pattern.exec(text)?.[0] ?? null, `${file}: ${name}`).toBeNull();
    }
  });

  it("contains no email address except on domains reserved for examples", () => {
    for (const file of probeFreeFiles()) {
      expect(addressDomainsIn(read(file)).filter((domain) => !RESERVED_DOMAIN.test(domain)), file).toEqual([]);
    }
  });

  it("names no private reference project, internal tool or internal ledger", () => {
    for (const file of hygieneFiles()) expect(privateWordsIn(read(file)), file).toEqual([]);
    for (const file of probeFreeFiles()) expect(LEDGER_FOLDER.exec(read(file))?.[0] ?? null, `${file}: internal ledger folder`).toBeNull();
  });

  it("catches each kind of leak it is meant to catch", () => {
    const leaks = ["see D:/Work/project", "open C:\\Users\\someone\\x", "cd /Users/someone/x", "cat ~/.config", "/home/dev/app"];
    for (const leak of leaks) expect(ABSOLUTE_PATHS.some(({ pattern }) => pattern.test(leak)), leak).toBe(true);
    for (const fine of ["https://example.com/a", "node:fs", "`app/api/health/route.ts`", "a:b"]) expect(ABSOLUTE_PATHS.some(({ pattern }) => pattern.test(fine)), fine).toBe(false);
    expect([..."owner@example.com, staff@example.org".matchAll(EMAIL)].map((match) => match[1])).toEqual(["example.com", "example.org"]);
    expect([..."eslint-config-next@16.3.8 and braces@3.0.3".matchAll(EMAIL)]).toEqual([]);
    expect([..."reach someone.private@gmail.com".matchAll(EMAIL)].map((match) => match[1])).toEqual(["gmail.com"]);
    expect(addressDomainsIn("reach someone.private@gmail.com or mailto:team@bibobay.example")).toEqual(["gmail.com", "bibobay.example"]);
    expect(addressDomainsIn("connect to https://user:secret@db.host-name.co/x and https://u:@db2.host-name.co")).toEqual([]);
    // Only the credentials form (`scheme://user:pass@host`) is exempt: an address dressed as a URL is still an address.
    for (const disguised of ["https://name@gmail.com", "// name@gmail.com", "//name@gmail.com", "ftp://me@gmail.com/x"]) expect(addressDomainsIn(disguised), disguised).toEqual(["gmail.com"]);
    for (const reserved of ["example.com", "studio.example.com", "example.org", "bibobay.example", "a.test"]) expect(RESERVED_DOMAIN.test(reserved), reserved).toBe(true);
    for (const real of ["gmail.com", "examples.com", "example.co", "my-example.com"]) expect(RESERVED_DOMAIN.test(real), real).toBe(false);
    expect(probeFreeFiles()).not.toContain(SELF);
    expect(hygieneFiles()).toContain(SELF);
    // The private-word matcher, exercised with a stand-in hash list (the real list is never spelled out here).
    const standIn = new Set([sha256("zebrafish")]);
    expect(privateWordsIn("See the ZebraFish notes.", standIn)).toEqual(["zebrafish"]);
    expect(privateWordsIn("zebrafishes and zebra", standIn)).toEqual([]);
    // Review M5: joined, snake-case and camel-case variants are caught too.
    for (const variant of ["zebrafish-agent", "zebrafish_reference", "ZebrafishAgent", "useZebrafish", "the zebrafish2 build"]) expect(privateWordsIn(variant, standIn), variant).toEqual(["zebrafish"]);
    expect(PRIVATE_WORD_HASHES.size).toBe(3);
    expect(privateWordsIn("Sanity, Supabase, Resend and Vercel host the site.")).toEqual([]);
    for (const ledger of ["see .superpowers/sdd/notes.md", "./.superpowers/sdd", "repo/.superpowers/x"]) expect(LEDGER_FOLDER.test(ledger), ledger).toBe(true);
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

  it("states that the staff side of manual checkout is not built yet, and promises no procedure", () => {
    const text = read("docs/manual-checkout-operations.md");
    expect(text).toMatch(/not built yet/i);
    expect(text).toMatch(/Task 7c/);
    expect(text).toMatch(/Task 8/);
    // Task 7c built the customer side; nobody can manage orders until Task 8, so commerce stays off.
    expect(text).toMatch(/must stay off/i);
  });

  it("never documents an admin route as present", () => {
    const architecture = read("docs/architecture.md");
    for (const line of architecture.split(/\r?\n/).filter((entry) => entry.startsWith("| `/admin"))) {
      expect(line, line).toMatch(/not built yet/i);
    }
  });

  it("documents the shop, order and tracking pages as built, behind their switches, and never indexed (Tasks 7b, 7c)", () => {
    const lines = read("docs/architecture.md").split(/\r?\n/);
    const shop = lines.find((line) => line.startsWith("| `/shop`, `/shop/[slug]` |")) ?? "";
    expect(shop).not.toMatch(/not built yet/i);
    expect(shop).toContain("ƒ");
    expect(shop).toMatch(/404 unless commerce is enabled/);
    const order = lines.find((entry) => entry.startsWith("| `/order` |")) ?? "";
    const tracking = lines.find((entry) => entry.startsWith("| `/track`, `/orders/[token]` |")) ?? "";
    for (const [route, line] of [["/order", order], ["/track", tracking]] as const) {
      expect(line, route).not.toMatch(/not built yet/i);
      expect(line, route).toContain("ƒ");
      expect(line, route).toMatch(/noindex/);
      expect(line, route).toMatch(/Task 7c/);
    }
    expect(order).toMatch(/404 unless commerce is enabled/);
    expect(tracking).toMatch(/404 unless commerce and tracking are enabled/);
    expect(tracking).toMatch(/no-store/);
    const readme = read("README.md").split(/\r?\n/);
    expect(readme.find((line) => line.includes("`/shop`")) ?? "", "README shop row").toMatch(/\| built \(Task 7b/);
    expect(readme.find((line) => line.startsWith("| Order and tracking pages")) ?? "", "README order row").toMatch(/\| built \(Task 7c\)/);
  });

  it("documents the order consent sentence and the order countries for editors (Task 7c)", () => {
    const cms = read("docs/cms-operations.md");
    for (const field of ["orderConsentCopy", "orderConsentCopyVersion", "orderCountries"]) expect(cms, field).toContain(`\`${field}\``);
    const commerce = cms.split(/\r?\n/).find((line) => line.startsWith("| `commerceEnabled` |")) ?? "";
    expect(commerce).not.toMatch(/not built yet \(Task 7c\)/);
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
