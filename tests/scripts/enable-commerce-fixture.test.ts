import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as queries from "@/lib/sanity/queries";

/*
 * Task 7b: scripts/e2e/enable-commerce-fixture.mjs switches commerce on in a scratch COPY of the
 * repository, for the commerce-on browser tests. It must refuse the repository itself and anything
 * inside a git work tree, and nothing the site builds may reach it.
 */

vi.mock("server-only", () => ({}));
const sanity = vi.hoisted(() => ({ answer: null as null | ((groq: string, params: Record<string, string>) => unknown) }));
vi.mock("@/lib/sanity/client", () => ({
  getSanityClient: () => (sanity.answer ? { fetch: async (groq: string, params?: Record<string, string>) => sanity.answer!(groq, params ?? {}) } : null),
}));
// What the script does to a copy's settings fallback, so the real fetch code reads the fixture.
vi.mock("@/lib/content/fallback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/content/fallback")>();
  return { ...actual, SAFE_FALLBACK_SETTINGS: { ...actual.SAFE_FALLBACK_SETTINGS, commerceEnabled: true, trackingEnabled: true } };
});

const REPO = resolve(".");
const SCRIPT = resolve("scripts/e2e/enable-commerce-fixture.mjs");
const TOUCHED = ["lib/content/fallback.ts", "lib/sanity/fetch.ts"] as const;
const FIXTURE_MODULE = "lib/sanity/e2e-commerce-fixture.ts";
/** What a scratch copy needs for the script, and for the generated module to import. */
const COPY_FILES = ["package.json", ...TOUCHED, "lib/sanity/queries.ts"] as const;

const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

/** True when the folder, or a folder above it, holds a `.git` entry. */
function insideGitWorkTree(folder: string): boolean {
  for (let current = resolve(folder); ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) return true;
    if (dirname(current) === current) return false;
  }
}
/** The script's success paths need a scratch folder outside any git work tree. */
const scratchIsClean = !insideGitWorkTree(tmpdir());

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "bibobay-commerce-fixture-"));
});
afterEach(() => {
  sanity.answer = null;
  rmSync(scratch, { recursive: true, force: true });
});

function makeCopy(folder: string): string {
  for (const file of COPY_FILES) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    cpSync(resolve(file), join(folder, file));
  }
  return folder;
}
/**
 * Runs the module the script generated, as the copy's build would: compiled from TypeScript, with
 * its one import (the GROQ queries) served by this repository's module.
 */
function loadGenerated(source: string): { e2eCommerceFixture: (groq: string, params: Record<string, string>) => unknown } {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true } });
  const loaded = { exports: {} as Record<string, unknown> };
  const load = (id: string) => {
    if (id === "./queries") return queries;
    throw new Error(`the fixture module imports ${id}`);
  };
  runInNewContext(outputText, { module: loaded, exports: loaded.exports, require: load });
  return loaded.exports as ReturnType<typeof loadGenerated>;
}
const snapshot = (folder: string) => Object.fromEntries(TOUCHED.map((file) => [file, readFileSync(join(folder, file), "utf8")]));

describe("enable-commerce-fixture refusals", () => {
  it("refuses the repository itself and changes nothing", () => {
    const before = snapshot(REPO);
    const result = run(REPO);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused: .*is this repository itself/i);
    expect(snapshot(REPO)).toEqual(before);
    expect(existsSync(resolve(FIXTURE_MODULE))).toBe(false);
  });

  it("refuses a folder inside the repository", () => {
    const result = run(resolve("lib"));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused: .*inside this repository/i);
  });

  it("refuses a copy inside a git work tree, however deep, and leaves it untouched", () => {
    const work = join(scratch, "work");
    mkdirSync(join(work, ".git"), { recursive: true });
    const copy = makeCopy(join(work, "nested", "copy"));
    const before = snapshot(copy);
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused: .*inside a git work tree/i);
    expect(snapshot(copy)).toEqual(before);
    expect(existsSync(join(copy, FIXTURE_MODULE))).toBe(false);
  });

  it("refuses a copy that is a linked work tree (a .git file)", () => {
    const copy = makeCopy(join(scratch, "linked"));
    writeFileSync(join(copy, ".git"), "gitdir: ../somewhere/.git/worktrees/linked\n");
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/inside a git work tree/i);
  });

  it.runIf(scratchIsClean)("refuses a folder that is not a copy of the site, or does not exist", () => {
    const empty = run(scratch);
    expect(empty.status).toBe(1);
    expect(empty.stderr).toMatch(/refused: .*not a copy of this site/i);
    const missing = run(join(scratch, "nowhere"));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/refused: .*no such folder/i);
  });

  it("asks for exactly one folder", () => {
    for (const args of [[], ["a", "b"]]) {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/usage: node scripts\/e2e\/enable-commerce-fixture\.mjs <scratch copy>/i);
    }
  });
});

describe.runIf(scratchIsClean)("enable-commerce-fixture on a scratch copy", () => {
  it("switches commerce and tracking on and points the catalogue at the fixture, once", () => {
    const copy = makeCopy(join(scratch, "copy"));
    const result = run(copy);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const fallback = readFileSync(join(copy, "lib/content/fallback.ts"), "utf8");
    expect(fallback).toContain("commerceEnabled: true, trackingEnabled: true,");
    expect(fallback).not.toContain("commerceEnabled: false");
    const fetch = readFileSync(join(copy, "lib/sanity/fetch.ts"), "utf8");
    expect(fetch).toContain('import { e2eCommerceFixture } from "./e2e-commerce-fixture";');
    expect(fetch).toContain("if (!client) return e2eCommerceFixture<T>(groq, params);");
    expect(existsSync(join(copy, FIXTURE_MODULE))).toBe(true);

    const after = { ...snapshot(copy), fixture: readFileSync(join(copy, FIXTURE_MODULE), "utf8") };
    const again = run(copy);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/already/i);
    expect({ ...snapshot(copy), fixture: readFileSync(join(copy, FIXTURE_MODULE), "utf8") }).toEqual(after);
  });

  it("fails loudly, changing nothing, when the code it patches has moved on", () => {
    const copy = makeCopy(join(scratch, "drifted"));
    const fetchFile = join(copy, "lib/sanity/fetch.ts");
    writeFileSync(fetchFile, readFileSync(fetchFile, "utf8").replace("if (!client) return null;", "if (client === null) return null;"));
    const before = snapshot(copy);
    const result = run(copy);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/lib\/sanity\/fetch\.ts.*changed/i);
    expect(snapshot(copy)).toEqual(before);
    expect(existsSync(join(copy, FIXTURE_MODULE))).toBe(false);
  });

  it("gives the shop listed products in two categories and none, a sold-out page, and no draft, with no price anywhere", async () => {
    const copy = makeCopy(join(scratch, "catalogue"));
    expect(run(copy).status).toBe(0);
    const source = readFileSync(join(copy, FIXTURE_MODULE), "utf8");
    expect(source).not.toMatch(/price|currency|amount|stock/i);
    const fixture = loadGenerated(source);
    sanity.answer = fixture.e2eCommerceFixture;
    const { getListedProducts, getProductBySlug } = await import("@/lib/sanity/fetch");

    const listed = await getListedProducts();
    expect(listed.map((product) => product.slug)).toEqual(["tula-reef-plush", "bob-bath-boat", "bay-activity-cards"]);
    expect(new Set(listed.map((product) => product.category?.name ?? null))).toEqual(new Set(["Plush friends", "Bath time", null]));
    expect(listed.every((product) => product.status === "listed")).toBe(true);

    const tula = await getProductBySlug("tula-reef-plush");
    expect(tula).toMatchObject({ sku: "BB-PL-001", variant: "Coral", pack: "Single", commerceNotice: { title: "Made to order" } });
    expect(tula?.details.length).toBeGreaterThan(0);
    expect(await getProductBySlug("lumi-night-light")).toMatchObject({ status: "sold-out", name: "Lumi Night Light" });
    expect(await getProductBySlug("coral-sticker-sheet")).toBeNull();
    expect(await getProductBySlug("no-such-product")).toBeNull();
  });
});

describe("the fixture stays out of the site", () => {
  /** Every file the site's build compiles from (tests, e2e and scripts are not part of it). */
  function sourceFiles(folder: string): string[] {
    return readdirSync(folder).flatMap((entry) => {
      const path = join(folder, entry);
      return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx|mjs|js|css)$/.test(entry) ? [path] : [];
    });
  }

  it("is imported by nothing the site builds, and the fixture module exists only in a copy", () => {
    const files = [...["app", "components", "lib"].flatMap((folder) => sourceFiles(resolve(folder))), ...["proxy.ts", "next.config.ts", "instrumentation.ts", "instrumentation-client.ts"].map((file) => resolve(file)).filter((file) => existsSync(file))];
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/enable-commerce-fixture|e2e-commerce-fixture|scripts\/e2e/);
    expect(existsSync(resolve(FIXTURE_MODULE))).toBe(false);
    const { scripts } = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(scripts)) expect(command, name).not.toMatch(/enable-commerce-fixture/);
  });
});
