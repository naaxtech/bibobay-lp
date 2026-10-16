import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { LEAD_DELIVERY_KINDS, ORDER_EMAIL_KINDS, OUTBOX_LIMITS, OUTBOX_STATUSES } from "@/lib/outbox/constants";

/*
 * Static policy gate for migration 0006 (the email outbox worker; Task 8a), like the 0001-0005
 * gates: it reads the SQL as text, so it runs anywhere without a database. The behaviour is proved
 * by supabase/tests/0004_email_outbox.sql in tests/orders/migration-database.test.ts. This file pins
 * what the TypeScript side relies on to the SQL: the statuses, the kinds and the limits.
 */
const RAW = readFileSync(resolve("supabase/migrations/0006_order_events_and_email_outbox.sql"), "utf8").replaceAll("\r\n", "\n");
const SQL = RAW.replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").toLowerCase();

interface FunctionDefinition { name: string; header: string; body: string }
const FUNCTIONS: FunctionDefinition[] = Array.from(
  SQL.matchAll(/create (?:or replace )?function public\.(\w+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/g),
  (match) => ({ name: match[1]!, header: match[2]!, body: match[4]! }),
);
const RPCS = ["enqueue_lead_delivery", "claim_lead_deliveries", "record_lead_delivery_attempt", "claim_order_emails", "record_order_email_attempt"];
const INTERNAL = ["outbox_failure_unconfirmed"];

const rolesIn = (verb: "revoke" | "grant", name: string) =>
  Array.from(
    SQL.matchAll(new RegExp(`${verb} (?:all|execute) on function public\\.${name}\\s*\\([^)]*\\) ${verb === "revoke" ? "from" : "to"} ([^;]+);`, "g")),
    (match) => match[1]!.split(",").map((role) => role.trim()),
  ).flat();

const listIn = (pattern: RegExp) => {
  const match = SQL.match(pattern);
  if (!match) throw new Error(`no match for ${pattern}`);
  return match[1]!.split(",").map((value) => value.trim().replace(/'/g, ""));
};

describe("migration 0006: guards and privileges", () => {
  it("stops unless it runs as a role that bypasses row level security, after 0001-0005", () => {
    expect(SQL).toMatch(/do \$guard\$ begin if not exists \( select 1 from pg_catalog\.pg_roles r where r\.rolname = current_user and \(r\.rolbypassrls or r\.rolsuper\) \) then raise exception/);
    expect(RAW).toContain("must be applied before 0006");
  });

  it("grants nothing to anon, authenticated or public, creates no policy, and changes no table privilege", () => {
    expect(SQL).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/);
    expect(SQL).not.toMatch(/\bcreate policy\b|\balter default privileges\b/);
    expect(SQL).not.toMatch(/\bgrant [^;]* on (?:table )?public\./);
  });

  it("defines the five service-role RPCs and one internal helper", () => {
    expect([...new Set(FUNCTIONS.map((fn) => fn.name))].sort()).toEqual([...RPCS, ...INTERNAL].sort());
  });

  it("makes every RPC a security definer with an empty search_path, executable by service_role alone", () => {
    for (const fn of FUNCTIONS) {
      expect(fn.header, fn.name).toContain("set search_path = ''");
      if (RPCS.includes(fn.name)) {
        expect(fn.header, fn.name).toContain("security definer");
        expect(rolesIn("grant", fn.name), fn.name).toEqual(["service_role"]);
        expect(rolesIn("revoke", fn.name), fn.name).toEqual(expect.arrayContaining(["public", "anon", "authenticated"]));
      } else {
        expect(fn.header, fn.name).not.toContain("security definer");
        expect(rolesIn("grant", fn.name), fn.name).toEqual([]);
        expect(new Set(rolesIn("revoke", fn.name)), fn.name).toEqual(new Set(["public", "anon", "authenticated", "service_role"]));
      }
    }
  });

  it("refers to every table by its schema-qualified name inside function bodies", () => {
    for (const fn of FUNCTIONS) {
      for (const table of ["lead_submissions", "lead_delivery_events", "orders", "order_items", "order_email_outbox"]) {
        expect(fn.body, `${fn.name} -> ${table}`).not.toMatch(new RegExp(`(?<![.\\w])${table}\\b(?!\\s*\\.)`));
      }
    }
  });

  it("verifies its own grants, so a regression fails the deploy", () => {
    expect(SQL).toMatch(/do \$verify\$/);
    expect(SQL).toContain("has_function_privilege");
  });
});

describe("migration 0006: the values the worker relies on", () => {
  it("allows exactly the outbox statuses the code knows, on both outboxes and the lead mirror", () => {
    expect(listIn(/constraint lead_delivery_events_status_values check \(status in \(([^)]*)\)\)/)).toEqual([...OUTBOX_STATUSES]);
    expect(listIn(/constraint order_email_outbox_status_values check \(status in \(([^)]*)\)\)/)).toEqual([...OUTBOX_STATUSES]);
    expect(listIn(/constraint lead_submissions_acknowledgement_status_values check \(acknowledgement_status in \(([^)]*)\)\)/)).toEqual(["not_queued", ...OUTBOX_STATUSES]);
  });

  it("allows exactly the message kinds the code builds", () => {
    expect(listIn(/constraint order_email_outbox_kind_values check \(kind in \(([^)]*)\)\)/)).toEqual([...ORDER_EMAIL_KINDS]);
    const claimLeads = FUNCTIONS.find((fn) => fn.name === "claim_lead_deliveries")!;
    expect(claimLeads.body).toContain(`k.kind not in (${LEAD_DELIVERY_KINDS.map((kind) => `'${kind}'`).join(", ")})`);
    const claimOrders = FUNCTIONS.find((fn) => fn.name === "claim_order_emails")!;
    expect(claimOrders.body).toContain(`k.kind not in (${ORDER_EMAIL_KINDS.map((kind) => `'${kind}'`).join(", ")})`);
  });

  it("bounds a claim, re-claims a stuck row and closes the idempotency window at the constants' values (R91)", () => {
    for (const name of ["claim_lead_deliveries", "claim_order_emails"]) {
      const body = FUNCTIONS.find((fn) => fn.name === name)!.body;
      expect(body, name).toContain(`p_limit not between 1 and ${OUTBOX_LIMITS.maxClaim}`);
      expect(body, name).toContain(`now() - interval '${OUTBOX_LIMITS.staleSendingMinutes} minutes'`);
      expect(body, name).toContain(`now() - interval '${OUTBOX_LIMITS.idempotencyWindowHours} hours'`);
      expect(body, name).toContain(`r.attempts >= ${OUTBOX_LIMITS.maxAttempts}`);
      expect(body, name).toContain("for update of");
      expect(body, name).toContain("skip locked");
    }
    for (const name of ["record_lead_delivery_attempt", "record_order_email_attempt"]) {
      expect(FUNCTIONS.find((fn) => fn.name === name)!.body, name).toContain(`attempts >= ${OUTBOX_LIMITS.maxAttempts} or p_error_code = 'invalid_idempotent_request'`);
    }
    // The provider keeps an idempotency key for 24 hours; the window must close before that.
    expect(OUTBOX_LIMITS.idempotencyWindowHours).toBeLessThan(24);
  });

  it("derives the order email's idempotency key from the row, unique (R90)", () => {
    expect(SQL).toContain("idempotency_key text generated always as (order_id::text || ':' || kind || coalesce(':' || quote_revision::text, '')) stored");
    expect(SQL).toContain("unique (idempotency_key)");
  });

  it("returns no address, phone, notes, SKU, product id or token hash from the order claim", () => {
    const claimOrders = FUNCTIONS.find((fn) => fn.name === "claim_order_emails")!;
    expect(claimOrders.body).not.toMatch(/\b(address_line1|address_line2|city|region|postal_code|country|notes|phone|tracking_token_hash|sanity_id|sku)\b/);
  });
});
