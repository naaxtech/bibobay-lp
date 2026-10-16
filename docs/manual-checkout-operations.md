# Manual checkout operations

**Status: the customer side, the staff APIs and the staff pages are built (Task 8c). The whole flow has not been tried end to end on a live preview yet (Task 12), so it is not ready to take real orders.**
The commerce gate and order pad (Task 6), the order database, the order request API and the
tracking API (Task 7a; see [database-security.md](database-security.md#orders-migrations-0002-to-0005)),
the shop's catalogue and product pages, `/shop` and `/shop/[slug]` (Task 7b), and the order request
and tracking pages, `/order`, `/track` and `/orders/[token]` (Task 7c), all exist. The email outbox
worker and the order emails (buyer acknowledgement, staff order alert, and the quote email for when
staff can send one) exist too (Task 8a). Staff sign-in, the staff access rules and the staff APIs
for quotes, status changes and new tracking links exist (Task 8b; see [Staff access](#staff-access)),
and so do the staff pages that use them: the sign-in page, the order list and the order page (Task 8c;
see [Using the staff pages](#using-the-staff-pages)). Only a unit-test and keyless browser pass
has covered the signed-in pages so far; a pass on a live preview with real staff accounts comes in
Task 12. `commerceEnabled` is `false` by default and must stay off until that pass has been done.

This page holds the procedures for what exists ([Staff access](#staff-access) and
[Using the staff pages](#using-the-staff-pages)) and, under "What the specification requires", the
rules the whole flow must meet. The live pass (Task 12) may add to the procedures. Do not take
orders by any other route in the meantime.

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

Built in Task 8b; the staff pages that use it are described in
[Using the staff pages](#using-the-staff-pages) (Task 8c). Database details:
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

**What staff can do** (the API; the staff pages call it)

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

## Using the staff pages

Built in Task 8c. They need JavaScript, and a staff account as described under
[Staff access](#staff-access). The pages are private: they are never in the sitemap, no public
page links to them, and search engines are told to stay away.

1. **Sign in** at `/admin/login` with your email address and password. A bare `/admin` goes to the
   orders. If you open an order link while signed out you land on the sign-in page; after signing in
   you arrive on the order list, so open the order again from there.
2. **Read an order**: `/admin/orders` lists the newest orders (reference, status, when it was
   submitted and last changed, contact name, country, quote revision, and whether the mail service
   accepted the quote email). The status links above the list narrow it to one status. Open a
   reference to see the contact and delivery details, the notes, when consent was given, the
   products, the current quote (the payment link is shown as plain text, not a link), every email
   row (kind, status, attempts, last error code) and the order's history.
3. **Save a quote**: on an order that is `new` or `confirmed`, choose the currency, type the subtotal
   and freight in the currency's main unit (for example `1250.50`; yen take no decimals) and paste
   the payment link. Saving stores a new revision and sends nothing to the customer.
4. **Queue the quote email**: once the revision is saved, "Queue quote email" asks the server to queue
   it. The button stays off while the form holds changes that are not saved. The email is attempted
   after the answer; the order's email rows and its "Quote email" line show what happened later (reload
   the page): "Accepted by the mail service" means the mail service took the email, not that it
   arrived.
5. **Advance the status**: only the next allowed step is offered (`new` → `confirmed` → `paid` →
   `dispatched` → `closed`). Marking an order paid is a record that you have checked the payment
   yourself; the website never takes or checks one.
6. **Cancel**: "Cancel order" asks for confirmation first. A cancelled or closed order has no
   status or quote controls.
7. **New tracking link**: "Replace tracking link" makes a new private link, shows it once with a Copy
   button and stops the old one working at once. Copy it before you leave the page: it cannot be
   shown again. On a preview deployment the link points at the preview address.
8. **Sign out** with the button in the header.

What the messages mean (they come from the server as written; nothing was changed unless a message
says it was saved):

| Message starts | Meaning |
|---|---|
| "Quote saved." | The revision is stored. Nothing has gone to the customer. |
| "Quote queued for email." | The email is queued for that revision. Its delivery shows on the order later. |
| "This quote was already queued" | That revision was queued before; nothing more was queued. |
| "Order status updated." | The status moved one step. |
| "New tracking link created." | Copy the link now; the old one no longer works. |
| "This order changed since you opened it." | A colleague changed the order first. The page reloads itself; check it and try again. |
| "This order's current state does not allow that." | For example a quote on an order that is already paid. |
| "Please check the highlighted fields" | One or more fields need fixing; the problems are written beside them. |
| "No quote can be saved yet" | The site owner has not listed any payment provider; see [deployment.md](deployment.md). |
| "Please sign in to continue." | The session ended; you are sent to the sign-in page. |
| "Staff sign-in cannot be checked right now." | The sign-in service or the database did not answer. Nothing was changed. Try again in a few minutes. |

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

Until the whole flow has been tried end to end on a live preview (Task 12), do not take real orders
with it.
