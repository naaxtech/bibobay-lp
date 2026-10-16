# Manual checkout operations

**Status: the customer side and the staff APIs are built; the staff pages are not built yet (Task 8c), so it is not usable yet.**
The commerce gate and order pad (Task 6), the order database, the order request API and the
tracking API (Task 7a; see [database-security.md](database-security.md#orders-migrations-0002-to-0005)),
the shop's catalogue and product pages, `/shop` and `/shop/[slug]` (Task 7b), and the order request
and tracking pages, `/order`, `/track` and `/orders/[token]` (Task 7c), all exist. The email outbox
worker and the order emails (buyer acknowledgement, staff order alert, and the quote email for when
staff can send one) exist too (Task 8a). Staff sign-in, the staff access rules and the staff APIs
for quotes, status changes and new tracking links exist (Task 8b; see [Staff access](#staff-access));
the staff pages that use them do not (Task 8c; see the plan in `docs/superpowers/plans/`).
`commerceEnabled` is `false` by default and must stay off: switching it on today lets customers send
order requests that staff could only see and answer through raw API calls.

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
- Each order attempt carries a random submission key. The form never resends by itself: if a
  customer's connection drops and they press send again without changing anything, the database
  answers with the first order's reference and stores nothing new: one order, one set of queued
  emails. If anything sent changes first (a corrected email or address, another quantity), or the
  page is reloaded, the next send is a new attempt with a new key. After a lost answer, staff may
  therefore see two requests from the same person; confirm with the customer and cancel the one
  they don't want.
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

## Staff access

Built in Task 8b; the staff pages that use it come in Task 8c. Database details:
[database-security.md](database-security.md#staff-access-migration-0007).

**Adding a staff member** (the owner, in the Supabase dashboard)

1. Authentication: add the user with their email address and a strong password, and hand the
   password over through a channel you trust. Keep public sign-ups switched off
   ([deployment.md](deployment.md#staff-access-task-8b)).
2. SQL editor, with the user's id from the Authentication user list (the display name is optional,
   at most 80 characters):

   ```sql
   insert into public.staff_users (user_id, display_name) values ('<user id>', '<first name>');
   ```

Signed in without an active `staff_users` row, a person can see and change nothing: the database
itself refuses them, whatever the website does.

**Removing access**: `update public.staff_users set active = false, disabled_at = now() where user_id = '<user id>';`
Their next request is refused. Prefer this to deleting the Auth user: the audit trail records each
change with the staff member's user id, and the disabled row still says whose id it was.

**Signing in**: email and password only (no sign-up, reset or magic link on the website; a
forgotten password is reset by the owner in Supabase). At most 10 attempts per network address and
5 per email address in each 15 minutes. A wrong password and an account without staff access get
the same answer. The session is kept in cookies that page scripts cannot read.

**What staff can do** (the API; the pages in Task 8c will call it)

- Save a quote: currency (a three-letter ISO 4217 code, e.g. `AUD`), subtotal and freight in the currency's minor
  units (cents), and the payment link, which must be https on a host listed exactly in
  `PAYMENT_HOST_ALLOWLIST`. Only while the order is `new` or `confirmed`. Saving never emails
  anyone; each save is a new revision of the quote.
- Send a saved quote: queues the quote email for that revision once. Sending the same revision again
  queues nothing; a newer save makes an older queued email obsolete (it is skipped, never sent with
  the wrong figures). Sending does not change the order's status: staff move it themselves.
- Change the status one step at a time (`new` → `confirmed` → `paid` → `dispatched` → `closed`), or
  cancel before `closed`. Each change names the status the staff member saw, so if a colleague
  changed it first nothing happens and the order must be reloaded.
- Issue a new private tracking link: shown once to the staff member, the old link stops working.
- Every one of these is recorded in the order's history with the staff member's user id.

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
  list** (`PAYMENT_HOST_ALLOWLIST`, enforced since Task 8b). BIBO Bay never collects card numbers
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

Until Task 8c adds the staff pages and the whole flow is reviewed and tested end to end, there is
nothing for operations staff to run.
