# Data protection

The personal data this website handles, the legal basis and the consent record for each use, what it
keeps on a visitor's device, what the owner must still do before launch, and how to answer a person
who asks about their data. It is written for the owner working alone, from the code as it is today
(ruling R149): where a fact depends on a decision the code cannot make (who the controller is, the
contracts with each provider, where data is stored, how long it is kept), it is listed under
[Before launch (owner)](#before-launch-owner) instead of being stated.

This is not legal advice. It is written against the EU GDPR and the UK GDPR (the same article
numbers), and the ePrivacy rules on storing anything on a visitor's device (EU Directive 2002/58/EC,
Article 5(3); in the UK, regulation 6 of PECR). Other data-protection laws may apply as well: the law
of the controller's own country, and children's privacy rules, because children may visit a
children's brand's website (see "Which laws apply" under [Before launch (owner)](#before-launch-owner)).
A lawyer's review is one of the launch tasks.

The privacy page says the same things in plain words: its repository fallback text is
`lib/content/legal-fallback.ts`, and `tests/content/legal-pages.test.tsx` pins every claim in it.
When the code changes what it collects, change the fallback text, this document and the published
Sanity text together.

- src: https://gdpr-info.eu/art-13-gdpr/ · GDPR Article 13 (information to give when data is collected) · 2026-10-17
- src: https://www.legislation.gov.uk/uksi/2003/2426/regulation/6 · PECR regulation 6 (storage on the device) · 2026-10-17
- src: https://eur-lex.europa.eu/eli/dir/2002/58/oj · Directive 2002/58/EC Article 5(3) · 2026-10-17

## Personal data the site handles

Legal bases are those of GDPR Article 6(1): (a) consent, (b) steps taken at the person's request
before a contract, (f) legitimate interests. "Privacy page" names the heading of the fallback text
that tells visitors about it.

| What | From where | To where | Legal basis | Kept for | Privacy page |
|---|---|---|---|---|---|
| Founding-family signup: email address (required), first name and broad age range (optional), the consent record (below), the page it was made on, the browser's language, campaign tags (`utm_*`), when it was made and when the address was submitted again | The signup form (`/api/leads`; fields in `lib/leads/fields.ts`) | Supabase, table `lead_submissions`, written by the server only | (a) consent while listed: the required consent tick; (f) legitimate interest for the kept withdrawal record (ruling R151) | As long as the list exists; nothing deletes it. A withdrawal marks the row withdrawn and keeps it (no delete path in the code). No period has been set | "What the founding-family form collects", "How long we keep your details" |
| Signup emails: the acknowledgement with the activity-pack download link, to the person; the staff alert (email address, first name, age range), to `STAFF_NOTIFICATION_EMAIL` | The signup, through the email outbox | Resend (sending); the staff inbox; Supabase `lead_delivery_events` keeps a delivery record per email (kind, status, attempts, Resend's message reference, a short error code), never a copy of the email | (a) consent while listed; (f) legitimate interest for the delivery records kept with a withdrawn signup (ruling R151) | Delivery records live as long as their signup (they are deleted with it). Resend's own logs and the staff inbox keep what their settings keep | "Why we use your details", "Services that handle your details" |
| Contact messages: name, email address, topic, the message and when it arrived. The form is for grown-ups and asks for nothing about a child | The contact form (`/api/contact`; fields in `lib/contact/fields.ts`), only while it is open | Supabase, table `contact_messages`, written by the server only; `contact_message_deliveries` keeps one alert record per message (status, attempts, Resend's message reference, a short error code), never a copy of the email. The alert goes to `STAFF_NOTIFICATION_EMAIL` through Resend with the sender's address as Reply-To; nothing is emailed to the sender | (f) legitimate interest in replying to people who write to us (to confirm in the legal review) | As long as the tables exist; nothing deletes them and no period has been set. An alert record goes with its message. Resend's own logs and the staff inbox keep what their settings keep | "What the contact form collects", "Why we use your details", "How long we keep your details" |
| Rate-limit counts: a keyed one-way code (HMAC with `LEAD_IP_HASH_SECRET`) of the network address, per kind of request, with a hit count and a time window | Every signup, contact message, order request, order lookup and staff sign-in | Supabase, table `rate_limit_buckets`; never joined to a signup or an order | (f) keeping the website working and safe | The length of its window (10 minutes for signups and for each client's contact messages, an hour for order requests and for all contact messages together). `purge_expired_rate_limit_buckets()` deletes windows that ended over a day ago, once it is scheduled (below); until then the rows stay | "What we do not collect" |
| Visit statistics: page views and page leaves, the clicks and sections listed in [observability.md](observability.md#what-is-counted), each with the trimmed page address, referring site, campaign tags, browser, operating system, device type, screen size, language and time zone | The visitor's browser, and only after a "yes" (below) | PostHog, at `NEXT_PUBLIC_POSTHOG_HOST`. In cookieless server hash mode PostHog counts visitors with a hash of the network address and browser details and a daily salt; its documentation says the address is then stripped from the event before further processing ([observability.md](observability.md#what-is-counted)) | (a) consent: the consent notice | The PostHog project's own retention (below). No email address, no name, no cookie, no profile (`identify` is never called) and no identifier that lasts beyond a day; each event carries a per-day hash with the user agent, screen size, language and time zone, which is pseudonymous data (see the questions for the legal review below) | "Visit statistics" |
| Error reports: what failed and where, the page address without its query, the browser's user agent, the site's own short labels | The browser and the server, when `NEXT_PUBLIC_SENTRY_DSN` is set | Sentry. The scrubber (`lib/observability/sentry-config.ts`) removes the user, cookies, bodies, queries, email-shaped text and private order links; the site adds no network address | (f) keeping the website working | The Sentry project's own retention (below) | "Services that handle your details" |
| Spam check: Cloudflare Turnstile receives the visitor's network address, the browser's user-agent string, technical details of the connection (TLS), the address of the page and the site key. Nothing typed into a form is sent to it, and the site sends Cloudflare no visitor address when it checks the answer | Only once a person starts filling in a form (first focus or press inside it), and only while `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are both set | Cloudflare, in the frame it serves. The site stores and logs no token | (f) telling people from automated programs, to keep the forms working and safe | Cloudflare's own retention, described in its [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/); the widget's solve analytics are kept seven days in the dashboard | "Services that handle your details", "Cookies and what is kept on your device" (shown only while the check is on) |
| Page requests, including the network address | Every visit | Vercel, which hosts the site and runs its code; Sanity's image service for pictures from Sanity | (f) delivering the pages | Each provider's own log retention (below) | "Services that handle your details" |
| Order requests (only while commerce is switched on): name, email address, phone (optional), delivery address, notes, the order consent record, the products as described in the shop, the order's history, a hash of the tracking link, a staff quote and payment link | The order form (`/api/orders`; fields in `lib/orders/fields.ts`) | Supabase: `orders`, `order_items`, `order_events`, `order_email_outbox`; Resend for the order emails | (b) the step the person asked for before any sale | No period has been set; `orders.retain_until` exists but nothing sets or acts on it | "What an order request collects", "Why we use your details" |
| Staff accounts: the staff member's email address and password (held by Supabase Auth), their `staff_users` row and what they do to orders (`order_events`, actor `staff`) | The owner, when adding staff; the staff pages | Supabase Auth and Supabase | (f) running the order queue (to confirm in the legal review) | Until the owner removes the account | Not on the privacy page (staff are not visitors) |

- src: https://gdpr-info.eu/art-6-gdpr/ · GDPR Article 6(1)(a), (b), (f) · 2026-10-17

## Consent on the site

- **Visit statistics: the consent notice** (ruling R144, details in
  [observability.md](observability.md#consent-nobody-is-counted-until-they-say-yes)). With a PostHog
  key set, a visitor with no stored answer sees "Can we count your visit?" on their first visit, with
  two equal buttons, "Yes, count my visit" and "No, do not count me", and a link to the privacy page.
  Nothing is counted and no PostHog code is loaded until "Yes"; "No", or no answer, counts nothing.
  Statistics stay cookieless (ruling R145). A browser sending Global Privacy Control or Do Not Track
  is not asked and not counted unless the visitor turns statistics on in the footer (ruling R147).
  Withdrawing is as easy as giving: **Analytics choices** in the footer of every page turns
  statistics off, and they stop at once. The record of this consent is the visitor's
  stored answer on their own device; no server keeps a list of who said yes, since the statistics
  carry no email address, no name, no cookie and no identifier that lasts beyond a day. Whether a
  record kept only on the device is enough is one of the questions for the legal review below.
- **The signup consent record.** The consent box is required. Each signup stores `consent_state`
  (`granted`), `consent_version` (the version of the consent wording the person saw, the Studio's
  `consentCopyVersion`) and `consent_granted_at`. A withdrawal, made by staff on request, sets
  `consent_state = 'withdrawn'` and `consent_withdrawn_at`; a repeat submission of the same address
  never changes the consent record ([database-security.md](database-security.md#a-repeat-submission-never-changes-an-existing-record)).
- **The order consent record** (commerce only). The order form's consent box is required; each order
  stores `consent_version` (the Studio's `orderConsentCopyVersion`) and `consent_granted_at`.

- src: https://gdpr-info.eu/art-7-gdpr/ · GDPR Article 7(1) and 7(3): showing consent, and withdrawing it as easily as giving it · 2026-10-17
- src: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/ · ICO Age Appropriate Design Code, standards 7 (default settings) and 13 (nudge techniques) · 2026-10-17

## What is kept on the device

| Name | Kind | Set when | Holds | Removed | Why no consent is asked for it |
|---|---|---|---|---|---|
| `bibo.analytics.v1` | `localStorage` entry | The visitor answers the notice, or uses Analytics choices | `on` or `off` | When the visitor clears the site's data; where storage is blocked it lasts for the page only | It is needed to honour the visitor's own answer (ruling R145) |
| `orderpad.v1` (commerce only) | `localStorage` entry | The visitor adds a product to the order list | Which products and how many | When the order request is sent, or the site's data is cleared | It is the order list the visitor is building |
| Draft-mode cookie | Cookie (Next.js draft mode) | An editor opens a preview from the Studio (`/api/draft-mode/enable`) | Next.js's draft-mode marker | `/api/draft-mode/disable`, or when the browser drops it | Set only for editors who asked for a preview, never for visitors |
| Supabase session cookies | Cookies, httpOnly, Secure outside localhost, SameSite=Lax | A staff member signs in | The staff session | At sign-out | Set only for staff who signed in, never for visitors |

PostHog keeps nothing on the device (`persistence: "memory"`, `cookieless_mode: "always"`). There are
no advertising cookies and no analytics cookies. Whether each entry above is exempt from consent as
strictly necessary is the site's reading (ruling R145); the lawyer's review should confirm it (see
the questions for the legal review below).

## Before launch (owner)

None of these can be done in code. Until reviewed text is published in Sanity, the privacy page shows
the repository fallback text, marked as not yet reviewed, and `/api/readiness` reports
`legalReviewed: false`.

1. **Who the controller is.** Put the name, postal address and contact address of whoever decides
   what happens to this data in the Sanity privacy text (`legalSettings`), with the contact for data
   requests; the fallback text deliberately names none. If the controller is not established in the
   EU or the UK but offers the site to people there, a representative there may be required. This
   also settles which data-protection authority the controller answers to.
2. **Which laws apply.** The EU and UK GDPR may not be the only data-protection laws that apply.
   Check the data-protection law of the controller's own country, and any registration or fee it
   requires. This is a children's brand, so children may visit even though the form and the shop are
   for adults:
   - GDPR Article 8: where an online service relies on a child's consent, a child can give it alone
     only from 16 (a country may set a lower age, never below 13); below that age a parent must give
     or authorise it.
   - The ICO Children's Code applies in the UK to services likely to be accessed by children,
     standards 4 (transparency) and 7 (default settings) among them.
   - In the US, COPPA applies to websites directed to children under 13, and to any that knowingly
     collect personal information from them. The default PostHog host (`https://us.i.posthog.com`)
     is in the US.

   Ask the lawyer whether the consent notice, and the privacy page, should be addressed to a parent.
3. **Processor agreements** with every provider that handles the data for the site: Vercel,
   Supabase, Resend, PostHog, Sentry, Sanity and Cloudflare (Turnstile; its terms are the
   [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/)). Accept or sign each provider's data processing
   agreement under the brand's own account.
4. **Data regions.** Where EU or UK visitors are expected, choose and record where each provider
   keeps the data: PostHog's EU host (`NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`, chosen
   when the PostHog project is created), the Supabase project's region, and the Sentry organisation's
   data region. Once chosen, state them in the privacy text, with the safeguard for any transfer out
   of the EU or UK. Cloudflare Turnstile has no region to choose: it runs on Cloudflare's global network,
   so a visitor's request may be handled anywhere. Legal review of that transfer, and of the privacy text
   that names Cloudflare, is still owed.
5. **Sentry: "Prevent Storing of IP Addresses" on** (Project settings → Security & Privacy). The site
   adds no address to its reports; this setting makes sure Sentry stores none either, whatever an SDK
   sends.
6. **PostHog: "Cookieless server hash mode" on** (Project settings → Web analytics). Without it
   PostHog ignores every event the site sends.
7. **PostHog: "Discard client IP data" on as well** (Settings → Project → IP data capture
   configuration), and confirm that cookieless server hash mode stores no address. PostHog's
   documentation says that in cookieless mode the address is stripped from each event before its
   transformations run, and that the discard setting does not apply while that mode is on; it says
   nothing more about where the address goes. Turning the setting on as well costs nothing. Ask
   PostHog to confirm, for example alongside the processor agreement (item 3), that the address is
   not stored.
8. **The lawyer's review** of the privacy and terms text. Publish the reviewed text in Sanity with a
   version for each page; once both have one, `/api/readiness` reports `legalReviewed: true`, and the
   legal pages may be indexed in production.

   Questions for the legal review (each names the sentence it covers):
   - **The legal bases chosen.** Privacy page, "Why we use your details": consent for "keeping your
     signup and sending you these emails, while you are on the list" and for "counting your visit";
     "Our legitimate interest in keeping the website working and safe is the legal basis for the
     rate-limit counts and the error reports … and for the requests the servers receive"; with
     commerce on, "Handling your order request is the step you asked us to take before any sale".
     Also the staff row of the table above.
   - **The basis for contact messages** (ruling R206). Privacy page, "Why we use your details": "To
     read and answer a message you send through the contact form. The legal basis for keeping it is our
     legitimate interest in replying to people who write to us." (shown while the contact form is open).
     Is that the right basis for a message from someone who cannot prove who they are, and should the
     page say more about the staff inbox and Resend holding a copy of the alert?
   - **The basis for a withdrawn signup** (ruling R151, item 10). Privacy page, "How long we keep your
     details": "After you withdraw, we keep the record of your signup and of your withdrawal only so
     that we never email you again and can show that we respected your choice; the legal basis for
     that is our legitimate interest in respecting it."
   - **A consent record kept only on the device** (GDPR Article 7(1)). This document, "Consent on the
     site": "The record of this consent is the visitor's stored answer on their own device; no server
     keeps a list of who said yes".
   - **The daily hash.** Privacy page, "Visit statistics": "PostHog combines your network address and
     browser details with a value that changes every day", and "cannot recognise you on a later day".
     Each event carries that per-day hash with the user agent, screen size, language and time zone:
     pseudonymous data. Is it personal data, and does the page need to say more about it?
   - **Sentry in the browser** (ePrivacy Article 5(3), EDPB Guidelines 2/2023). Privacy page,
     "Services that handle your details": "Sentry receives error reports … your browser type". The
     browser SDK reads the browser's details on the visitor's device and sends the report, which
     arrives from the visitor's network address, under legitimate interest and without consent. Does
     that need consent, or is it strictly necessary?
   - **"We make no decisions about you by automated means."** Privacy page, "Why we use your
     details". The rate limits and the order form's spam trap refuse requests automatically; the
     site reads neither as a decision about a person under Article 22.
   - **The entries kept on the device.** This document, "What is kept on the device": is each one
     exempt from consent as strictly necessary?
9. **Retention.** Decide how long signups are kept (none is set; the code never deletes them),
   whether and how an erasure request is carried out (the code has no delete path, see below), how
   long contact messages are kept (none is set; the code never deletes them), how long orders are kept (`retain_until`), and check the retention of PostHog, Sentry, Vercel and
   Resend. State the periods in the privacy text. Schedule the rate-limit purge
   (`purge_expired_rate_limit_buckets()`, with pg_cron, as the comment in migration 0001 shows).
10. **Withdrawn signups** (ruling R151). Have the lawyer confirm the legal basis for keeping a
    withdrawn signup: a legitimate interest in respecting the withdrawal. Then decide whether a
    withdrawn row should be cut down to the email address and the timestamps. Today the code keeps
    the first name, age range, campaign tags, the page it was made on and the browser's language as
    well, and has no way to reduce them.
11. **The removal channel.** Email sending (Resend) or a contact address in the Studio
    (`siteSettings.contactEmail`). Without one the site stores no signups and the privacy page says
    joining is not open yet.
12. **A record of processing.** The table above is a starting point for the record of processing
    activities that the GDPR asks controllers to keep.

- src: https://gdpr-info.eu/art-8-gdpr/ · GDPR Article 8(1) (a child's consent: 16, or a lower national age not below 13) · 2026-10-17
- src: https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa · COPPA (sites directed to children under 13) · 2026-10-17
- src: https://posthog.com/docs/privacy/data-storage · PostHog "IP data capture configuration": "In cookieless mode, the IP is stripped before transformations run" · 2026-10-17
- src: https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-22023-technical-scope-art-53-eprivacy-directive_en · EDPB Guidelines 2/2023 on the technical scope of Art. 5(3) ePrivacy (final version 16 October 2024) · 2026-10-17
- src: https://gdpr-info.eu/art-27-gdpr/ · GDPR Article 27 (representatives of controllers not established in the Union) · 2026-10-17
- src: https://gdpr-info.eu/art-28-gdpr/ · GDPR Article 28 (processors) · 2026-10-17
- src: https://gdpr-info.eu/art-30-gdpr/ · GDPR Article 30 (records of processing activities) · 2026-10-17
- src: https://gdpr-info.eu/art-44-gdpr/ · GDPR Articles 44 to 49 (transfers outside the Union) · 2026-10-17

## Handling a request from a person

A person can ask to see their data, to have it corrected or deleted, to limit or object to its use,
for a copy they can take elsewhere, or to withdraw their consent (GDPR Articles 15 to 21 and 7(3)).
Answer **without undue delay and within one month** of receiving the request. Where requests are
complex or many, that can be extended by two further months, but the person must be told within the
first month, with the reason (Article 12(3)).

- **Check who is asking.** A request from the address on file is enough; a request from anyone else
  about that address is not: ask the person to write from the address itself
  ([incident-runbook.md](incident-runbook.md#removal-requests)). Never paste a result holding a
  person's email address into a chat, a ticket or a document.
- **Where the data is.** Supabase only, found by email address (stored trimmed and in lower case):
  `lead_submissions` and its `lead_delivery_events` (by `lead_id`); `contact_messages` and its
  `contact_message_deliveries` (by `message_id`), found by the address the person wrote from; while commerce is on, also
  `orders` and its `order_items`, `order_events` and `order_email_outbox` (by `order_id`). Copies of
  sent emails are in Resend's logs and, for staff alerts and order alerts, in the staff inbox.
  **PostHog and Sentry hold no email address, no name, no cookie and no identifier that lasts beyond
  a day**, so there is nothing to look a person up by there (for Sentry, once item 5 above is on).
  PostHog's events carry a per-day hash with the browser's user agent, screen size, language and
  time zone, and Sentry's reports carry the user agent: pseudonymous data, one of the questions for
  the legal review (item 8).
- **Access or a copy.** Read the rows in the Supabase SQL editor and send the person their own data
  in a common machine-readable form, for example:

  ```sql
  select to_jsonb(lead) from public.lead_submissions as lead where lead.email = lower(btrim('<address>'));
  ```

  Add the delivery records (`select to_jsonb(event) from public.lead_delivery_events as event where event.lead_id = '<lead id>';`)
  and, while commerce is on, the person's orders the same way.
- **Withdrawal.** For the email list, follow
- **Contact messages.** The form never proves that the sender owns the address, so check who is asking
  as above. Then read the person's messages with
  `select to_jsonb(message) from public.contact_messages as message where message.email = lower(btrim('<address>'));`
  and, if they ask for them to be deleted and you decide to,
  `delete from public.contact_messages as message where message.email = lower(btrim('<address>'));`.
  Their delivery rows cascade, so an alert that was still waiting is never sent. Resend's logs and the
  staff inbox keep their copies of the alert, per their settings.
  [incident-runbook.md](incident-runbook.md#removal-requests): the lead is marked withdrawn, and no
  email is sent to it again. For visit statistics there is nothing to do on the server: the visitor
  turns them off in Analytics choices, and the events already counted carry nothing to find them by
  (no email address, no name, no cookie and no identifier that lasts beyond a day).
- **Correction.** The form never changes an existing record, so a correction is a staff `update` on
  that one row in the SQL editor, after the same check of who is asking. Never change the consent
  columns except to record a withdrawal.
- **Deletion.** The code has no delete path, and the runbook treats erasing a row as the owner's
  decision, taken with a lawyer. Deleting a lead also deletes its delivery records (they cascade), and
  lets the same address sign up again as a new person. Article 17 sets out when a person has the
  right to have their data erased (for example after withdrawing the consent it rested on); decide
  before launch how these requests are answered (item 9 above).
- **A complaint.** A person may complain to their data-protection authority (Article 77); the privacy
  page tells them so.

**A breach.** If personal data leaks or is lost, contain it first with
[incident-runbook.md](incident-runbook.md): [secret rotation](incident-runbook.md#secret-rotation),
[switching commerce off now](incident-runbook.md#switching-commerce-off-now) and
[rollback](incident-runbook.md#rollback). Then notify the controller's data-protection authority
without undue delay and, where feasible, within 72 hours of becoming aware of it, unless the breach
is unlikely to put people at risk (Article 33); where the risk to people is high, tell them too
(Article 34). Keep a record of every breach and what was done.

- src: https://gdpr-info.eu/art-12-gdpr/ · GDPR Article 12(3) (one month, extendable by two months) · 2026-10-17
- src: https://gdpr-info.eu/art-15-gdpr/ · GDPR Articles 15 to 21 (access, rectification, erasure, restriction, portability, objection) · 2026-10-17
- src: https://gdpr-info.eu/art-17-gdpr/ · GDPR Article 17 (erasure) · 2026-10-17
- src: https://gdpr-info.eu/art-33-gdpr/ · GDPR Articles 33 and 34 (breach notification) · 2026-10-17
- src: https://gdpr-info.eu/art-77-gdpr/ · GDPR Article 77 (complaint to a supervisory authority) · 2026-10-17
