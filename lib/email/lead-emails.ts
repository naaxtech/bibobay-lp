import { FORM_COPY } from "@/components/forms/form-copy";
import type { AgeBand } from "@/lib/leads/fields";

/**
 * Founding-family emails (ruling R28): plain, escaped HTML plus a text part, with no React Email
 * dependency. Every submitted value is escaped before it enters HTML.
 *
 * Truth and privacy rules: the acknowledgement says only that the adult is on the list. It offers a
 * file only when the CMS marks a real https file available, explains removal by reply (there is no
 * unsubscribe link yet, so none is invented), and carries no child data, address, phone number,
 * staff name or claim. The staff alert may name the adult and the broad age band, since staff need
 * them, but its subject stays generic so no personal data sits in inbox previews and logs.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface LeadMagnetLink {
  title: string;
  fileUrl: string;
  /** Set for a signed link, whose lifetime the site controls; an https file has none to state. */
  expiresInDays?: number;
}

const BRAND = "BIBO Bay";
const NAVY = "#283b63";
const NAVY_SOFT = "#4a5878";
const CREAM = "#fffbf8";
const TEAL_INK = "#0c6b68";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A credential-free https URL, or null. Also used by the order emails (lib/email/order-emails.ts). */
export function safeHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Table-free, inline-styled shell: email clients ignore the site's stylesheet. Shared with the order emails. */
export function shell(bodyHtml: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:${CREAM};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${NAVY}">
<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:28px;border-radius:20px">
<p style="margin:0 0 20px;font-size:18px;font-weight:700;letter-spacing:.04em;color:${TEAL_INK}">${BRAND}</p>
${bodyHtml}
<p style="margin:28px 0 0;font-size:14px;color:${NAVY_SOFT}">${BRAND}</p>
</div></body></html>`;
}

export const paragraph = (html: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6">${html}</p>`;

/** The muted colour of the closing lines, for the order emails' small print. */
export const EMAIL_MUTED = NAVY_SOFT;
/** The link colour. */
export const EMAIL_LINK = TEAL_INK;

export function buildLeadAcknowledgement({ firstName, leadMagnet }: { firstName?: string | null; leadMagnet?: LeadMagnetLink | null }): RenderedEmail {
  const name = firstName?.trim();
  const greeting = name ? `Hi ${name},` : "Hello,";
  const fileUrl = leadMagnet ? safeHttpsUrl(leadMagnet.fileUrl) : null;
  const leadIn = leadMagnet?.expiresInDays ? `Here is your free download; the link works for ${leadMagnet.expiresInDays} days:` : "Here is your free download:";
  const fileTitle = leadMagnet?.title.trim() || "Your BIBO Bay file";

  const lines = [
    greeting,
    "",
    `Thank you for joining the ${BRAND} founding-family list. You're on it, and we will write when there is news about ${BRAND}.`,
    ...(fileUrl ? ["", leadIn, `${fileTitle}: ${fileUrl}`] : []),
    "",
    "If you would rather not hear from us, reply to this email and we will remove you from the list.",
    "",
    BRAND,
  ];

  const html = shell([
    paragraph(escapeHtml(greeting)),
    paragraph(`Thank you for joining the ${BRAND} founding-family list. You&#39;re on it, and we will write when there is news about ${BRAND}.`),
    fileUrl
      ? paragraph(`${escapeHtml(leadIn)} <a href="${escapeHtml(fileUrl)}" style="color:${TEAL_INK};font-weight:600">${escapeHtml(fileTitle)}</a>`)
      : "",
    `<p style="margin:0;font-size:14px;line-height:1.6;color:${NAVY_SOFT}">If you would rather not hear from us, reply to this email and we will remove you from the list.</p>`,
  ].join("\n"));

  return { subject: `You're on the ${BRAND} founding-family list`, html, text: lines.join("\n") };
}

export interface StaffLeadSummary {
  /** The address as submitted. Nothing on the form proves the submitter owns it. */
  email: string;
  firstName?: string | null;
  ageBand?: AgeBand | null;
  source: string;
  /** False when the address was already listed; ruling R38 means nothing on that record changed. */
  created: boolean;
  /**
   * Task 8a: a retry by the outbox worker. Unused since Task 8a review M2 (no caller passes it): a
   * retry must send the same body as the first attempt, or the provider refuses the reused
   * idempotency key. Kept, as the owner never deletes code; use it only for a message that is never
   * a retry of an earlier send under the same key.
   */
  fromOutbox?: boolean;
}

/**
 * The alert names what was submitted, not what is on file: for an address already on the list the
 * stored record is unchanged (ruling R38) and the submitted details may differ from it. The address
 * is labelled unverified and is never set as the reply-to (review M3): replying would write to
 * whoever owns the typed address, which may not be the person who submitted the form.
 */
export function buildStaffLeadAlert(lead: StaffLeadSummary): RenderedEmail {
  const rows: Array<[string, string]> = [
    ["Submitted address (unverified)", lead.email],
    ["First name", lead.firstName?.trim() || "Not given"],
    ["Age range", lead.ageBand ? FORM_COPY.ageBands[lead.ageBand] : "Not given"],
    ["Source", lead.source],
  ];
  const intro = lead.fromOutbox
    ? "This alert could not be sent when the address was submitted, so it was sent later. The details below are the signup on file."
    : lead.created
      ? "A new signup joined the founding-family list."
      : "An address already on the founding-family list was submitted again. Nothing on the existing record was changed; the details below are what this submission contained.";
  const width = Math.max(...rows.map(([label]) => label.length));
  const text = [intro, "", ...rows.map(([label, value]) => `${label.padEnd(width)} ${value}`), "", "Consent was given on the signup form."].join("\n");
  const html = shell([
    paragraph(escapeHtml(intro)),
    `<dl style="margin:0 0 16px;font-size:15px;line-height:1.6">${rows
      .map(([label, value]) => `<dt style="font-weight:700">${escapeHtml(label)}</dt><dd style="margin:0 0 8px">${escapeHtml(value)}</dd>`)
      .join("")}</dl>`,
    paragraph("Consent was given on the signup form."),
  ].join("\n"));
  return { subject: `New ${BRAND} founding-family signup`, html, text };
}
