import { isCommerceEnabled } from "../commerce/gate";
import { removalChannelFrom, type RemovalChannel } from "../leads/removal-channel";
import { removalPhrase } from "./removal-copy";
import type { PortableContent, SiteSettings } from "./types";

/*
 * Repository fallback legal text (Task 9 ruling R30). Served on /privacy and /terms only while
 * Sanity `legalSettings` has no text of its own; those pages are then noindex, left out of the
 * sitemap, and /api/readiness reports `legalReviewed: false`.
 *
 * Rules for this text: it describes only what the code does today (Task 5 lead capture: the form
 * fields in lib/leads/fields.ts, the columns in supabase/migrations/0001_leads_and_security.sql, the
 * emails in lib/email/lead-emails.ts). It names no company, address, registration, jurisdiction or
 * contact email; /privacy adds the contact address from site settings when one is configured.
 *
 * Update it whenever behaviour changes. Visit statistics (lib/analytics) are described below: opt-in
 * since ruling R144, which overrode R70's "on unless turned off". Nothing is counted until the visitor
 * says yes in the consent notice (components/analytics/ConsentNotice.tsx); the answer is the one thing
 * kept on the device (R145, lib/analytics/preference.ts); a Global Privacy Control or Do Not Track
 * browser is not asked and not counted (R147). Error reports are described too (Task 10M-a,
 * lib/observability).
 *
 * Ruling R149 adds the legal basis of each use, the visitor's rights (withdrawal and a complaint
 * included), that no decision is automated, and Vercel as the host. Ruling R151: consent is the
 * basis only while a person is on the list; the record kept after a withdrawal rests on a legitimate
 * interest in respecting it. A sentence is allowed only if the
 * code does it today or it states a right or duty that data-protection law gives whatever the code
 * does. The controller's identity, data regions and processor agreements are the owner's to state
 * (docs/data-protection.md), so this text names none of them.
 *
 * Commerce (Task 7b): the text follows the CMS commerce switch (`legalFallbackFor`). Off, the
 * default, nothing is sold here and the text says so. On, those lines are replaced by what an order
 * request stores (supabase/migrations/0002_orders.sql to 0007: the order, its products, its history
 * and its email records; the order fields in lib/orders/fields.ts) and how payment works: a quote and
 * a payment link sent later by email, never card details. No retention period is stated: none is
 * set (`orders.retain_until` is inert). tests/content/legal-pages.test.tsx asserts every claim.
 *
 * Contact form (R196, R206): while the form is open (`contactFormOpen()`, passed in by the page so
 * this file never reaches the server-only availability check) the text also says what a message
 * stores (supabase/migrations/0008_contact_messages.sql: `contact_messages`, with its delivery
 * records in `contact_message_deliveries`; the fields in lib/contact/fields.ts), that the team
 * receives it by email with the sender's address to reply to and that the sender is never emailed
 * (lib/email/contact-emails.ts), how it is rate limited (lib/contact/submit.ts), the
 * legitimate-interest basis and, as for orders, no retention period. Closed, the text is exactly
 * what it was.
 *
 * Bot check (R222, C7): while the check is on (`botCheckConfig(process.env).state === "on"`, passed in
 * by the page as `botCheck` so this file never reads the environment), the text also names
 * Cloudflare Turnstile as a service (what it receives, that it loads only once a form is started,
 * that this website sends it nothing typed, the addendum link), adds the spam check to the legitimate
 * interest in keeping the website working and safe, and says the website sets no cookie for it
 * (components/forms/bot-check loads Cloudflare's script and frame only on the first interaction
 * with a form; lib/bot-check/turnstile.ts sends Cloudflare no visitor address). It claims nothing
 * about what Cloudflare stores inside its own frame beyond the addendum. Off, the text is exactly
 * what it was.
 *
 * Kept outside lib/content/fallback.ts so SAFE_FALLBACK_LEGAL (the content contract's empty
 * default, which tells pages that Sanity has no text) stays unchanged.
 */

let key = 0;
const nextKey = () => `legal-fallback-${(key += 1)}`;
const heading = (text: string): PortableContent[number] => ({ _type: "block", _key: nextKey(), style: "h2", children: [{ _type: "span", _key: nextKey(), text }] });
const paragraph = (text: string): PortableContent[number] => ({ _type: "block", _key: nextKey(), style: "normal", children: [{ _type: "span", _key: nextKey(), text }] });
/** Blocks that appear only while commerce is on. */
const whenSelling = (commerce: boolean, ...blocks: Array<() => PortableContent[number]>): PortableContent => (commerce ? blocks.map((block) => block()) : []);

/** Blocks that appear only while the contact form is open (R196). */
const whenContactOpen = whenSelling;

/** Blocks that appear only while the bot check is on (R222). */
const whenBotCheckOn = whenSelling;

/** What the database stores, for the sentence naming Supabase. */
function storedKinds(commerce: boolean, contact: boolean): string {
  const kinds = ["signups", ...(commerce ? ["order requests"] : []), ...(contact ? ["contact messages"] : [])];
  return kinds.length === 1 ? kinds[0]! : `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}`;
}

function privacyText(commerce: boolean, channel: RemovalChannel, contact: boolean, botCheck: boolean): PortableContent {
  return [
    paragraph(
      "BIBO Bay is a story world in development. This page explains what happens to the details you share through this website, in plain words.",
    ),
    heading("What the founding-family form collects"),
    paragraph("The form is for adults. When you join the founding-family list, the website stores:"),
    paragraph("Your email address, which is required."),
    paragraph("Your first name, if you choose to give it."),
    paragraph(
      "A broad age range for your child (under 3, 3 to 5, 6 to 8, 9 to 12, or prefer not to say), if you choose to give it.",
    ),
    paragraph(
      "Your consent: that you ticked the consent box, the version of the wording you agreed to, and when you agreed.",
    ),
    paragraph(
      "Where the signup came from: the page it was made on, your browser's language setting, and any campaign tags (utm_source, utm_medium, utm_campaign, utm_term, utm_content) in the address of the page you arrived on.",
    ),
    paragraph("When you signed up, and when the same email address was submitted again."),
    ...whenSelling(
      commerce,
      () => heading("What an order request collects"),
      () => paragraph("The order form is for adults. When you send an order request, the website stores:"),
      () => paragraph("Your name and email address, which are required, and a phone number if you choose to give one."),
      () => paragraph("The delivery address: the street address, city and country, which are required, and a second address line, region and postal code if you give them."),
      () => paragraph("Any notes you add to the order."),
      () => paragraph("Your consent: that you ticked the consent box, the version of the wording you agreed to, and when you agreed."),
      () => paragraph("The products you asked for and how many of each, as each product was described in the shop when you sent the request: the shop's own reference for it, its name, and its product code, variant and pack where it has them."),
      () => paragraph("The order's reference, its status and when the status last changed, and when you sent the request."),
      () => paragraph("A record of what has happened to the order, such as your sending it, each change of its status, each quote the team saves or queues for email, and any replacement of its tracking link, and who did it: you, the BIBO Bay team or the website itself."),
      () => paragraph("A one-way code (a hash) made from the order's private tracking link, and when that link stops working. The link itself is not stored, so it cannot be read back from the database. The team can replace the link with a new one, and the old one then stops working."),
      () => paragraph("When the team replies with a quote: the currency, the amounts quoted, the payment link they send you and when they sent it."),
      () => paragraph("Before you send it, your order list stays in this browser's storage on your device, holding only which products you added and how many. It reaches us only as part of an order request."),
    ),
    ...whenContactOpen(
      contact,
      () => heading("What the contact form collects"),
      () => paragraph("The contact form is for adults. When you send a message, the website stores your name, your email address, the topic you chose, your message and when you sent it. Please do not include details about a child."),
      () => paragraph("The BIBO Bay team receives your message by email, with your email address as the address to reply to, so they can answer you. The website does not email you when you send a message."),
    ),
    heading("What we do not collect"),
    paragraph(
      "We do not ask for your child's name, birthday, photo, school or any other detail about a child. The age range is broad and you can skip it.",
    ),
    commerce
      ? paragraph("We never ask for payment card or bank details, and no payment is taken on this website. If the team can fulfil your order request, they email you a quote and a link to pay.")
      : paragraph("We never ask for payment card details. Nothing is sold on this website."),
    commerce
      ? paragraph(
          "Your IP address is not stored with your signup or your order. To stop the forms being flooded, the website keeps a rate-limit count of signup attempts, in 10-minute windows, against a one-way, keyed code made from your network address. Order requests and order lookups are counted the same way (order requests by the hour, lookups in 10-minute windows). Those counts are not linked to your signup or your order and are used only to enforce the limits.",
        )
      : paragraph(
          "Your IP address is not stored with your signup. To stop the form being flooded, the website keeps a rate-limit count of signup attempts, in 10-minute windows, against a one-way, keyed code made from your network address. That count is not linked to your signup and is used only to enforce the limit.",
        ),
    ...whenContactOpen(contact, () =>
      paragraph("Messages sent through the contact form are counted the same way: against the keyed code in 10-minute windows, and all messages together by the hour. Those counts are not linked to your message."),
    ),
    heading("Visit statistics"),
    paragraph(
      "When this website is set up to count visits, a notice titled \"Can we count your visit?\" asks on your first visit whether BIBO Bay may count yours. Visits are counted with PostHog, to learn which pages, videos and activities families use and how they find BIBO Bay, and only if you say yes. Until you answer, and if you say no, nothing is counted and nothing is sent to PostHog.",
    ),
    paragraph(
      "Once you say yes, each page view and each button or link you choose is sent with: the page address (without anything after a question mark except campaign tags), the site or campaign that sent you, your browser, operating system, device type and screen size, your browser's language and time zone, which parts of the page you reach, and how far down each page you scroll and how long you stay. To count visitors without cookies, PostHog combines your network address and browser details with a value that changes every day, then removes the address from the event before it is processed further, so the address is not stored with the statistics.",
    ),
    paragraph(
      "Counting uses no cookies; the only thing kept on your device for it is your answer to the notice, as described below. It builds no profile of you and cannot recognise you on a later day. It never records what you type into the form; it notes only that a signup was saved.",
    ),
    paragraph(
      "A browser that sends Global Privacy Control or Do Not Track is not shown the notice and is not counted, unless you turn statistics on under Analytics choices. You can change your answer at any time under Analytics choices at the foot of every page; saying no stops the counting at once.",
    ),
    ...whenSelling(commerce, () =>
      paragraph("The private code in your order's tracking link is never sent to the statistics or the error reports described here: they record the page as /orders/[token] instead."),
    ),
    heading("Cookies and what is kept on your device"),
    paragraph(
      "This website does not use advertising or analytics cookies. It sets two kinds of cookie, neither for visitors: a preview cookie used by the people who edit the website, and session cookies set only when BIBO Bay staff sign in to manage orders. The staff session cookies are httpOnly, so page scripts cannot read them, and they are removed when staff sign out.",
    ),
    paragraph(
      "Your answer to the notice is kept as one entry in this browser's storage on your device, so you are not asked again; a change you make under Analytics choices replaces it. It holds only yes or no, and it stays until you clear this website's data. If your browser blocks that storage, your answer lasts only until this page is reloaded or closed.",
    ),
    ...whenSelling(commerce, () => paragraph("The order list described above is kept in this browser's storage as well.")),
    ...whenBotCheckOn(botCheck, () => paragraph("Cloudflare's script draws the spam check inside a frame it serves; this website sets no cookie for it.")),
    heading("Why we use your details"),
    paragraph(
      "To send you updates about BIBO Bay, which is what you agree to when you join, and to send you the download link for the free activity pack. Once email sending is set up, you receive one email confirming that you joined, and the BIBO Bay team may receive a short note with your email address, first name and age range so they know someone signed up.",
    ),
    paragraph(
      "The legal basis for keeping your signup and sending you these emails, while you are on the list, is your consent, which you give by ticking the consent box when you join. The legal basis for counting your visit is also your consent, which you give by saying yes in the notice, or by turning statistics on under Analytics choices. You can withdraw your consent at any time, as this page explains.",
    ),
    ...whenSelling(
      commerce,
      () =>
        paragraph(
          "To handle your order request: to check availability, reply with a quote and a payment link, arrange delivery, and show you the order's progress where tracking is offered. Once email sending for orders is set up, you receive an email acknowledging your request, without prices, and the BIBO Bay team is told that a request arrived, in a note that carries the order's reference, your name and email address and the products you asked for, but not your delivery address.",
        ),
      () => paragraph("Handling your order request is the step you asked us to take before any sale, and that request is its legal basis."),
    ),
    ...whenContactOpen(contact, () =>
      paragraph("To read and answer a message you send through the contact form. The legal basis for keeping it is our legitimate interest in replying to people who write to us."),
    ),
    paragraph(
      botCheck
        ? "Our legitimate interest in keeping the website working and safe, which includes checking that forms are sent by people and not by automated programs, is the legal basis for the rate-limit counts, the spam check and the error reports described on this page, and for the requests the servers receive in order to send pages back."
        : "Our legitimate interest in keeping the website working and safe is the legal basis for the rate-limit counts and the error reports described on this page, and for the requests the servers receive in order to send pages back.",
    ),
    paragraph("We make no decisions about you by automated means."),
    paragraph("We do not sell your details or share them with advertisers."),
    heading("Services that handle your details"),
    paragraph("Vercel hosts the website and runs the code that serves these pages."),
    paragraph(`Supabase hosts the database where ${storedKinds(commerce, contact)} are stored.`),
    paragraph("Resend delivers the emails described above."),
    paragraph("PostHog receives the visit statistics described above, and only if you say yes to counting your visit."),
    paragraph(
      "Sentry receives error reports, only when error reporting is switched on for this website: what went wrong and where in the code, the page address without anything after a question mark, your browser type, and the website's own short labels for the problem. Error reports carry no form details and no cookies, and the website does not add your network address to them.",
    ),
    ...whenBotCheckOn(botCheck, () =>
      paragraph(
        "Cloudflare Turnstile checks that a form is sent by a person and not by an automated program. It loads only once you start filling in a form. Cloudflare then receives information about your browser and its connection, such as your network address, your browser's user-agent string, technical details of the connection, the address of the page and this website's Turnstile key. This website sends Cloudflare nothing you type into the form. Cloudflare describes how it handles this information, including its own use of it to improve Turnstile, in its Turnstile Privacy Addendum: https://www.cloudflare.com/turnstile-privacy-policy/",
      ),
    ),
    paragraph(
      "For each email, the database keeps a delivery record: which email it was, whether it was sent, how many attempts were made and when, the email service's message reference, and a short error code if sending failed. It does not keep a copy of the email.",
    ),
    paragraph(
      "Sanity hosts the website's text and pictures. When a page shows a picture from Sanity, your browser loads it from Sanity's image service. No form details are sent to Sanity.",
    ),
    paragraph(
      "Like any website, the servers that deliver these pages receive your browser's requests, including its network address, in order to send the pages back.",
    ),
    heading("How long we keep your details"),
    paragraph(
      "We keep your signup, and its delivery records, for as long as the list exists; nothing deletes it automatically. When you ask to be removed, a member of the BIBO Bay team marks your signup as withdrawn: it is no longer used to email you, and the record that you withdrew, and when, is kept so we can respect your choice. The website does not delete the signup itself. If the same email address is submitted again after you withdrew, the website only notes the date; it does not sign you up again.",
    ),
    paragraph(
      "After you withdraw, we keep the record of your signup, its email delivery records and the record of your withdrawal only so that we never email you again and can show that we respected your choice; the legal basis for that is our legitimate interest in respecting it.",
    ),
    ...whenSelling(commerce, () =>
      paragraph("Order requests are kept too, with their products, their history and their email delivery records; nothing deletes them automatically, and no period for keeping them has been set."),
    ),
    ...whenContactOpen(contact, () =>
      paragraph("Contact messages are kept too, with their email delivery records; nothing deletes them automatically, and no period for keeping them has been set."),
    ),
    heading("Your rights"),
    paragraph(
      "Under data-protection law you can ask to see the details we hold about you, to have them corrected or deleted, to limit or object to how we use them, and to receive them in a form you can take elsewhere. You can withdraw your consent at any time, and this does not affect what was done before you withdrew it. You can also complain to the data-protection authority where you live.",
    ),
    paragraph(removalRequest(channel)),
  ];
}

function termsText(commerce: boolean, channel: RemovalChannel): PortableContent {
  return [
    paragraph(
      "BIBO Bay is a story world in development. These terms cover using this website while it is being built.",
    ),
    heading("What this website is"),
    paragraph(
      "The characters, story ideas and other material shown here are concepts. They may change, and some may never be made. Nothing on this website promises a show, a product or a date.",
    ),
    ...(commerce
      ? [
          heading("Order requests"),
          paragraph("You can ask for products from the shop by sending an order request. Sending one does not buy anything and charges nothing: no prices are shown and no payment is taken on this website."),
          paragraph("The BIBO Bay team checks availability and replies by email with a quote and a payment link. If you want to go ahead, you pay through that link."),
          paragraph("Only adults may send an order request, using their own contact details."),
        ]
      : [paragraph("Nothing is for sale on this website at the moment.")]),
    heading("The founding-family list"),
    paragraph(
      `Joining the list means BIBO Bay may email you updates about the story world. Only adults may join, and only with their own email address.${termsRemoval(channel)}`,
    ),
    heading("Using the website"),
    paragraph(
      "Please use the website only for its purpose. Do not try to break it, overload it, or submit someone else's details.",
    ),
    paragraph(
      "The BIBO Bay name, characters, artwork and words on this website are not licensed for reuse. Please ask before copying them. The free activity pack may be printed for use at home.",
    ),
    paragraph(
      "The website is offered as it is while it is being built. Pages and features may change, move or be unavailable at times.",
    ),
    heading("Changes to these terms"),
    paragraph("When these terms change, the new version will be published on this page."),
  ];
}

type LegalFallback = { privacy: PortableContent; terms: PortableContent };

/** The text while commerce is off (the default): nothing is sold on this website. */
export const LEGAL_FALLBACK: LegalFallback = Object.freeze({ privacy: privacyText(false, null, false, false), terms: termsText(false, null) });

/** The text while commerce is on: what an order request stores, and how payment works. */
export const LEGAL_FALLBACK_WITH_COMMERCE: LegalFallback = Object.freeze({ privacy: privacyText(true, null, false, false), terms: termsText(true, null) });

/**
 * The fallback text for the site's commerce switch and removal channel (Ruling R125). Only a
 * literal `true` counts as commerce on. With no removal channel (no email sending, no contact
 * address) the text is the frozen no-channel text and promises nothing; otherwise the removal
 * sentences name the channel that exists. `contactOpen` (the page's `contactFormOpen()`, R196) adds
 * what the contact form stores and `botCheck` (the bot check is on, R222) names Cloudflare Turnstile; both are false by default, so the frozen texts stay as they were.
 * `env` is injectable for tests.
 */
export function legalFallbackFor(
  settings: Partial<Pick<SiteSettings, "commerceEnabled" | "contactEmail">>,
  env: Readonly<Record<string, string | undefined>> = process.env,
  contactOpen = false,
  botCheck = false,
): LegalFallback {
  const commerce = isCommerceEnabled(settings);
  const channel = removalChannelFrom(settings, env);
  if (channel === null && !contactOpen && !botCheck) return commerce ? LEGAL_FALLBACK_WITH_COMMERCE : LEGAL_FALLBACK;
  return { privacy: privacyText(commerce, channel, contactOpen, botCheck), terms: termsText(commerce, channel) };
}

/** The privacy page's removal paragraph; with no channel it says signups are not open, and promises nothing. */
function removalRequest(channel: RemovalChannel): string {
  if (channel === null) return "Joining the list is not open yet, so there is nothing to remove. When it opens, this page will say how to ask for removal or for a copy of your details.";
  const how = channel.kind === "email" ? "Reply to the acknowledgement email you receive when you join" : `Write to ${channel.email}`;
  return `${how} and tell us what you would like: to be removed from the list, to have your details deleted, or to see the details we hold about you.`;
}

/** The terms' removal sentence (with its leading space), or nothing when no channel exists. */
function termsRemoval(channel: RemovalChannel): string {
  const phrase = removalPhrase(channel);
  return phrase ? ` You can ask to be removed at any time ${phrase}.` : "";
}
