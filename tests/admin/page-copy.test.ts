import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { PAGE_COPY } from "@/components/admin/page-copy";

/*
 * Truth rules for the staff pages' own copy (Task 8c; spec §3 ruling 3, §10), the same scan
 * tests/admin/admin-copy.test.ts runs over the API answers. The pages never know that an email was
 * delivered or a payment taken, and a refusal never says which accounts exist. Order status names
 * ("paid") are labels, so the payment claim looked for is the sentence, not the word.
 */
const strings = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

const entries = (value: unknown, path = ""): Array<[string, string]> =>
  typeof value === "string"
    ? [[path, value]]
    : value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, child]) => entries(child, path ? `${path}.${key}` : key))
      : [];

describe("PAGE_COPY", () => {
  const all = strings(PAGE_COPY);

  it("is plain, trimmed, non-empty text with no markup or placeholders", () => {
    expect(all.length).toBeGreaterThan(15);
    for (const text of all) {
      expect(text.trim(), text).toBe(text);
      expect(text.length, text).toBeGreaterThan(0);
      expect(text, text).not.toMatch(/[<>{}]|\bTODO\b|lorem|undefined|\[object/i);
    }
  });

  it("writes every sentence as a sentence (a capital letter and a full stop); titles and labels are not sentences", () => {
    const sentences = entries(PAGE_COPY).filter(([path]) => !/(?:^|\.)(?:title|pageTitle|heading|titleDefault|titleTemplate|siteTitle)$/.test(path));
    expect(sentences.length).toBeGreaterThan(10);
    for (const [, text] of sentences.filter(([, entry]) => entry.split(/\s+/).length > 3)) {
      expect(text, text).toMatch(/^[A-Z].*[.!]$/);
    }
  });

  it("never claims an email was sent or delivered, or that anyone paid", () => {
    for (const text of all) {
      expect(text, text).not.toMatch(/\b(?:email|quote|link|message) (?:was |has been )?(?:sent|delivered)\b/i);
      expect(text, text).not.toMatch(/\bwe (?:sent|emailed)\b|\bcustomer (?:was|has been) (?:emailed|notified)\b/i);
      expect(text, text).not.toMatch(/\b(?:has|have|was|been|is) paid\b|\bpayment (?:received|taken|confirmed|completed)\b|\bpaid in full\b/i);
    }
  });

  it("names no configuration value, address, key or private project", () => {
    for (const text of all) {
      expect(text, text).not.toMatch(/https?:\/\/|sb_(?:secret|publishable)_|@[a-z0-9-]+\.|[A-Z][A-Z0-9]+_[A-Z0-9_]{3,}|supabase|vercel|sanity|resend/i);
    }
  });

  it("does not tell a failed sign-in whether the account exists or is staff", () => {
    for (const text of [PAGE_COPY.login.emailRequired, PAGE_COPY.login.passwordRequired, PAGE_COPY.login.notReached]) {
      expect(text, text).not.toMatch(/\bno (?:such )?(?:account|user)\b|\bnot (?:found|registered)\b|\bexists?\b|inactive|disabled|not staff/i);
    }
  });

  it("says nothing was changed where the page could not check access", () => {
    expect(PAGE_COPY.notices.unavailable.body).toMatch(/Nothing was changed/);
  });

  it("starts every staff document title with Staff", () => {
    expect(PAGE_COPY.frame.titleDefault).toBe("Staff");
    expect(PAGE_COPY.frame.titleTemplate).toMatch(/^Staff\b.*%s/);
  });

  it("uses the API's own words for the states it shares with the API, so they cannot drift apart", () => {
    expect(PAGE_COPY.notices.unconfigured.body).toBe(ADMIN_COPY.api.unconfigured);
    expect(PAGE_COPY.notices.unavailable.body).toBe(ADMIN_COPY.api.unavailable);
  });
});

describe("client bundle rule", () => {
  it("keeps the fallback words equal to the API's (they are copies, so the client never imports admin-copy.ts)", () => {
    const f = PAGE_COPY.login.fallback;
    expect(f.checkDetails).toBe(ADMIN_COPY.session.checkDetails);
    expect(f.refused).toBe(ADMIN_COPY.session.refused);
    expect(f.rateLimited).toBe(ADMIN_COPY.session.rateLimited);
    expect(f.forbidden).toBe(ADMIN_COPY.api.forbidden);
    expect(f.failed).toBe(ADMIN_COPY.api.failed);
    expect(f.unavailable).toBe(ADMIN_COPY.api.unavailable);
    expect(PAGE_COPY.login.signedIn).toBe(ADMIN_COPY.session.signedIn);
  });

  it("no client file under components/admin or app/admin imports admin-copy.ts, directly or through a local import chain", () => {
    const root = process.cwd();
    const source = (file: string) => readFileSync(join(root, file), "utf8");
    const files = ["components/admin", "app/admin"].flatMap((dir) => walk(join(root, dir)).map((p) => relative(root, p).split(sep).join("/")));
    const imports = (file: string) =>
      [...source(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!).filter((spec) => spec.startsWith(".") || spec.startsWith("@/"));
    const resolve = (from: string, spec: string) => {
      const base = spec.startsWith("@/") ? spec.slice(2) : join(dirname(from), spec).split(sep).join("/");
      return files.find((candidate) => candidate.replace(/\.(tsx?|css)$/, "") === base) ?? null;
    };
    const reaches = (file: string, seen = new Set<string>()): boolean => {
      if (seen.has(file)) return false;
      seen.add(file);
      return imports(file).some((spec) => {
        const target = resolve(file, spec);
        return target ? target === "components/admin/admin-copy.ts" || reaches(target, seen) : false;
      });
    };
    const clients = files.filter((file) => /\.tsx?$/.test(file) && /^\s*["']use client["']/.test(source(file)));
    expect(clients.length).toBeGreaterThanOrEqual(2);
    for (const file of clients) expect(reaches(file), file).toBe(false);
  });
});
