# Manual checkout operations

**Status: partly built, not usable yet.** The commerce gate and order pad (Task 6) exist, and so do
the order database, the order request API and the tracking API (Task 7a; see
[database-security.md](database-security.md#orders-migrations-0002-to-0005)) and the shop's
catalogue and product pages, `/shop` and `/shop/[slug]` (Task 7b). The order request page and the
tracking pages (`/order`, `/track`, `/orders/[token]`) are not built yet (Task 7c), and neither are
the staff area and quote emails (Task 8; see the plan in `docs/superpowers/plans/`).
`commerceEnabled` is `false` by default and must stay off: switching it on today shows the shop,
whose "Review your order" link leads to a page that does not exist yet, and opens the order and
tracking APIs, which would store order requests that nobody can manage yet.

This page lists what the design specification requires, so operations staff know what is coming.
It is not a procedure: the real steps will be written here once the workflow exists and has been
tested. Do not take orders by any other route in the meantime.

## What exists today

**The shop pages** (Task 7b)

- While commerce is off, `/shop` and every `/shop/...` address answer "not found" (the site's
  404 page) before the catalogue is read, and no page shows a shop link.
- While it is on, `/shop` lists every listed product with its picture, name, short description and
  an "Add to order" button, grouped by category when products have one. A product page adds the
  CMS details, the SKU, variant and pack when set, and the product's notice. A sold-out product
  keeps its page, marked sold out, with no way to add it. No price appears anywhere.
- The order request page (`/order`), the tracking pages and every `/orders/...` page will be
  `noindex` and kept out of the sitemap; `/orders/...` already sends no referrer, and visit
  statistics and error reports record such an address as `/orders/[token]`.

**Testing the shop with commerce on** (developers)

`scripts/e2e/enable-commerce-fixture.mjs <copy>` switches commerce and tracking on in a scratch
copy of the repository and makes its catalogue return a few test products, so the production build
of that copy can run `e2e/shop/commerce-on.spec.ts` (`E2E_COMMERCE=1`). It refuses to touch this
repository or any folder inside a git work tree, and nothing in the site imports it.

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
