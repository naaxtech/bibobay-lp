import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";

import { PRIVATE_NAME_PATTERN } from "../verify-env";

/*
 * Client-bundle secret scan (plan Task 10; spec §17.9: no service-role or secret value reaches the
 * client bundle or the repository).
 *
 * What counts as "client output": everything under `.next/static`, every prerendered response Next
 * keeps under `.next/server` (`*.html`, `*.rsc`, `*.body`), and `public/`. Server code
 * (`.next/server/**.js`) is never scanned: it is supposed to read server settings.
 *
 * The rules are derived, not hard-coded:
 *   - server names: every name in .env.example without the NEXT_PUBLIC_ prefix;
 *   - public names: scripts/verify-env.ts's allow-list; any other NEXT_PUBLIC_ name fails;
 *   - secret values: the values of credential-like server names in the scanning environment
 *     (verify-env's own pattern), plus the sender and staff addresses;
 *   - a short explicit list of strings only server code contains (CODE_INDICATORS);
 *   - token shapes: JWTs that are not the public anon role, Resend, `sk_`/Sanity and Supabase secret keys.
 * Findings never repeat a secret value or a matched token.
 */

/** Strings that only appear in server code: database functions and tables, the mail API, HMAC. */
export const CODE_INDICATORS: readonly string[] = Object.freeze([
  "submit_lead",
  "consume_rate_limit",
  "enqueue_lead_delivery",
  "record_lead_delivery_attempt",
  "lead_submissions",
  "lead_delivery_events",
  "rate_limit_buckets",
  "api.resend.com",
  "createHmac",
]);

/** Server names whose values are addresses rather than credentials, but still private. */
export const ADDRESS_NAMES: ReadonlySet<string> = new Set(["RESEND_FROM", "STAFF_NOTIFICATION_EMAIL"]);
/** Shorter values match too much by accident ("60", "true", a dataset name). */
const MIN_SECRET_VALUE_LENGTH = 8;

export type FindingKind = "server-name" | "public-name" | "code-indicator" | "secret-value" | "token-shape";

export interface Finding {
  file: string;
  kind: FindingKind;
  rule: string;
  detail: string;
}

export interface SecretRules {
  serverNames: string[];
  publicNames: string[];
  allowedPublicNames: ReadonlySet<string>;
  secretValues: Array<{ name: string; value: string }>;
  /** Problems with the inputs themselves (e.g. .env.example lists a public name verify-env refuses). */
  configErrors: string[];
}

function envExampleNames(envExample: string): string[] {
  const names = envExample
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim())
    .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name));
  return [...new Set(names)];
}

export function serverNamesFromEnvExample(envExample: string): string[] {
  return envExampleNames(envExample).filter((name) => !name.startsWith("NEXT_PUBLIC_"));
}

export function publicNamesFromEnvExample(envExample: string): string[] {
  return envExampleNames(envExample).filter((name) => name.startsWith("NEXT_PUBLIC_"));
}

/** `Name <local@domain>` → `local@domain`; anything else unchanged. */
const addressOf = (value: string) => /<([^<>\s]+@[^<>\s]+)>/.exec(value)?.[1] ?? value;

/** The values to look for, sorted by name. Only names declared server-side are read; values are never logged. */
export function secretValuesFromEnv(env: Readonly<Record<string, string | undefined>>, serverNames: readonly string[]): Array<{ name: string; value: string }> {
  const values: Array<{ name: string; value: string }> = [];
  for (const name of [...serverNames].sort()) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    if (ADDRESS_NAMES.has(name)) {
      const address = addressOf(raw);
      if (address.length >= MIN_SECRET_VALUE_LENGTH) values.push({ name, value: address });
    } else if (PRIVATE_NAME_PATTERN.test(name) && raw.length >= MIN_SECRET_VALUE_LENGTH) {
      values.push({ name, value: raw });
    }
  }
  return values;
}

export function deriveSecretRules({ envExample, allowedPublicNames, env }: { envExample: string; allowedPublicNames: ReadonlySet<string>; env: Readonly<Record<string, string | undefined>> }): SecretRules {
  const serverNames = serverNamesFromEnvExample(envExample);
  const publicNames = publicNamesFromEnvExample(envExample);
  const configErrors = publicNames
    .filter((name) => !allowedPublicNames.has(name))
    .map((name) => `.env.example lists ${name}, which scripts/verify-env.ts does not allow`);
  if (serverNames.length === 0) configErrors.push(".env.example lists no server name; the scan would check nothing");
  return { serverNames, publicNames, allowedPublicNames, secretValues: secretValuesFromEnv(env, serverNames), configErrors };
}

export interface TokenShape {
  rule: string;
  /** The rule's fixed prefix: enough to locate the leak, never the token itself. */
  prefix: string;
  length: number;
}

/** Random key material mixes digits with both letter cases; identifiers and words rarely do. */
const looksRandom = (body: string) => /\d/.test(body) && /[a-z]/.test(body) && /[A-Z]/.test(body);

/** A JWT whose payload says `role: anon` is Supabase's public key by design; every other JWT is not. */
function isPublicAnonJwt(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { role?: unknown };
    return payload.role === "anon";
  } catch {
    return false;
  }
}

const TOKEN_RULES: Array<{ rule: string; prefix: string; pattern: RegExp; body: (match: string) => string; accept?: (match: string) => boolean }> = [
  {
    rule: "jwt",
    prefix: "eyJ",
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])/g,
    body: (match) => match,
    accept: (match) => !isPublicAnonJwt(match),
  },
  // Resend: re_<id>_<secret>.
  { rule: "resend-key", prefix: "re_", pattern: /(?<![A-Za-z0-9_])re_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}(?![A-Za-z0-9_])/g, body: (match) => match.slice(3) },
  // Supabase's new secret keys (the publishable sb_publishable_ key is public by design).
  { rule: "supabase-secret-key", prefix: "sb_secret_", pattern: /(?<![A-Za-z0-9_])sb_secret_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g, body: (match) => match.slice(10) },
  // sk_ / sk_live_ / sk_test_ secret keys.
  { rule: "sk-key", prefix: "sk_", pattern: /(?<![A-Za-z0-9_])sk_(?:(?:live|test)_)?[A-Za-z0-9]{20,}(?![A-Za-z0-9_])/g, body: (match) => match.replace(/^sk_(?:(?:live|test)_)?/, "") },
  // Sanity API tokens: "sk" followed by a long alphanumeric run. Not inside a base64 run.
  { rule: "sanity-token", prefix: "sk", pattern: /(?<![A-Za-z0-9_+/=-])sk[A-Za-z0-9]{80,}(?![A-Za-z0-9_+/=-])/g, body: (match) => match.slice(2) },
  { rule: "private-key", prefix: "-----BEGIN", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, body: () => "Aa1" },
];

export function findTokenShapes(text: string): TokenShape[] {
  const shapes: TokenShape[] = [];
  for (const { rule, prefix, pattern, body, accept } of TOKEN_RULES) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (rule !== "jwt" && !looksRandom(body(value))) continue;
      if (accept && !accept(value)) continue;
      shapes.push({ rule, prefix, length: value.length });
    }
  }
  return shapes;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole environment name: not part of a longer one (so NEXT_PUBLIC_X never reports X as a server name). */
const wholeName = (name: string) => new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`);

export function scanText(text: string, file: string, rules: SecretRules): Finding[] {
  const findings: Finding[] = [];
  for (const name of rules.serverNames) {
    if (wholeName(name).test(text)) findings.push({ file, kind: "server-name", rule: name, detail: `server-only environment name ${name}` });
  }
  const publicNames = new Set(Array.from(text.matchAll(/(?<![A-Za-z0-9_])NEXT_PUBLIC_[A-Z0-9_]+/g), (match) => match[0]));
  for (const name of [...publicNames].sort()) {
    if (!rules.allowedPublicNames.has(name)) findings.push({ file, kind: "public-name", rule: name, detail: `public name not on the verify-env allow-list: ${name}` });
  }
  for (const indicator of CODE_INDICATORS) {
    if (text.includes(indicator)) findings.push({ file, kind: "code-indicator", rule: indicator, detail: `server-code indicator "${indicator}"` });
  }
  for (const { name, value } of rules.secretValues) {
    if (text.includes(value)) findings.push({ file, kind: "secret-value", rule: name, detail: `the configured value of ${name}` });
  }
  for (const shape of findTokenShapes(text)) {
    findings.push({ file, kind: "token-shape", rule: shape.rule, detail: `token-shaped string starting "${shape.prefix}" (${shape.length} characters)` });
  }
  return findings;
}

/** Extensions that are never text. Anything else is skipped too if it holds a NUL byte. */
const BINARY_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf", ".eot", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".pdf", ".zip", ".gz", ".br", ".wasm"]);
/** Prerendered responses Next keeps beside the server code. */
const PRERENDER_EXTENSIONS = new Set([".html", ".rsc", ".body"]);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function readText(path: string): string | null {
  if (BINARY_EXTENSIONS.has(extname(path).toLowerCase())) return null;
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 8192).includes(0)) return null;
  return buffer.toString("utf8");
}

export interface ScanResult {
  findings: Finding[];
  scannedFiles: number;
}

export function scanBuildOutput({ nextDir, publicDir, rules, rootDir = dirname(nextDir) }: { nextDir: string; publicDir: string; rules: SecretRules; rootDir?: string }): ScanResult {
  const staticDir = join(nextDir, "static");
  const staticFiles = walk(staticDir);
  if (staticFiles.length === 0 || !statSync(staticDir).isDirectory()) {
    throw new Error(`No client build output in ${relative(rootDir, staticDir).split(sep).join("/") || staticDir}: run \`npm run build\` first.`);
  }
  const candidates = [
    ...staticFiles,
    ...walk(join(nextDir, "server")).filter((path) => PRERENDER_EXTENSIONS.has(extname(path).toLowerCase())),
    ...walk(publicDir),
  ];
  const findings: Finding[] = [];
  let scannedFiles = 0;
  for (const path of candidates) {
    const text = readText(path);
    if (text === null) continue;
    scannedFiles += 1;
    findings.push(...scanText(text, relative(rootDir, path).split(sep).join("/"), rules));
  }
  return { findings, scannedFiles };
}
