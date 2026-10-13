# Manual checkout operations

**Status: not built yet.** There is no shop, order form, order database, staff area or quote email
in the code today. The commerce gate and order pad are Task 6, the catalogue, order requests and
tracking are Task 7, and staff order administration with quote emails is Task 8 (see the plan in
`docs/superpowers/plans/`). `commerceEnabled` is `false` by default and must stay off: switching it
on today only adds a header link to a `/shop` page that does not exist.

This page lists what the design specification requires, so operations staff know what is coming.
It is not a procedure: the real steps will be written here once the workflow exists and has been
tested. Do not take orders by any other route in the meantime.

## What the specification requires

**For customers**

- The catalogue (in Sanity) has products and categories but **no public prices**. A product shows
  only when it is listed and commerce is enabled.
- Customers add products to an order pad in their browser, then submit an **order request** with
  adult contact details, a delivery address, notes, consent and quantities. The form states plainly
  that **no payment is taken**.
- The server reloads every product from Sanity and stores its own copy of title, SKU, variant and
  pack. Names sent by the browser are never trusted.
- The customer receives an acknowledgement without prices.
- Customers track an order with a private link (a rotating token) or with the order reference plus
  the matching email. A reference alone reveals nothing.

**For staff**

- Staff sign in through Supabase Auth and must also have an active row in `staff_users`. Being
  signed in alone grants nothing.
- Staff set subtotal, freight and currency, and a **payment link whose host must be on an approved
  list** (`PAYMENT_HOST_ALLOWLIST`, not used by any code yet). BIBO Bay never collects card numbers
  or bank details.
- Sending the quote and payment link is a separate, explicit action, and sending it twice cannot
  email twice (outbox with an idempotency key).
- Order status moves one way only: `new` → `confirmed` → `paid` → `dispatched` → `closed`;
  cancellation is allowed before the order is complete.
- Every change is recorded as an audit event (who, what, old and new status, when).

**While commerce is disabled** (the default)

- Shop, order and tracking links and sitemap entries disappear, and those routes answer "not found"
  or a controlled unavailable state.
- Order submission is refused on the server with a response that reveals nothing, even if someone
  calls the route directly.
- Staff administration stays available to authorised staff.

**Data protection**

- Order tables use forced row level security like the lead tables
  ([database-security.md](database-security.md)); anonymous users cannot read orders.
- QA orders on any shared environment are labelled `QA test … - delete me` and removed afterwards,
  and their removal is checked.

Until Tasks 6 to 8 are built, reviewed and tested end to end, there is nothing for operations staff
to run.
