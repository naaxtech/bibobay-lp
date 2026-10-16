import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_COPY } from "@/components/admin/page-copy";

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/navigate", () => ({ goTo: vi.fn() }));

class Redirected extends Error {
  constructor(readonly path: string) {
    super(`NEXT_REDIRECT ${path}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Redirected(path);
  },
}));

type Access = { kind: "staff"; identity: { userId: string; displayName: string | null }; db: unknown } | { kind: "signed_out" } | { kind: "unconfigured" } | { kind: "unavailable" };
let access: Access = { kind: "signed_out" };
vi.mock("@/lib/admin/access", () => ({ staffPageAccess: async () => access }));

/*
 * Task 8c, rulings R100 and R105: /admin/login always renders the form (the API answers every
 * refusal with its own message), whatever Supabase's state; only an already-signed-in active staff
 * member is sent on to /admin/orders. The page carries the noindex "Sign in" metadata.
 */
beforeEach(() => {
  access = { kind: "signed_out" };
});
afterEach(cleanup);

describe("/admin/login", () => {
  it("renders the heading, the lead and the form for a visitor who is signed out", async () => {
    const { default: LoginPage } = await import("@/app/admin/login/page");
    render(await LoginPage());
    expect(screen.getByRole("heading", { level: 1, name: PAGE_COPY.login.heading })).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.login.lead)).toBeTruthy();
    expect(screen.getByRole("form", { name: PAGE_COPY.login.formLabel })).toBeTruthy();
  });

  for (const kind of ["unconfigured", "unavailable"] as const) {
    it(`still renders the form while access is ${kind}, so the API can say why`, async () => {
      access = { kind };
      const { default: LoginPage } = await import("@/app/admin/login/page");
      render(await LoginPage());
      expect(screen.getByRole("form", { name: PAGE_COPY.login.formLabel })).toBeTruthy();
    });
  }

  it("sends an already signed-in staff member to the orders", async () => {
    access = { kind: "staff", identity: { userId: "u", displayName: null }, db: {} };
    const { default: LoginPage } = await import("@/app/admin/login/page");
    await expect(LoginPage()).rejects.toMatchObject({ path: "/admin/orders" });
  });

  it("is noindex and titled Sign in", async () => {
    const { metadata } = await import("@/app/admin/login/page");
    expect(metadata).toEqual({ title: PAGE_COPY.login.pageTitle, robots: { index: false, follow: false } });
  });
});
