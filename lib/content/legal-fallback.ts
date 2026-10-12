import type { PortableContent } from "./types";

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
 * Update it whenever behaviour changes. Known follow-ups: Task 10M (analytics after consent, error
 * monitoring) must add those processors and the consent cookie; Task 7 (manual orders) must update
 * the "nothing is for sale" lines before commerce is switched on.
 *
 * Kept outside lib/content/fallback.ts so SAFE_FALLBACK_LEGAL (the content contract's empty
 * default, which tells pages that Sanity has no text) stays unchanged.
 */

let key = 0;
const nextKey = () => `legal-fallback-${(key += 1)}`;
const heading = (text: string): PortableContent[number] => ({ _type: "block", _key: nextKey(), style: "h2", children: [{ _type: "span", _key: nextKey(), text }] });
const paragraph = (text: string): PortableContent[number] => ({ _type: "block", _key: nextKey(), style: "normal", children: [{ _type: "span", _key: nextKey(), text }] });

const privacy: PortableContent = [
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
  heading("What we do not collect"),
  paragraph(
    "We do not ask for your child's name, birthday, photo, school or any other detail about a child. The age range is broad and you can skip it.",
  ),
  paragraph("We never ask for payment card details. Nothing is sold on this website."),
  paragraph(
    "Your IP address is not stored with your signup. To stop the form being flooded, the website keeps a rate-limit count of signup attempts, in 10-minute windows, against a one-way, keyed code made from your network address. That count is not linked to your signup and is used only to enforce the limit.",
  ),
  paragraph(
    "This website does not use advertising or analytics cookies. The only cookie it sets is a preview cookie used by the people who edit the website.",
  ),
  heading("Why we use your details"),
  paragraph(
    "To send you updates about BIBO Bay, which is what you agree to when you join. Once email sending is set up, you receive one email confirming that you joined, and the BIBO Bay team may receive a short note with your email address, first name and age range so they know someone signed up.",
  ),
  paragraph("We do not sell your details or share them with advertisers."),
  heading("Services that handle your details"),
  paragraph("Supabase hosts the database where signups are stored."),
  paragraph("Resend delivers the emails described above."),
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
  heading("How to ask for removal or a copy"),
  paragraph(
    "Reply to any BIBO Bay email and tell us what you would like: to be removed from the list, or to see the details we hold about you.",
  ),
];

const terms: PortableContent = [
  paragraph(
    "BIBO Bay is a story world in development. These terms cover using this website while it is being built.",
  ),
  heading("What this website is"),
  paragraph(
    "The characters, story ideas and other material shown here are concepts. They may change, and some may never be made. Nothing on this website promises a show, a product, a download or a date.",
  ),
  paragraph("Nothing is for sale on this website at the moment."),
  heading("The founding-family list"),
  paragraph(
    "Joining the list means BIBO Bay may email you updates about the story world. Only adults may join, and only with their own email address. You can ask to be removed at any time by replying to any BIBO Bay email.",
  ),
  heading("Using the website"),
  paragraph(
    "Please use the website only for its purpose. Do not try to break it, overload it, or submit someone else's details.",
  ),
  paragraph(
    "The BIBO Bay name, characters, artwork and words on this website are not licensed for reuse. Please ask before copying them.",
  ),
  paragraph(
    "The website is offered as it is while it is being built. Pages and features may change, move or be unavailable at times.",
  ),
  heading("Changes to these terms"),
  paragraph("When these terms change, the new version will be published on this page."),
];

export const LEGAL_FALLBACK: { privacy: PortableContent; terms: PortableContent } = Object.freeze({ privacy, terms });
