# Incident runbook

What to do when something goes wrong on the live site, written for the owner working alone. It
covers five things the site cannot do for itself yet: [removal requests](#removal-requests),
[parked emails](#parked-emails), [switching commerce off now](#switching-commerce-off-now),
[rollback](#rollback) and [secret rotation](#secret-rotation). Alerts that tell you something is wrong
are listed in [observability.md](observability.md); the tables and functions named here are described in
[database-security.md](database-security.md).

Run SQL in the Supabase dashboard's SQL editor, which connects as a role that bypasses row level
security. Read every statement before you run it, change only the quoted placeholders (`<address>`,
`<event id>`, `<row id>`), and never paste a result that holds a person's email address into a chat,
a ticket or a document. Nothing in this repository runs these statements for you: until a staff tool
exists (out of scope for the first launch), this page is the tool.

## Removal requests

The privacy page, the signup consent sentence and `/thank-you` promise that a person can ask to be
removed. The request arrives as a reply to an email the site sent, or at the contact address the
Studio holds (`siteSettings.contactEmail`). A request from the address on file is enough; a request
from anyone else about that address is not: ask the person to write from the address itself.

Removal means **withdrawing** consent. The row is kept (the code has no delete path) so that a
later signup with the same address cannot quietly re-add the person: a repeat submission of a
withdrawn address changes nothing but `last_submitted_at` and `rejoin_requested_at`, and it is
never treated as consent. Once a lead is withdrawn, the outbox claim marks every delivery of that
lead `skipped` (reason `lead_withdrawn`) and never returns it, so no email is sent to the person
whatever the website does.

1. Withdraw the lead. The address is stored trimmed and in lower case (a database check enforces it),
   so match it that way:

   ```sql
   update public.lead_submissions
   set consent_state = 'withdrawn', consent_withdrawn_at = now(), updated_at = now()
   where email = lower(btrim('<address>')) and consent_state = 'granted'
   returning id, consent_state, consent_withdrawn_at;
   ```

   One row back means it worked. No row back means the address is not on the list as granted, or the
   person is already withdrawn; check without changing anything:

   ```sql
   select id, consent_state, consent_withdrawn_at, rejoin_requested_at
   from public.lead_submissions
   where email = lower(btrim('<address>'));
   ```

2. Reply to the person (from the same mailbox they wrote to) that they are removed and will receive
   no more email. Say nothing more specific than that.
3. A person who later signs up again with the same address is **not** re-added: `rejoin_requested_at`
   is set instead, and you decide through a channel you trust (the address can be typed by anyone).
4. Erasing the row altogether is a legal decision, not a routine one: take it to the owner and a lawyer
   first. Deleting the row also deletes that lead's delivery rows (they cascade) and would let the same
   address sign up again as a new person.

Orders are separate records. A removal request about a lead does not touch orders; a request about an
order's contact details needs the owner's decision, and the order's history is an audit trail.

## Parked emails

An email that cannot be sent is attempted up to 8 times in all (right after the answer, then once per daily run) by the cron worker (once a day on the Hobby plan, R180). Two
situations stop the retries and leave the row for a person; both are reported to Sentry as
`delivery_expired` and appear in the outbox tables as `status = 'failed'` with `next_attempt_at` set
to infinity:

- **`stale_unconfirmed`**: a signup or order email whose outcome is unknown (a timeout, a provider server error) was
  not confirmed within the 23-hour window (on a daily schedule such a row gets at most one retry before it is parked). The provider remembers an idempotency key for 24 hours,
  so past that point a retry could deliver a second copy of an email that did arrive. Contact staff
  alerts are not parked for this (R211): they are retried until their eighth attempt, because a
  second copy of a staff alert is harmless ([Contact messages](#contact-messages)).
- **A final failure code**: the eighth failed attempt, or `invalid_idempotent_request` (the provider
  already holds this key with different content).

Nothing is claimed as sent for a parked row. Work through them like this.

1. List what is parked (the signup and order outboxes; a parked contact alert is read under
   [Contact messages](#contact-messages)):

   ```sql
   select 'lead' as outbox, id, kind, attempts, last_error_code, last_attempt_at, unconfirmed_since
   from public.lead_delivery_events
   where status = 'failed' and next_attempt_at = 'infinity'
   union all
   select 'order' as outbox, id, kind, attempts, last_error_code, last_attempt_at, unconfirmed_since
   from public.order_email_outbox
   where status = 'failed' and next_attempt_at = 'infinity'
   order by last_attempt_at;
   ```

2. For each row, find out whether the email actually went. In the Resend dashboard, look for the
   message by the idempotency key the site used: `lead-delivery/<event id>` for a lead row,
   `order-email/<row id>` for an order row (the `id` from the list). Resend keeps keys and logs for a
   limited time; if the message is no longer there, check with the recipient or the order.
3. If it **was delivered**, close the row so it stops appearing. For a quote email, also check the
   order page: staff send the quote again deliberately, as a new revision, if the customer needs one.

   ```sql
   update public.order_email_outbox
   set status = 'skipped', last_error_code = 'closed_by_staff', updated_at = now()
   where id = '<row id>' and status = 'failed' and next_attempt_at = 'infinity';
   ```

   The same statement for a lead row uses `public.lead_delivery_events` and `<event id>`. If the row is a
   lead acknowledgement, also mirror it on the lead (the staff views read this column):

   ```sql
   update public.lead_submissions
   set acknowledgement_status = 'skipped', updated_at = now()
   where id = (select lead_id from public.lead_delivery_events where id = '<event id>');
   ```

4. If it **was not delivered**, and the cause is fixed (for example a wrong `RESEND_FROM` or an expired
   key), put the row back in the queue. The next cron run sends it (once a day, 06:00–06:59 UTC on Hobby; to send it now, call the worker by hand as in [deployment.md](deployment.md#email-outbox-worker-task-8a)):

   ```sql
   update public.order_email_outbox
   set status = 'pending', attempts = 0, next_attempt_at = now(), last_error_code = null,
       unconfirmed_since = null, claimed_at = null, updated_at = now()
   where id = '<row id>' and status = 'failed' and next_attempt_at = 'infinity';
   ```

   For a lead row use `public.lead_delivery_events` and `<event id>`. After 24 hours the provider no
   longer de-duplicates, so re-queue a `stale_unconfirmed` row only after step 2 showed it did not go.
   A withdrawn lead is never sent to, whatever you do here.
5. If a row keeps parking, read the Sentry event for its kind and code before trying again. The
   common causes are a sender domain that is not verified, a revoked or wrong `RESEND_API_KEY`, and a
   provider quota.

## Contact messages

Each message from the contact form is a row in `public.contact_messages`, with one alert row in
`public.contact_message_deliveries`. There is no inbox page (R200): staff read a message in its alert
email, whose Reply-To is the sender's address (labelled unverified, because nothing on the form proves
the sender owns it). When the alert is parked, read the message by SQL and reply by hand.

A contact alert is parked only after its eighth attempt, or on `invalid_idempotent_request` (R211). A
send whose outcome is unknown is not parked after 23 hours as signup and order emails are: it is
retried at every cron run, under the same idempotency key and, once the provider has forgotten that
key, as a new send. So an alert may now and then reach the staff inbox twice; `unconfirmed_since` on
its row shows that it might have. A lost eighth attempt is parked as `stale_unconfirmed`.

1. List the parked alerts (`failed` with `next_attempt_at` set to infinity) with their messages:

   ```sql
   select delivery.id, delivery.attempts, delivery.last_error_code, delivery.unconfirmed_since,
          message.created_at, message.topic, message.name, message.email, message.message
   from public.contact_message_deliveries as delivery
   join public.contact_messages as message on message.id = delivery.message_id
   where delivery.status = 'failed' and delivery.next_attempt_at = 'infinity'
   order by message.created_at;
   ```

   Never paste a result into a chat, a ticket or a document.
2. Reply to the sender by hand from your own mailbox. Check first whether the alert actually went: in
   the Resend dashboard look for the idempotency key `contact-delivery/<row id>` (the `id` from the
   list); an `unconfirmed_since` value means the send may have reached the provider.
3. Close the row so it stops appearing. The contact table has no `skipped` status, so mark it sent:

   ```sql
   update public.contact_message_deliveries
   set status = 'sent', last_error_code = 'closed_by_staff', updated_at = now()
   where id = '<row id>' and status = 'failed' and next_attempt_at = 'infinity';
   ```

4. If you would rather have the alert re-sent (the cause is fixed, and step 2 showed it did not go), put the
   row back in the queue. The next cron run sends it ([deployment.md](deployment.md#email-outbox-worker-task-8a)):

   ```sql
   update public.contact_message_deliveries
   set next_attempt_at = now(), attempts = 0, status = 'pending', last_error_code = null,
       unconfirmed_since = null, claimed_at = null, updated_at = now()
   where id = '<row id>' and status = 'failed' and next_attempt_at = 'infinity';
   ```

**The staff address was removed.** If `STAFF_NOTIFICATION_EMAIL` is removed after messages were queued,
their alerts wait: the worker claims no contact alert without a staff address, so none is parked, and
`/api/readiness` shows `contact: false` and the form closes. Set the address again and the next cron run
sends them. The worker drains contact alerts without `LEAD_IP_HASH_SECRET`; only the form needs it.

## Switching commerce off now

Use this when orders are going wrong (a bad price, a leak of the tracking links, a failing order
store): the shop, the order pad, the order form and tracking stop answering and the order APIs refuse.

1. In the Studio, open **Site settings** and switch `commerceEnabled` off (leave `trackingEnabled`
   as it is, or switch it off too to stop tracking lookups), then publish.
2. The Sanity webhook tells the site to drop its cache at once. If the webhook is broken or its secret
   is wrong ([secret rotation](#secret-rotation)), the server gates still re-read the two switches at
   least every 300 seconds, so the change lands within five minutes at the latest (ruling R127).
3. Check from outside: `https://<site>/shop`, `/order` and `/track` answer 404, and
   `POST /api/orders` answers 404 with the same body for every request.
4. Stronger, if the order store itself is the problem: remove `SUPABASE_SERVICE_ROLE_KEY` from the
   Production environment in Vercel and redeploy; signups and orders then answer 503 and store
   nothing. Put it back when the cause is fixed.

Staff keep access to `/admin/orders` while commerce is off, so you can still work the queue.

## Rollback

- **A bad deployment:** in Vercel, open the project's Deployments, pick the last good production
  deployment and use **Instant Rollback**. It switches traffic without a rebuild. Roll forward again
  by promoting a fixed deployment.
- **The CMS cache survives deployments.** Published Sanity content is held in the Next.js Data Cache,
  which a rollback or a redeploy does not clear ([cms-operations.md](cms-operations.md#publishing-and-when-the-site-updates)).
  To undo a content change, revert it in the Studio and publish; the webhook refreshes the site.
- **The database does not roll back with the site.** Migrations are forward-only: before the first
  migration is applied to a live project (Task 11) the migration files may still be edited; after
  that, every change is a new numbered file in `supabase/migrations/` (ruling R124), never an edit of
  an applied one and never an edit made by hand in the dashboard. A bad migration is repaired by a new
  migration that fixes it.
- **After any rollback**, run `npm run verify:deployment -- https://<site> --browser --require-ready`
  ([qa-checklist.md](qa-checklist.md#3-against-the-deployed-preview-then-production)) and look at the
  alerts in Sentry.

## Secret rotation

Rotate at the provider first, then set the new value in Vercel for the Production environment (and
Preview where it is used), then redeploy: server values are read at deploy time, and `NEXT_PUBLIC_`
values are compiled into the build. Never put a secret in the repository, a chat or a document. If a
secret may have leaked, treat it as leaked: rotate it before you investigate. Every name below is in
`.env.example`; what each one does is in [deployment.md](deployment.md#environment-variables).

| Name | Used by | How to rotate | What breaks meanwhile |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Every server write: signups, orders, the email outbox, rate limits, staff sign-in limits | Roll the secret key in the Supabase project's API key settings, set the new key in Vercel, redeploy | Signups and orders answer 503 and store nothing; staff cannot sign in; no email is sent. Nothing already stored is lost. |
| `RESEND_API_KEY` | Sending every email | Create a new key in Resend, set it in Vercel, redeploy, then delete the old key | Emails wait in the outbox (`pending`) and are sent by the cron worker after the redeploy. |
| `RESEND_FROM`, `RESEND_REPLY_TO`, `STAFF_NOTIFICATION_EMAIL` | The sender, reply and staff-alert addresses (settings, not secrets) | Change in Vercel, redeploy | Until the sender is a verified domain, sends fail and rows retry, then park ([parked emails](#parked-emails)). |
| `CRON_SECRET` | `/api/cron/email-outbox` (Vercel Cron sends it as a Bearer token) | Generate a new 32+ character random value, set it in Vercel Production, redeploy | The worker answers 401 or 503 until the redeploy: failed emails are not retried for that time; nothing is lost. |
| `LEAD_IP_HASH_SECRET` | The keyed hash of client addresses in the rate limits (signups, orders, staff sign-in) | Generate a new 32+ character random value, set it, redeploy | Existing rate-limit counters stop matching, so every client starts fresh: limits briefly allow more. Nothing else is keyed by it. |
| `SANITY_REVALIDATE_SECRET` | Verifies the signed Sanity webhook | Set the new value in Vercel **and** in the Sanity webhook's secret field, redeploy | Webhook calls answer 401 until both match, so published edits do not reach the site (the commerce switches still refresh within 300 seconds). |
| `SANITY_API_READ_TOKEN` | Draft preview (a Viewer token) | Delete the token in the Sanity project's API settings, create a new Viewer token, set it, redeploy | Draft preview answers 503; published content is not affected. |
| `SANITY_WRITE_TOKEN` | Only the Studio seed script, run locally; never set on Vercel | Delete it in Sanity; create one only when you next run the seed | Nothing on the site. |
| `SENTRY_AUTH_TOKEN` (with `SENTRY_ORG`, `SENTRY_PROJECT`) | Source-map upload during the build | Revoke the token in Sentry, create a new one, set it | The next build uploads no source maps (stack traces are less readable); the site is unaffected. |
| `PAYMENT_HOST_ALLOWLIST`, `LEAD_ACK_SEND_LIMIT_PER_HOUR`, `SANITY_STUDIO_ORIGIN` | Configuration, not secrets | Change in Vercel, redeploy | A wrong payment host list stops staff saving quotes; a too-low send limit parks emails in the outbox until the hour passes. |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET`, `NEXT_PUBLIC_SANITY_API_VERSION`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_SENTRY_DSN` | Public values, visible in the browser by design | Not secrets; change like any setting, then rebuild | A leaked key of this kind is not an incident: the PostHog and Sentry keys can only submit data. |

Staff passwords are managed in the Supabase dashboard: to cut a person off at once, set their
`staff_users` row inactive ([manual-checkout-operations.md](manual-checkout-operations.md#staff-access)),
and reset or remove the Auth user.
