import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_COPY } from "@/components/admin/admin-copy";
import { LoginForm } from "@/components/admin/LoginForm";
import { PAGE_COPY } from "@/components/admin/page-copy";

const goTo = vi.fn();
vi.mock("@/components/admin/navigate", () => ({ goTo: (path: string) => goTo(path) }));

/*
 * Task 8c, rulings R100, R102 and R105: the staff sign-in form. It posts { email, password } as
 * same-origin JSON to /api/admin/session and shows the API's own message for each answer in one
 * polite live region; field problems sit next to their inputs. A 200 navigates to /admin/orders.
 * The password is never rendered, stored or put in a URL.
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      const answer = answers.shift() ?? "network-error";
      if (answer === "network-error") throw new TypeError("fetch failed");
      if (answer === "never") await new Promise<void>((resolve) => (release = resolve));
      const { status, body } = answer === "never" ? { status: 401, body: { ok: false, message: ADMIN_COPY.session.refused } } : answer;
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const email = () => screen.getByLabelText(PAGE_COPY.login.emailLabel) as HTMLInputElement;
const password = () => screen.getByLabelText(PAGE_COPY.login.passwordLabel) as HTMLInputElement;
const button = () => screen.getByRole("button", { name: PAGE_COPY.login.submit }) as HTMLButtonElement;
const status = () => screen.getByRole("status");

async function submit(values: { email?: string; password?: string } = {}) {
  fireEvent.change(email(), { target: { value: values.email ?? "staff@example.com" } });
  fireEvent.change(password(), { target: { value: values.password ?? "correct horse" } });
  await act(async () => {
    fireEvent.click(button());
  });
}

describe("the sign-in form", () => {
  it("has a labelled email and password with the autocomplete tokens password managers need", () => {
    render(<LoginForm />);
    expect(email()).toMatchObject({ type: "email", required: true });
    expect(email().getAttribute("autocomplete")).toBe("username");
    expect(password()).toMatchObject({ type: "password", required: true });
    expect(password().getAttribute("autocomplete")).toBe("current-password");
    expect(screen.getByRole("form", { name: PAGE_COPY.login.formLabel })).toBeTruthy();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status().getAttribute("aria-live")).toBe("polite");
  });

  it("is a server-rendered form whose button stays off until the page has hydrated, and posts nothing natively", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain('method="post"');
    expect(html).not.toMatch(/value="[^"]/);
  });

  it("posts the credentials as same-origin JSON to the session route", async () => {
    answers = [{ status: 200, body: { ok: true, message: ADMIN_COPY.session.signedIn } }];
    render(<LoginForm />);
    await submit({ email: "  Staff@Example.com ", password: "correct horse" });
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0]!;
    expect(url).toBe("/api/admin/session");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({ email: "Staff@Example.com", password: "correct horse" });
  });

  it("navigates to the orders page on 200, and says it is signed in", async () => {
    answers = [{ status: 200, body: { ok: true, message: ADMIN_COPY.session.signedIn } }];
    render(<LoginForm />);
    await submit();
    expect(goTo).toHaveBeenCalledExactlyOnceWith("/admin/orders");
    expect(status().textContent).toBe(ADMIN_COPY.session.signedIn);
    expect(button().disabled).toBe(true);
  });

  const refusals: Array<[string, number, string, string]> = [
    ["400 (details)", 400, ADMIN_COPY.session.checkDetails, ADMIN_COPY.session.checkDetails],
    ["401 (refused)", 401, ADMIN_COPY.session.refused, ADMIN_COPY.session.refused],
    ["403 (cross-site)", 403, ADMIN_COPY.api.forbidden, ADMIN_COPY.api.forbidden],
    ["429 (rate limited)", 429, ADMIN_COPY.session.rateLimited, ADMIN_COPY.session.rateLimited],
    ["503 (unconfigured)", 503, ADMIN_COPY.api.unconfigured, ADMIN_COPY.api.unconfigured],
    ["503 (unavailable)", 503, ADMIN_COPY.api.unavailable, ADMIN_COPY.api.unavailable],
    ["500 (failed)", 500, ADMIN_COPY.api.failed, ADMIN_COPY.api.failed],
  ];
  for (const [name, code, message, shown] of refusals) {
    it(`shows the API's message for ${name}, stays on the page and lets staff try again`, async () => {
      answers = [{ status: code, body: { ok: false, message } }];
      render(<LoginForm />);
      await submit();
      expect(status().textContent).toBe(shown);
      expect(goTo).not.toHaveBeenCalled();
      expect(button().disabled).toBe(false);
      expect(button().getAttribute("aria-busy")).not.toBe("true");
    });
  }

  it("falls back to its own words for an answer that is not the API's (a proxy page, or JSON without the API's shape)", async () => {
    answers = [{ status: 502, body: "<html>Bad gateway</html>" }];
    render(<LoginForm />);
    await submit();
    expect(status().textContent).toBe(ADMIN_COPY.api.unavailable);
    answers = [{ status: 429, body: { error: "upstream said no" } }];
    await submit();
    expect(status().textContent).toBe(ADMIN_COPY.session.rateLimited);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("does not trust a 200 that is not the API's success", async () => {
    answers = [{ status: 200, body: "<html>captive portal</html>" }];
    render(<LoginForm />);
    await submit();
    expect(goTo).not.toHaveBeenCalled();
    expect(status().textContent).toBe(PAGE_COPY.login.notReached);
  });

  it("says the request did not go through when the network fails", async () => {
    answers = ["network-error"];
    render(<LoginForm />);
    await submit();
    expect(status().textContent).toBe(PAGE_COPY.login.notReached);
    expect(button().disabled).toBe(false);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("is disabled and busy while the request is in flight, and sends it once", async () => {
    answers = ["never"];
    render(<LoginForm />);
    await submit();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    expect(status().textContent).toBe(PAGE_COPY.login.sending);
    fireEvent.submit(screen.getByRole("form", { name: PAGE_COPY.login.formLabel }));
    expect(requests).toHaveLength(1);
    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(status().textContent).toBe(ADMIN_COPY.session.refused);
  });

  it("clears the password and puts focus back on it after a refusal, never on the live region", async () => {
    answers = [{ status: 401, body: { ok: false, message: ADMIN_COPY.session.refused } }];
    render(<LoginForm />);
    await submit({ password: "wrong horse" });
    expect(password().value).toBe("");
    expect(email().value).toBe("staff@example.com");
    await waitFor(() => expect(document.activeElement).toBe(password()));
    expect(document.activeElement).not.toBe(status());
  });

  it("keeps what was typed after a rate limit or an outage, and returns focus to the button", async () => {
    answers = [{ status: 429, body: { ok: false, message: ADMIN_COPY.session.rateLimited } }];
    render(<LoginForm />);
    await submit({ password: "correct horse" });
    expect(password().value).toBe("correct horse");
    await waitFor(() => expect(document.activeElement).toBe(button()));
  });

  it("checks for empty fields before sending anything, naming each one next to its input", async () => {
    render(<LoginForm />);
    await submit({ email: "   ", password: "" });
    expect(requests).toHaveLength(0);
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(password().getAttribute("aria-invalid")).toBe("true");
    const emailError = document.getElementById(email().getAttribute("aria-describedby") ?? "");
    expect(emailError?.textContent).toBe(PAGE_COPY.login.emailRequired);
    const passwordError = document.getElementById(password().getAttribute("aria-describedby") ?? "");
    expect(passwordError?.textContent).toBe(PAGE_COPY.login.passwordRequired);
    expect(document.activeElement).toBe(email());

    answers = [{ status: 200, body: { ok: true, message: ADMIN_COPY.session.signedIn } }];
    await submit();
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(email().getAttribute("aria-describedby")).toBeNull();
  });

  it("focuses the password when only the password is missing", async () => {
    render(<LoginForm />);
    await submit({ password: "" });
    expect(requests).toHaveLength(0);
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(document.activeElement).toBe(password());
  });

  it("never writes the password anywhere but the request body", async () => {
    answers = [{ status: 401, body: { ok: false, message: ADMIN_COPY.session.refused } }];
    window.localStorage.clear();
    render(<LoginForm />);
    await submit({ password: "hunter2-secret" });
    expect(document.body.innerHTML).not.toContain("hunter2-secret");
    expect(JSON.stringify(window.localStorage)).not.toContain("hunter2-secret");
    expect(requests[0]!.url).not.toContain("hunter2-secret");
  });

  it("says nothing about email being sent or a payment taken", async () => {
    answers = [{ status: 200, body: { ok: true, message: ADMIN_COPY.session.signedIn } }];
    const { container } = render(<LoginForm />);
    await submit();
    expect(container.textContent).not.toMatch(/\b(?:was|has been) sent\b|\bpaid\b|payment (?:received|taken)/i);
  });
});
