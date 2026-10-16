import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * R94: the staff session cookies are httpOnly, Secure outside localhost, SameSite=Lax and path /,
 * whatever @supabase/ssr passes for a write (its own defaults, or a future version's). The library is
 * replaced here so a write can carry hostile options; its real behaviour is covered in
 * tests/admin/staff-auth.test.ts and tests/admin/admin-headers.test.ts.
 */
const { createServerClient } = vi.hoisted(() => ({ createServerClient: vi.fn((_url: string, _key: string, options: unknown) => ({ options })) }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { createStaffAuthClient, staffCookieOptions, type StaffCookieJar } from "@/lib/supabase/staff-session";

type Captured = { options: { cookieOptions: unknown; cookies: { setAll(cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>): void } } };

beforeEach(() => createServerClient.mockClear());

describe("createStaffAuthClient cookie writes", () => {
  it.each([true, false])("enforces the staff cookie options over anything the library passes (secure: %s)", (secure) => {
    const writes: Array<[string, string, unknown]> = [];
    const jar: StaffCookieJar = { getAll: () => [], set: (name, value, options) => writes.push([name, value, options]) };
    const client = createStaffAuthClient({ url: "https://bibo-test.supabase.co", publishableKey: "sb_publishable_fixture_only" }, jar, { secure }) as unknown as Captured;

    expect(client.options.cookieOptions).toEqual(staffCookieOptions(secure));
    client.options.cookies.setAll([
      { name: "sb-bibo-test-auth-token", value: "v", options: { httpOnly: false, secure: !secure, sameSite: "none", path: "/elsewhere", maxAge: 400 } },
      { name: "sb-bibo-test-auth-token.1", value: "", options: { maxAge: 0 } },
    ]);
    expect(writes).toEqual([
      ["sb-bibo-test-auth-token", "v", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 400 }],
      ["sb-bibo-test-auth-token.1", "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 }],
    ]);
  });
});
