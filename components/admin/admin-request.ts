/**
 * How the staff components call the staff API (Task 8c, rulings R99 and R102): `fetch` with
 * credentials: "same-origin", a JSON content type (the API refuses anything else) and a JSON body.
 * `status` 0 means no answer at all (the network failed).
 */
export interface AdminAnswer {
  status: number;
  body: unknown;
}

export async function sendAdminRequest(method: "POST" | "DELETE", url: string, body: unknown = {}): Promise<AdminAnswer> {
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);


/** The API's own message: a `{ ok: boolean, message: string }` answer with a short message. Client code must not import admin-copy.ts (its server-only names would enter the bundle), so the shape is checked, not the text. */
export function apiMessage(body: unknown): string | null {
  return isRecord(body) && typeof body.ok === "boolean" && typeof body.message === "string" && body.message.length > 0 && body.message.length <= 300 ? body.message : null;
}

/** True only for the API's own success body: `{ ok: true, ... }`. */
export const isAdminSuccess = (answer: AdminAnswer): boolean => answer.status === 200 && isRecord(answer.body) && answer.body.ok === true;
