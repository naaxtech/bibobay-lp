import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_COPY } from "@/components/admin/page-copy";
import type { AdminOrderDetail, AdminOrderSummary } from "@/lib/orders/admin";
import { ORDER_STATUSES } from "@/lib/orders/constants";

vi.mock("server-only", () => ({}));
vi.mock("@/components/admin/navigate", () => ({ goTo: vi.fn() }));

class Redirected extends Error {
  constructor(readonly path: string) {
    super(`NEXT_REDIRECT ${path}`);
  }
}
class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Redirected(path);
  },
  notFound: () => {
    throw new NotFoundSignal();
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

type Access = { kind: "staff"; identity: { userId: string; displayName: string | null }; db: unknown } | { kind: "signed_out" } | { kind: "unconfigured" } | { kind: "unavailable" };
const DB = { fake: "staff database" };
let access: Access = { kind: "staff", identity: { userId: "u1", displayName: null }, db: DB };
vi.mock("@/lib/admin/access", () => ({ staffPageAccess: async () => access }));

const listOrders = vi.fn<(db: unknown, options?: { status?: string; limit?: number }) => Promise<AdminOrderSummary[]>>();
const getOrder = vi.fn<(db: unknown, reference: string) => Promise<AdminOrderDetail | null>>();
vi.mock("@/lib/orders/admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orders/admin")>()),
  listOrders: (db: unknown, options?: { status?: string; limit?: number }) => listOrders(db, options),
  getOrder: (db: unknown, reference: string) => getOrder(db, reference),
}));
const reportError = vi.fn();
vi.mock("@/lib/observability/report", () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

/*
 * Task 8c, rulings R100, R104, R114: the three staff pages, with fakes for the access answer and
 * the two reads. Signed-out visitors go to the sign-in page (no `next` parameter); an unconfigured
 * or unreachable Supabase shows its notice; the list filters only by a known status; a malformed
 * or unknown reference is a 404 and a malformed one is never looked up; the detail page shows
 * everything staff need and mounts the controls with the rendered figures.
 */
const REFERENCE = "BB-12AB-34CD";

const summary = (overrides: Partial<AdminOrderSummary> = {}): AdminOrderSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  reference: REFERENCE,
  status: "new",
  statusChangedAt: "2026-10-14T09:30:00.000Z",
  createdAt: "2026-10-14T09:00:00.000Z",
  contactName: "Maria Santos",
  email: "maria@example.com",
  country: "PH",
  quoteRevision: 0,
  quoteSentAt: null,
  ...overrides,
});

const detail = (overrides: Partial<AdminOrderDetail> = {}): AdminOrderDetail => ({
  ...summary(),
  phone: "+63 917 000 0000",
  addressLine1: "12 Coral Street",
  addressLine2: "Unit 4",
  city: "Cebu City",
  region: "Cebu",
  postalCode: "6000",
  notes: "Please call before delivery.\nSecond line.",
  consentVersion: "2026-10-01",
  consentGrantedAt: "2026-10-14T09:00:00.000Z",
  currency: null,
  subtotalMinor: null,
  freightMinor: null,
  paymentUrl: null,
  trackingTokenExpiresAt: "2027-01-14T09:00:00.000Z",
  trackingTokenRotatedAt: null,
  updatedAt: "2026-10-14T09:30:00.000Z",
  lines: [
    { lineNumber: 1, productId: "p1", title: "Bubble Bath", sku: "BB-001", variant: "Lavender", pack: "Single", quantity: 2 },
    { lineNumber: 2, productId: "p2", title: "Sea Sponge", sku: null, variant: null, pack: null, quantity: 1 },
  ],
  events: [
    { actor: "customer", actorUserId: null, eventType: "order_submitted", oldStatus: null, newStatus: "new", metadata: {}, createdAt: "2026-10-14T09:00:00.000Z" },
    { actor: "staff", actorUserId: "u1", eventType: "status_changed", oldStatus: "new", newStatus: "confirmed", metadata: {}, createdAt: "2026-10-14T09:30:00.000Z" },
  ],
  emails: [
    { kind: "acknowledgement", quoteRevision: null, status: "sent", attempts: 1, lastAttemptAt: "2026-10-14T09:01:00.000Z", nextAttemptAt: null, lastErrorCode: null, createdAt: "2026-10-14T09:00:00.000Z" },
    { kind: "quote", quoteRevision: 2, status: "failed", attempts: 3, lastAttemptAt: "2026-10-14T10:00:00.000Z", nextAttemptAt: "2026-10-14T11:00:00.000Z", lastErrorCode: "provider_rejected", createdAt: "2026-10-14T09:45:00.000Z" },
  ],
  ...overrides,
});

const QUOTED = {
  currency: "PHP",
  subtotalMinor: 125050,
  freightMinor: 5000,
  paymentUrl: "https://pay.example.com/invoice/123",
  quoteRevision: 2,
  quoteSentAt: "2026-10-14T11:00:00.000Z",
} as const;

beforeEach(() => {
  access = { kind: "staff", identity: { userId: "u1", displayName: null }, db: DB };
  listOrders.mockReset().mockResolvedValue([]);
  getOrder.mockReset().mockResolvedValue(null);
  reportError.mockReset();
});
afterEach(cleanup);

const ordersPage = async (searchParams: Record<string, string | string[] | undefined> = {}) => {
  const { default: Page } = await import("@/app/admin/orders/page");
  return Page({ searchParams: Promise.resolve(searchParams) });
};
const detailPage = async (reference: string) => {
  const { default: Page } = await import("@/app/admin/orders/[reference]/page");
  return Page({ params: Promise.resolve({ reference }) });
};

describe("/admin", () => {
  it("redirects to the orders (R114)", async () => {
    const { default: AdminIndex } = await import("@/app/admin/page");
    expect(() => AdminIndex()).toThrowError(expect.objectContaining({ path: "/admin/orders" }));
  });
});

describe.each([
  ["the orders list", () => ordersPage()],
  ["an order page", () => detailPage(REFERENCE)],
])("%s, before anything is shown", (_name, page) => {
  it("sends a visitor who is signed out to the sign-in page, with no next parameter, and reads nothing", async () => {
    access = { kind: "signed_out" };
    await expect(page()).rejects.toMatchObject({ path: "/admin/login" });
    expect(listOrders).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("shows the unconfigured notice when Supabase is not set up, and reads nothing", async () => {
    access = { kind: "unconfigured" };
    render(await page());
    expect(screen.getByRole("heading", { level: 1, name: PAGE_COPY.notices.unconfigured.title })).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.notices.unconfigured.body)).toBeTruthy();
    expect(listOrders).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("shows the unavailable notice when sign-in cannot be checked, and reads nothing", async () => {
    access = { kind: "unavailable" };
    render(await page());
    expect(screen.getByRole("heading", { level: 1, name: PAGE_COPY.notices.unavailable.title })).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.notices.unavailable.body)).toBeTruthy();
    expect(listOrders).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
  });
});

describe("/admin/orders", () => {
  it("reads through the signed-in member's own database, newest first, and lists each order", async () => {
    listOrders.mockResolvedValue([
      summary({ reference: "BB-AAAA-0001", status: "new", contactName: "Maria Santos", country: "PH" }),
      summary({ reference: "BB-BBBB-0002", status: "paid", contactName: "Jun Reyes", country: "SG", ...QUOTED }),
    ]);
    render(await ordersPage());
    expect(listOrders).toHaveBeenCalledWith(DB, expect.not.objectContaining({ status: expect.anything() }));
    const table = screen.getByRole("table", { name: PAGE_COPY.orders.tableCaption });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    const headers = within(rows[0]!).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(Object.values(PAGE_COPY.orders.columns));
    const first = within(rows[1]!);
    expect(first.getByRole("link", { name: "BB-AAAA-0001" }).getAttribute("href")).toBe("/admin/orders/BB-AAAA-0001");
    expect(first.getByText(PAGE_COPY.statusNames.new)).toBeTruthy();
    expect(first.getByText("Maria Santos")).toBeTruthy();
    expect(first.getByText("PH")).toBeTruthy();
    expect(first.getByText(PAGE_COPY.orders.values.noQuote)).toBeTruthy();
    expect(first.getByText(PAGE_COPY.orders.values.notYet)).toBeTruthy();
    expect(rows[1]!.querySelectorAll("time")).toHaveLength(2);
    const second = within(rows[2]!);
    expect(second.getByText(PAGE_COPY.statusNames.paid)).toBeTruthy();
    expect(second.getByText(`${PAGE_COPY.orders.values.revision} 2`)).toBeTruthy();
    expect(second.getByText(PAGE_COPY.orders.values.accepted, { exact: false })).toBeTruthy();
    expect(rows[2]!.querySelectorAll("time")).toHaveLength(3);
  });

  it("names the revision whose quote email the mail service accepted (fix wave C-I1)", async () => {
    listOrders.mockResolvedValue([summary({ reference: "BB-BBBB-0002", status: "confirmed", ...QUOTED, quoteRevision: 3 })]);
    render(await ordersPage());
    const row = within(screen.getByRole("table", { name: PAGE_COPY.orders.tableCaption })).getAllByRole("row")[1]!;
    const accepted = within(row).getByText(`${PAGE_COPY.orders.values.accepted} (${PAGE_COPY.orders.values.revision.toLowerCase()} 3)`, { exact: false });
    expect(accepted.querySelector("time")).not.toBeNull();
  });

  it("has one h1, the lead, and a status filter that works as plain links", async () => {
    render(await ordersPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: PAGE_COPY.orders.heading })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: PAGE_COPY.orders.filterLabel });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([PAGE_COPY.orders.filterAll, ...ORDER_STATUSES.map((s) => PAGE_COPY.statusNames[s])]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/admin/orders", ...ORDER_STATUSES.map((s) => `/admin/orders?status=${s}`)]);
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
  });

  for (const status of ORDER_STATUSES) {
    it(`filters by the known status "${status}" and marks it current`, async () => {
      render(await ordersPage({ status }));
      expect(listOrders).toHaveBeenCalledWith(DB, expect.objectContaining({ status }));
      const current = within(screen.getByRole("navigation", { name: PAGE_COPY.orders.filterLabel })).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
      expect(current.map((link) => link.textContent)).toEqual([PAGE_COPY.statusNames[status]]);
    });
  }

  for (const value of ["bogus", "PAID", "Paid", " paid", "paid ", "", "new,paid", "__proto__", "constructor", ["paid", "new"], undefined]) {
    it(`treats ${JSON.stringify(value)} as no filter`, async () => {
      render(await ordersPage({ status: value }));
      expect(listOrders).toHaveBeenCalledTimes(1);
      const options = listOrders.mock.calls[0]![1] ?? {};
      expect(options.status).toBeUndefined();
      const all = within(screen.getByRole("navigation", { name: PAGE_COPY.orders.filterLabel })).getAllByRole("link")[0]!;
      expect(all.getAttribute("aria-current")).toBe("page");
    });
  }

  it("says plainly that there are no orders, with no table", async () => {
    render(await ordersPage());
    expect(screen.getByText(PAGE_COPY.orders.empty)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: PAGE_COPY.orders.showAll })).toBeNull();
  });

  it("says plainly that no order has the filtered status, and offers the whole list", async () => {
    render(await ordersPage({ status: "dispatched" }));
    expect(screen.getByText(PAGE_COPY.orders.emptyFiltered)).toBeTruthy();
    expect(screen.getByRole("link", { name: PAGE_COPY.orders.showAll }).getAttribute("href")).toBe("/admin/orders");
  });

  it("says when the list is cut off at the newest orders", async () => {
    listOrders.mockResolvedValue(Array.from({ length: 100 }, (_, index) => summary({ reference: `BB-0000-${String(index).padStart(4, "0")}` })));
    render(await ordersPage());
    expect(screen.getByText(PAGE_COPY.orders.limitNote)).toBeTruthy();
    cleanup();
    listOrders.mockResolvedValue([summary()]);
    render(await ordersPage());
    expect(screen.queryByText(PAGE_COPY.orders.limitNote)).toBeNull();
  });

  it("shows the could-not-load notice, and reports the error, when the read fails", async () => {
    listOrders.mockRejectedValue(new Error("select_orders failed"));
    render(await ordersPage());
    expect(screen.getByRole("heading", { level: 1, name: PAGE_COPY.notices.loadFailed.title })).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.notices.loadFailed.body)).toBeTruthy();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("select_orders");
  });

  it("is noindex and titled Orders", async () => {
    const { metadata } = await import("@/app/admin/orders/page");
    expect(metadata).toEqual({ title: PAGE_COPY.orders.pageTitle, robots: { index: false, follow: false } });
  });
});

describe("/admin/orders/[reference]", () => {
  it("is a 404 for a malformed reference, and nothing is looked up", async () => {
    for (const reference of ["nope", "BB-12AB", "BB-12AB-34CDE", "BB-12AB-34CG", "../etc/passwd", "BB-12AB-34CD%0A", "", " BB-12AB-34CD x"]) {
      await expect(detailPage(reference)).rejects.toBeInstanceOf(NotFoundSignal);
    }
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("is a 404 for a reference no order has", async () => {
    getOrder.mockResolvedValue(null);
    await expect(detailPage(REFERENCE)).rejects.toBeInstanceOf(NotFoundSignal);
    expect(getOrder).toHaveBeenCalledWith(DB, REFERENCE);
  });

  it("looks a lower-case reference up (the read normalises it) and shows the order under its own reference", async () => {
    getOrder.mockResolvedValue(detail());
    render(await detailPage(REFERENCE.toLowerCase()));
    expect(getOrder).toHaveBeenCalledWith(DB, REFERENCE.toLowerCase());
    expect(screen.getByRole("heading", { level: 1, name: new RegExp(REFERENCE) })).toBeTruthy();
  });

  it("shows the contact and delivery details, the notes, the consent and the times", async () => {
    getOrder.mockResolvedValue(detail());
    render(await detailPage(REFERENCE));
    const l = PAGE_COPY.detail.labels;
    const contact = screen.getByRole("region", { name: PAGE_COPY.detail.sections.contact });
    for (const text of ["Maria Santos", "maria@example.com", "+63 917 000 0000", "12 Coral Street", "Unit 4", "Cebu City", "Cebu", "6000", "PH"]) {
      expect(within(contact).getByText(text), text).toBeTruthy();
    }
    for (const label of [l.name, l.email, l.phone, l.address, l.city, l.region, l.postalCode, l.country]) expect(within(contact).getByText(label)).toBeTruthy();
    const notes = screen.getByRole("region", { name: PAGE_COPY.detail.sections.notes });
    expect(notes.textContent).toContain("Please call before delivery.");
    expect(notes.textContent).toContain("Second line.");
    const consent = screen.getByRole("region", { name: PAGE_COPY.detail.sections.consent });
    expect(consent.textContent).toContain("2026-10-01");
    expect(consent.querySelectorAll("time")).toHaveLength(1);
    expect(screen.getAllByText(PAGE_COPY.statusNames.new).length).toBeGreaterThan(0);
  });

  it("says so when there are no notes or optional details", async () => {
    getOrder.mockResolvedValue(detail({ notes: null, phone: null, addressLine2: null, region: null, postalCode: null }));
    render(await detailPage(REFERENCE));
    expect(screen.getByText(PAGE_COPY.detail.noNotes)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.contact })).getAllByText(PAGE_COPY.detail.values.notGiven).length).toBeGreaterThanOrEqual(3);
  });

  it("lists the products with their variant, pack and quantity", async () => {
    getOrder.mockResolvedValue(detail());
    render(await detailPage(REFERENCE));
    const table = within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.lines }));
    const rows = table.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain("Bubble Bath");
    expect(rows[1]!.textContent).toContain("BB-001");
    expect(rows[1]!.textContent).toContain("Lavender");
    expect(rows[1]!.textContent).toContain("Single");
    expect(within(rows[1]!).getAllByRole("cell").at(-1)!.textContent).toBe("2");
    expect(rows[2]!.textContent).toContain("Sea Sponge");
  });

  it("says no quote has been saved for a new order", async () => {
    getOrder.mockResolvedValue(detail());
    render(await detailPage(REFERENCE));
    const quote = screen.getByRole("region", { name: PAGE_COPY.detail.sections.quote });
    expect(within(quote).getByText(PAGE_COPY.detail.quote.none)).toBeTruthy();
  });

  it("shows the current quote with formatted money, the payment link as plain text, the revision and whether the mail service accepted it", async () => {
    getOrder.mockResolvedValue(detail({ ...QUOTED, status: "confirmed" }));
    render(await detailPage(REFERENCE));
    const quote = within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.quote }));
    expect(quote.getByText("PHP")).toBeTruthy();
    expect(quote.getByText("₱1,250.50")).toBeTruthy();
    expect(quote.getByText("₱50.00")).toBeTruthy();
    expect(quote.getByText("2")).toBeTruthy();
    expect(quote.getByText(QUOTED.paymentUrl)).toBeTruthy();
    expect(quote.queryByRole("link")).toBeNull();
    expect(quote.getByText(PAGE_COPY.detail.quote.values.accepted, { exact: false })).toBeTruthy();
  });

  it("says the quote email has not been accepted yet when it has not", async () => {
    getOrder.mockResolvedValue(detail({ ...QUOTED, quoteSentAt: null }));
    render(await detailPage(REFERENCE));
    const quote = within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.quote }));
    expect(quote.getByText(PAGE_COPY.detail.quote.values.notAccepted)).toBeTruthy();
    expect(quote.queryByText(PAGE_COPY.detail.quote.values.accepted)).toBeNull();
  });

  it("labels the quote email with the revision it belongs to, accepted or not (fix wave C-I1)", async () => {
    const label = (revision: number) => `${PAGE_COPY.detail.quote.emailAccepted} (${PAGE_COPY.detail.quote.revision.toLowerCase()} ${revision})`;
    getOrder.mockResolvedValue(detail({ ...QUOTED, quoteRevision: 2 }));
    const { unmount } = render(await detailPage(REFERENCE));
    let quote = within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.quote }));
    const accepted = quote.getByText(label(2));
    expect(accepted.tagName).toBe("DT");
    expect(accepted.nextElementSibling?.textContent).toContain(PAGE_COPY.detail.quote.values.accepted);
    unmount();

    getOrder.mockResolvedValue(detail({ ...QUOTED, quoteRevision: 3, quoteSentAt: null }));
    render(await detailPage(REFERENCE));
    quote = within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.quote }));
    expect(quote.getByText(label(3)).nextElementSibling?.textContent).toBe(PAGE_COPY.detail.quote.values.notAccepted);
  });

  it("lists the email rows: kind, revision, status, attempts, times and the last error code", async () => {
    getOrder.mockResolvedValue(detail());
    render(await detailPage(REFERENCE));
    const emails = within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.emails }));
    const rows = emails.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain(PAGE_COPY.detail.emails.kinds.acknowledgement);
    expect(rows[1]!.textContent).toContain(PAGE_COPY.detail.emails.statuses.sent);
    expect(rows[2]!.textContent).toContain(PAGE_COPY.detail.emails.kinds.quote);
    expect(rows[2]!.textContent).toContain(PAGE_COPY.detail.emails.statuses.failed);
    expect(rows[2]!.textContent).toContain("provider_rejected");
    expect(within(rows[2]!).getAllByRole("cell").map((cell) => cell.textContent)).toContain("3");
  });

  it("says so when there are no emails and no history", async () => {
    getOrder.mockResolvedValue(detail({ emails: [], events: [] }));
    render(await detailPage(REFERENCE));
    expect(screen.getByText(PAGE_COPY.detail.emails.none)).toBeTruthy();
    expect(screen.getByText(PAGE_COPY.detail.events.none)).toBeTruthy();
  });

  it("lists the events in order with the actor, the type, the statuses and the time", async () => {
    getOrder.mockResolvedValue(detail());
    render(await detailPage(REFERENCE));
    const events = within(screen.getByRole("region", { name: PAGE_COPY.detail.sections.events }));
    const items = events.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain(PAGE_COPY.detail.events.actors.customer);
    expect(items[0]!.textContent).toContain("order submitted");
    expect(items[1]!.textContent).toContain(PAGE_COPY.detail.events.actors.staff);
    expect(items[1]!.textContent).toContain(`${PAGE_COPY.statusNames.new} ${PAGE_COPY.detail.events.statusTo} ${PAGE_COPY.statusNames.confirmed}`);
    expect(items[1]!.querySelector("time")).toBeTruthy();
  });

  it("mounts the controls for the rendered order: its canonical reference, status and current quote", async () => {
    getOrder.mockResolvedValue(detail({ ...QUOTED, status: "confirmed" }));
    render(await detailPage(REFERENCE.toLowerCase()));
    const controls = screen.getByRole("region", { name: PAGE_COPY.detail.sections.controls });
    expect(within(controls).getByRole("button", { name: PAGE_COPY.controls.status.advance.paid })).toBeTruthy();
    expect(within(controls).queryByRole("button", { name: PAGE_COPY.controls.status.advance.confirmed })).toBeNull();
    expect((within(controls).getByLabelText(PAGE_COPY.controls.quote.subtotalLabel, { exact: false }) as HTMLInputElement).value).toBe("1250.50");
  });

  it("has a link back to the list and exactly one h1", async () => {
    getOrder.mockResolvedValue(detail());
    render(await detailPage(REFERENCE));
    expect(screen.getByRole("link", { name: PAGE_COPY.detail.backToOrders }).getAttribute("href")).toBe("/admin/orders");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows the could-not-load notice, and reports the error, when the read fails", async () => {
    getOrder.mockRejectedValue(new Error("select_orders failed"));
    render(await detailPage(REFERENCE));
    expect(screen.getByRole("heading", { level: 1, name: PAGE_COPY.notices.loadFailed.title })).toBeTruthy();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("is noindex, titled with the reference when it is well formed, and plainly Order otherwise", async () => {
    const { generateMetadata } = await import("@/app/admin/orders/[reference]/page");
    expect(await generateMetadata({ params: Promise.resolve({ reference: REFERENCE }) })).toEqual({ title: `${PAGE_COPY.detail.pageTitle} ${REFERENCE}`, robots: { index: false, follow: false } });
    expect(await generateMetadata({ params: Promise.resolve({ reference: "garbage" }) })).toEqual({ title: PAGE_COPY.detail.pageTitle, robots: { index: false, follow: false } });
  });
});

describe("/admin/orders/[reference] not found", () => {
  it("says there is no such order, links back to the list, and is noindex", async () => {
    const { default: NotFound, metadata } = await import("@/app/admin/orders/[reference]/not-found");
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: PAGE_COPY.detail.notFoundTitle })).toBeTruthy();
    expect(screen.getByRole("link", { name: PAGE_COPY.detail.backToOrders }).getAttribute("href")).toBe("/admin/orders");
    expect(metadata).toEqual({ title: PAGE_COPY.detail.notFoundPageTitle, robots: { index: false, follow: false } });
  });
});
