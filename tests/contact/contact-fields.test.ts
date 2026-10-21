import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CONTACT_TOPIC_LABELS, CONTACT_TOPICS, characterCount, checkContactFields, normalizeMessage } from "@/lib/contact/fields";

import { CONTACT_FIELD_CASES } from "./field-cases";

/*
 * The contact form's browser rules (plan C1). The server schema is checked against the same case
 * table, so the form never lets through what the server refuses, or blocks what it accepts.
 */
describe("contact field rules", () => {
  it("lists the five topics in order and labels each one", () => {
    expect(CONTACT_TOPICS).toEqual(["general", "partnerships", "press", "shop-order", "privacy"]);
    expect(Object.keys(CONTACT_TOPIC_LABELS)).toEqual([...CONTACT_TOPICS]);
  });

  it("counts code points, as Postgres char_length does", () => {
    expect(characterCount("🐢🐢🐢")).toBe(3);
  });

  it("normalises CRLF and CR to LF before trimming", () => {
    expect(normalizeMessage("  a\r\nb\rc  ")).toBe("a\nb\nc");
  });

  it.each(CONTACT_FIELD_CASES)("$label", ({ values, errors }) => {
    expect(checkContactFields(values)).toEqual(errors);
  });

  it("stays browser-safe", () => {
    const source = readFileSync(resolve("lib/contact/fields.ts"), "utf8");
    expect(source).not.toMatch(/server-only|from "zod"|process\.env/);
  });
});
