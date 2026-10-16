import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { deriveSecretRules, scanBuildOutput, type Finding } from "./lib/bundle-secrets";
import { ALLOWED_PUBLIC_NAMES, isAllowedPublicName } from "./verify-env";

/*
 * npm run verify:bundle [-- --next-dir <dir>] [-- --public-dir <dir>]
 *
 * Scans the client build output for server names, unlisted public names, server-code indicators,
 * the configured secret values and token-shaped strings (rules: scripts/lib/bundle-secrets.ts).
 * Run it after `npm run build`. Exit codes: 0 clean, 1 findings, 2 usage error or no build output.
 * A finding names the file and the rule, never the secret.
 */

const USAGE = "Usage: npm run verify:bundle [-- --next-dir <dir>] [--public-dir <dir>]";

function parse(argv: string[]): { nextDir: string; publicDir: string } | null {
  const options = { nextDir: resolve(".next"), publicDir: resolve("public") };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--next-dir" || flag === "--public-dir") && value && !value.startsWith("--")) {
      options[flag === "--next-dir" ? "nextDir" : "publicDir"] = resolve(value);
      index += 1;
    } else {
      return null;
    }
  }
  return options;
}

function print(findings: Finding[]) {
  const width = Math.max(...findings.map((finding) => finding.file.length), 4);
  console.error(`${"FILE".padEnd(width)}  ${"KIND".padEnd(14)}  RULE`);
  for (const finding of findings) console.error(`${finding.file.padEnd(width)}  ${finding.kind.padEnd(14)}  ${finding.rule}: ${finding.detail}`);
}

const options = parse(process.argv.slice(2));
if (!options) {
  console.error(USAGE);
  process.exit(2);
}

// Scan for the values this machine (or CI job) actually holds, as the build saw them.
nextEnv.loadEnvConfig(process.cwd(), false);
const rules = deriveSecretRules({ envExample: readFileSync(resolve(".env.example"), "utf8"), allowedPublicNames: ALLOWED_PUBLIC_NAMES, isAllowedPublicName, env: process.env });
if (rules.configErrors.length > 0) {
  console.error(rules.configErrors.join("\n"));
  process.exit(1);
}

let result: ReturnType<typeof scanBuildOutput>;
try {
  result = scanBuildOutput({ nextDir: options.nextDir, publicDir: options.publicDir, rules, rootDir: process.cwd() });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const summary = `${result.scannedFiles} client files; ${rules.serverNames.length} server names, ${rules.allowedPublicNames.size} listed public names (plus the NEXT_PUBLIC_VERCEL_ namespace), ${rules.secretValues.length} configured secret values, token shapes and server-code indicators`;
if (result.findings.length > 0) {
  print(result.findings);
  console.error(`Bundle secret scan FAILED: ${result.findings.length} finding(s) in ${summary}.`);
  process.exit(1);
}
console.log(`Bundle secret scan passed: ${summary}.`);
