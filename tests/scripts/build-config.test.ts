// @vitest-environment node
import { relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

/*
 * Review C1 (Task 10). `next build` type-checks the program its tsconfig selects. With the root
 * tsconfig.json that program includes tests/, and two tests import studio/schemaTypes, which needs
 * `sanity` from studio/node_modules. Vercel (vercel.json) and the CI e2e job install the root only,
 * so the build failed there with "Cannot find module 'sanity'". The build therefore uses
 * tsconfig.build.json, which leaves tests and end-to-end specs out; `npm run typecheck` keeps the
 * full root tsconfig.json (tests included) and runs where the Studio is installed.
 */

const ROOT = resolve(".");
const toRepoPath = (file: string) => relative(ROOT, resolve(file)).split(sep).join("/");

function parsed(configFile: string): ts.ParsedCommandLine {
  const config = ts.getParsedCommandLineOfConfigFile(resolve(configFile), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  if (!config) throw new Error(`${configFile} could not be read`);
  return config;
}

describe("build type-check program", () => {
  it("next build uses tsconfig.build.json", () => {
    expect(nextConfig.typescript?.tsconfigPath).toBe("tsconfig.build.json");
  });

  it("keeps tests, end-to-end specs and the Studio out of the build's root files", () => {
    const files = parsed("tsconfig.build.json").fileNames.map(toRepoPath);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => /^(tests|e2e|studio)\//.test(file))).toEqual([]);
    // Everything the site ships is still checked.
    for (const prefix of ["app/", "components/", "lib/"]) expect(files.some((file) => file.startsWith(prefix)), prefix).toBe(true);
    expect(files).toContain("proxy.ts");
  });

  it("checks every file the full typecheck checks, except tests and end-to-end specs", () => {
    const build = new Set(parsed("tsconfig.build.json").fileNames.map(toRepoPath));
    const full = parsed("tsconfig.json").fileNames.map(toRepoPath);
    expect(full.filter((file) => !build.has(file) && !/^(tests|e2e)\//.test(file))).toEqual([]);
  });

  it("never resolves a module from the Studio or from `sanity`, so a root-only install builds", { timeout: 120_000 }, () => {
    const config = parsed("tsconfig.build.json");
    const program = ts.createProgram({ rootNames: config.fileNames, options: { ...config.options, noEmit: true } });
    const reached = program
      .getSourceFiles()
      .map((source) => toRepoPath(source.fileName))
      .filter((file) => file.startsWith("studio/"));
    expect(reached).toEqual([]);
  });
});
