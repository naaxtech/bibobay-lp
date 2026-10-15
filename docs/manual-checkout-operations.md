# Manual checkout operations

**Status: the customer side is built; the staff side is not built yet, so it is not usable yet.**
The commerce gate and order pad (Task 6), the order database, the order request API and the
tracking API (Task 7a; see [database-security.md](database-security.md#orders-migrations-0002-to-0005)),
the shop's catalogue and product pages, `/shop` and `/shop/[slug]` (Task 7b), and the order request
and tracking pages, `/order`, `/track` and `/orders/[token]` (Task 7c), all exist. The staff area,
quote emails and the outbox worker are not built yet (Task 8; see the plan in
`docs/superpowers/plans/`). `commerceEnabled` is `false` by default and must stay off: switching it
on today lets customers send order requests that nobody can see, answer or manage yet.

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

**The order and tracking pages** (Task 7c)

- While commerce is off, `/order` answers "not found"; while commerce or tracking is off, `/track`
  and every `/orders/...` address do too, and the footer shows no "Track an order" link.
- `/order` shows the customer's order pad with product names from the CMS (products no longer listed
  drop out), says plainly that nothing is charged and that a quote with a payment link comes by
  email, and asks for adult contact and delivery details, optional notes and the order consent tick
  (the sentence and its version come from the CMS legal settings; see
  [cms-operations.md](cms-operations.md#legal-text-consent-version-and-indexing)). The country list
  is the CMS `orderCountries`, or every country.
- Each order attempt carries a random submission key. If a customer's connection drops and the form
  sends the same request again, the database answers with the first order's reference and stores
  nothing new: one order, one set of queued emails.
- Once stored, the page shows the order reference and, with tracking on, the private tracking link
  (shown once; only a hash of it is kept) and the way to `/track`. The order pad empties.
- `/track` finds an order by its reference and the email it was placed with; `/orders/<token>`
  opens it by private link. Both show the status, its steps, the products with their quantities and
  two dates, never a price, an address or an email. Every miss reads the same.
- These pages are `noindex` and never in the sitemap. `/orders/...` sends no referrer and
  `Cache-Control: private, no-store`, and visit statistics and error reports record such an address
  as `/orders/[token]`.

**Testing the shop with commerce on** (developers)

`scripts/e2e/enable-commerce-fixture.mjs <copy>` switches commerce and tracking on in a scratch
copy of the repository and makes its catalogue return a few test products, so the production build
of that copy can run `e2e/shop/commerce-on.spec.ts` and `e2e/shop/order-flow.spec.ts`
(`E2E_COMMERCE=1`). The copy has no database: the order and tracking specs answer the API calls in
the browser (`page.route`), and `/orders/<token>` shows its "tracking unavailable" state. It refuses
to touch this repository or any folder inside a git work tree, and nothing in the site imports it.

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
