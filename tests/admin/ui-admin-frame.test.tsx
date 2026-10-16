import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminFrame } from "@/components/admin/AdminFrame";
import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { staffMetadata } from "@/components/admin/metadata";
import { PAGE_COPY } from "@/components/admin/page-copy";
import { SignOutButton } from "@/components/admin/SignOutButton";

const goTo = vi.fn();
vi.mock("@/components/admin/navigate", () => ({ goTo: (path: string) => goTo(path) }));
vi.mock("server-only", () => ({}));

type Access = { kind: "staff"; identity: { userId: string; displayName: string | null }; db: unknown } | { kind: "signed_out" } | { kind: "unconfigured" } | { kind: "unavailable" };
let access: Access = { kind: "signed_out" };
vi.mock("@/lib/admin/access", () => ({ staffPageAccess: async () => access }));
let cookieNames: string[] = [];
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => cookieNames.map((name) => ({ name, value: "x" })) }) }));

/*
 * Task 8c, ruling R101: the staff frame is plain: the site's name, a "Staff" label, a skip link, one
 * main landmark, and the sign-out button only while a staff session exists. Every staff page is
 * noindex and has a title that starts with "Staff".
 */
type Answer = { status: number; body: unknown } | "network-error" | "never";
let answers: Answer[] = [];
const requests: Array<{ url: string; init: RequestInit }> = [];
let release: (() => void) | undefined;

beforeEach(() => {
  goTo.mockClear();
  answers = [];
  requests.length = 0;
  release = undefined;
  access = { kind: "signed_out" };
  cookieNames = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      const answer = answers.shift() ?? "network-error";
      if (answer === "network-error") throw new TypeError("fetch failed");
      if (answer === "never") {
        await new Promise<void>((resolve) => (release = resolve));
        return new Response(JSON.stringify({ ok: true, message: ADMIN_COPY.session.signedOut }), { status: 200 });
      }
      return new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SignOutButton", () => {
  const button = () => screen.getByRole("button", { name: PAGE_COPY.signOut.label }) as HTMLButtonElement;
  const click = async () => {
    await act(async () => {
      fireEvent.click(button());
    });
  };

  it("sends DELETE as same-origin JSON and then goes to the sign-in page", async () => {
    answers = [{ status: 200, body: { ok: true, message: ADMIN_COPY.session.signedOut } }];
    render(<SignOutButton />);
    await click();
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0]!;
    expect(url).toBe("/api/admin/session");
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(goTo).toHaveBeenCalledExactlyOnceWith("/admin/login");
  });

  it("is disabled and busy while the request is in flight, and sends it once", async () => {
    answers = ["never"];
    render(<SignOutButton />);
    await click();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button());
    expect(requests).toHaveLength(1);
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("/admin/login"));
  });

  const failures: Array<[string, Answer, string]> = [
    ["503 (unavailable)", { status: 503, body: { ok: false, message: ADMIN_COPY.api.unavailable } }, ADMIN_COPY.api.unavailable],
    ["403 (cross-site)", { status: 403, body: { ok: false, message: ADMIN_COPY.api.forbidden } }, ADMIN_COPY.api.forbidden],
    ["500", { status: 500, body: { ok: false, message: ADMIN_COPY.api.failed } }, ADMIN_COPY.api.failed],
    ["a proxy's error page", { status: 502, body: "<html>bad gateway</html>" }, PAGE_COPY.signOut.failed],
    ["no answer", "network-error", PAGE_COPY.signOut.failed],
  ];
  for (const [name, answer, message] of failures) {
    it(`stays put and says so on ${name}`, async () => {
      answers = [answer];
      render(<SignOutButton />);
      await click();
      expect(goTo).not.toHaveBeenCalled();
      expect(screen.getByRole("status").textContent).toBe(message);
      expect(button().disabled).toBe(false);
      await waitFor(() => expect(document.activeElement).toBe(button()));
    });
  }

  it("does not trust a 200 that is not the API's success", async () => {
    answers = [{ status: 200, body: "<html>captive portal</html>" }];
    render(<SignOutButton />);
    await click();
    expect(goTo).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe(PAGE_COPY.signOut.failed);
  });

  it("has one polite live region, empty until there is something to say", () => {
    render(<SignOutButton />);
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });
});

describe("AdminFrame", () => {
  const frame = (signedIn: boolean) =>
    render(
      <AdminFrame signedIn={signedIn}>
        <h1>Page</h1>
      </AdminFrame>,
    );

  it("has a skip link to the one main landmark, a banner with the site name and a Staff label", () => {
    frame(false);
    const skip = screen.getByRole("link", { name: PAGE_COPY.frame.skipToContent });
    expect(skip.getAttribute("href")).toBe("#main-content");
    const main = screen.getByRole("main");
    expect(main.id).toBe("main-content");
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const banner = screen.getByRole("banner");
    expect(banner.textContent).toContain(PAGE_COPY.frame.siteTitle);
    expect(banner.textContent).toContain(PAGE_COPY.frame.staffLabel);
    expect(main.textContent).toBe("Page");
  });

  it("offers sign-out only with a staff session", () => {
    frame(false);
    expect(screen.queryByRole("button", { name: PAGE_COPY.signOut.label })).toBeNull();
    cleanup();
    frame(true);
    expect(screen.getByRole("button", { name: PAGE_COPY.signOut.label })).toBeTruthy();
  });

  it("can show sign-out without being signed in (a session cookie exists but could not be checked)", () => {
    render(
      <AdminFrame signedIn={false} canSignOut>
        <h1>Page</h1>
      </AdminFrame>,
    );
    expect(screen.getByRole("button", { name: PAGE_COPY.signOut.label })).toBeTruthy();
    expect(screen.queryByRole("link", { name: new RegExp(PAGE_COPY.frame.siteTitle) })).toBeNull();
  });

  it("links the site name to the orders only when signed in, and never to the public site", () => {
    frame(false);
    expect(screen.queryByRole("link", { name: new RegExp(PAGE_COPY.frame.siteTitle) })).toBeNull();
    cleanup();
    frame(true);
    expect(screen.getByRole("link", { name: new RegExp(PAGE_COPY.frame.siteTitle) }).getAttribute("href")).toBe("/admin/orders");
  });

  it("renders on the server with no hooks (no marketing navigation, no order pad, no footer)", () => {
    const html = renderToStaticMarkup(
      <AdminFrame signedIn>
        <p>Body</p>
      </AdminFrame>,
    );
    expect(html).not.toMatch(/<nav|<footer|orderpad|data-site-header/i);
  });
});

describe("staffMetadata", () => {
  it("is noindex, nofollow and titled for staff", () => {
    expect(staffMetadata("Orders")).toEqual({ title: "Orders", robots: { index: false, follow: false } });
  });
});

describe("app/admin/layout", () => {
  it("is noindex with a title that starts with Staff, for every page under it", async () => {
    const { metadata } = await import("@/app/admin/layout");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toEqual({ default: PAGE_COPY.frame.titleDefault, template: PAGE_COPY.frame.titleTemplate });
  });

  it("shows sign-out for a staff session and for nothing else", async () => {
    const { default: AdminLayout } = await import("@/app/admin/layout");
    for (const kind of ["signed_out", "unconfigured", "unavailable"] as const) {
      access = { kind };
      render(await AdminLayout({ children: <p>Body {kind}</p> }));
      expect(screen.queryByRole("button", { name: PAGE_COPY.signOut.label }), kind).toBeNull();
      expect(screen.getByRole("main").textContent).toBe(`Body ${kind}`);
      cleanup();
    }
    access = { kind: "staff", identity: { userId: "u", displayName: "Jo" }, db: {} };
    render(await AdminLayout({ children: <p>Body</p> }));
    expect(screen.getByRole("button", { name: PAGE_COPY.signOut.label })).toBeTruthy();
  });

  /*
   * Final fix wave 8c-M4: R111's sign-out clears the cookies even when Auth is down, so the button
   * shows whenever a staff session cookie is on the request, not only when the staff check passed.
   */
  it("shows sign-out, but not the orders link, when a staff session cookie is present and the check could not be made", async () => {
    const { default: AdminLayout } = await import("@/app/admin/layout");
    for (const kind of ["unavailable", "signed_out", "unconfigured"] as const) {
      access = { kind };
      cookieNames = ["sb-abcdefgh-auth-token"];
      render(await AdminLayout({ children: <p>Body</p> }));
      expect(screen.getByRole("button", { name: PAGE_COPY.signOut.label }), kind).toBeTruthy();
      expect(screen.queryByRole("link", { name: new RegExp(PAGE_COPY.frame.siteTitle) }), kind).toBeNull();
      cleanup();
    }
  });

  it("recognises the chunked session cookie and ignores other cookies", async () => {
    const { default: AdminLayout } = await import("@/app/admin/layout");
    access = { kind: "unavailable" };
    cookieNames = ["sb-abcdefgh-auth-token.0", "sb-abcdefgh-auth-token.1"];
    render(await AdminLayout({ children: <p>Body</p> }));
    expect(screen.getByRole("button", { name: PAGE_COPY.signOut.label })).toBeTruthy();
    cleanup();
    cookieNames = ["bibobay-preview", "sb-abcdefgh-auth-token-code-verifier", "other"];
    render(await AdminLayout({ children: <p>Body</p> }));
    expect(screen.queryByRole("button", { name: PAGE_COPY.signOut.label })).toBeNull();
  });
});
