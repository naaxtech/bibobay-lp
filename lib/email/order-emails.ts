import { ORDER_EMAIL_COPY } from "./order-email-copy";
import { EMAIL_LINK, EMAIL_MUTED, escapeHtml, paragraph, safeHttpsUrl, shell, type RenderedEmail } from "./lead-emails";

/**
 * Order emails (Task 8a; spec §10 steps 7 and 9, §12; rulings R89-R90): the buyer
 * acknowledgement, the staff order alert and the quote. Plain escaped HTML plus a text part in the
 * signup emails' shell (lib/email/lead-emails.ts), with every visible string from
 * ORDER_EMAIL_COPY. Every value from an order is escaped before it enters HTML.
 *
 * The outbox claim (migration 0006) hands these builders only what they need: the reference, the
 * contact name and email, the lines (title, variant, pack, quantity) and, for a quote, its figures.
 * No address, phone, notes, SKU or token ever reaches an email.
 */
export interface OrderEmailLine {
  title: string;
  variant: string | null;
  pack: string | null;
  quantity: number;
}

export interface OrderEmailQuote {
  /** ISO 4217 code, e.g. AUD. */
  currency: string;
  subtotalMinor: number;
  freightMinor: number;
  paymentUrl: string;
}

const COPY = ORDER_EMAIL_COPY;

function lineText(line: OrderEmailLine): string {
  const details = [line.variant, line.pack].filter((value): value is string => typeof value === "string" && value.trim() !== "");
  return COPY.line(line.quantity, line.title, details);
}

const lineList = (lines: readonly OrderEmailLine[]) =>
  `<ul style="margin:0 0 16px;padding-left:20px;font-size:16px;line-height:1.6">${lines.map((line) => `<li>${escapeHtml(lineText(line))}</li>`).join("")}</ul>`;

const textList = (lines: readonly OrderEmailLine[]) => lines.map((line) => `- ${lineText(line)}`);

const small = (html: string) => `<p style="margin:0;font-size:14px;line-height:1.6;color:${EMAIL_MUTED}">${html}</p>`;

const link = (url: string, label: string) => `<a href="${escapeHtml(url)}" style="color:${EMAIL_LINK};font-weight:600">${escapeHtml(label)}</a>`;

/**
 * An amount in minor units (cents) in the currency's own minor unit, with the ISO code so AUD and
 * USD can never be confused, e.g. "AUD 123.45" or "JPY 1,500". Null for anything that is not a
 * whole, non-negative, exactly representable amount in a valid code.
 */
export function formatMinorUnits(amountMinor: number, currency: string): string | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    const format = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    // Built as a decimal string, so no float rounding can change the amount.
    const whole = String(amountMinor).padStart(digits + 1, "0");
    const decimal = digits > 0 ? `${whole.slice(0, -digits)}.${whole.slice(-digits)}` : whole;
    return format.format(decimal as unknown as number);
  } catch {
    return null;
  }
}

export function buildOrderAcknowledgement({
  reference,
  contactName,
  lines,
  tracking,
}: {
  reference: string;
  contactName: string;
  lines: readonly OrderEmailLine[];
  /** Null while order tracking is switched off. `url` is the /track page, or null when the site's address is not verified. */
  tracking: { url: string | null } | null;
}): RenderedEmail {
  const copy = COPY.acknowledgement;
  const greeting = COPY.greeting(contactName.trim());
  const trackUrl = tracking?.url ? safeHttpsUrl(tracking.url) : null;
  const trackText = tracking ? (trackUrl ? copy.trackAt(trackUrl) : copy.trackOnSite) : null;
  const referenceLine = `${COPY.referenceLabel}: ${reference}`;

  const text = [
    greeting,
    "",
    copy.intro,
    "",
    referenceLine,
    "",
    `${copy.linesHeading}:`,
    ...textList(lines),
    "",
    copy.noPayment,
    "",
    copy.nextSteps,
    ...(trackText ? ["", trackText] : []),
    "",
    copy.keepReference,
    "",
    COPY.brand,
  ].join("\n");

  const html = shell([
    paragraph(escapeHtml(greeting)),
    paragraph(escapeHtml(copy.intro)),
    paragraph(`<strong>${escapeHtml(COPY.referenceLabel)}:</strong> ${escapeHtml(reference)}`),
    paragraph(`<strong>${escapeHtml(copy.linesHeading)}</strong>`),
    lineList(lines),
    paragraph(escapeHtml(copy.noPayment)),
    paragraph(escapeHtml(copy.nextSteps)),
    trackText
      ? paragraph(trackUrl ? `${escapeHtml(copy.trackAtLead)} ${link(trackUrl, trackUrl)} ${escapeHtml(copy.trackAtTail)}` : escapeHtml(copy.trackOnSite))
      : "",
    small(escapeHtml(copy.keepReference)),
  ].join("\n"));

  return { subject: copy.subject(reference), html, text };
}

/**
 * The staff alert. Its subject is generic, so no customer name or address sits in inbox previews
 * and logs. It is never sent with the buyer's address as the reply-to: nothing proves the buyer
 * owns the address they typed (the signup alert's review M3 rule).
 */
export function buildStaffOrderAlert({
  reference,
  contactName,
  email,
  lines,
}: {
  reference: string;
  contactName: string;
  email: string;
  lines: readonly OrderEmailLine[];
}): RenderedEmail {
  const copy = COPY.staffAlert;
  const rows: Array<[string, string]> = [
    [copy.labels.reference, reference],
    [copy.labels.contactName, contactName],
    [copy.labels.email, email],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const text = [
    copy.intro,
    "",
    ...rows.map(([label, value]) => `${label.padEnd(width)} ${value}`),
    "",
    `${copy.linesHeading}:`,
    ...textList(lines),
    "",
    copy.detailsStored,
  ].join("\n");
  const html = shell([
    paragraph(escapeHtml(copy.intro)),
    `<dl style="margin:0 0 16px;font-size:15px;line-height:1.6">${rows
      .map(([label, value]) => `<dt style="font-weight:700">${escapeHtml(label)}</dt><dd style="margin:0 0 8px">${escapeHtml(value)}</dd>`)
      .join("")}</dl>`,
    paragraph(`<strong>${escapeHtml(copy.linesHeading)}</strong>`),
    lineList(lines),
    small(escapeHtml(copy.detailsStored)),
  ].join("\n"));
  return { subject: copy.subject, html, text };
}

/**
 * The quote, or null when it cannot be rendered truthfully: a payment link that is not a
 * credential-free https URL (Task 8b validates the host against the allowlist before queueing),
 * or figures that cannot be formatted exactly. A null quote is never sent.
 */
export function buildQuoteEmail({
  reference,
  contactName,
  lines,
  quote,
}: {
  reference: string;
  contactName: string;
  lines: readonly OrderEmailLine[];
  quote: OrderEmailQuote;
}): RenderedEmail | null {
  const copy = COPY.quote;
  const paymentUrl = safeHttpsUrl(quote.paymentUrl);
  const total = quote.subtotalMinor + quote.freightMinor;
  const amounts: Array<[string, string | null]> = [
    [copy.labels.subtotal, formatMinorUnits(quote.subtotalMinor, quote.currency)],
    [copy.labels.freight, formatMinorUnits(quote.freightMinor, quote.currency)],
    [copy.labels.total, formatMinorUnits(total, quote.currency)],
  ];
  if (!paymentUrl || amounts.some(([, value]) => value === null)) return null;
  const rows = amounts as Array<[string, string]>;
  const greeting = COPY.greeting(contactName.trim());
  const width = Math.max(...rows.map(([label]) => label.length));

  const text = [
    greeting,
    "",
    copy.intro,
    "",
    `${COPY.referenceLabel}: ${reference}`,
    "",
    `${copy.linesHeading}:`,
    ...textList(lines),
    "",
    ...rows.map(([label, value]) => `${`${label}:`.padEnd(width + 1)} ${value}`),
    "",
    copy.payLead,
    paymentUrl,
    "",
    copy.noObligation,
    "",
    COPY.brand,
  ].join("\n");

  const html = shell([
    paragraph(escapeHtml(greeting)),
    paragraph(escapeHtml(copy.intro)),
    paragraph(`<strong>${escapeHtml(COPY.referenceLabel)}:</strong> ${escapeHtml(reference)}`),
    paragraph(`<strong>${escapeHtml(copy.linesHeading)}</strong>`),
    lineList(lines),
    `<dl style="margin:0 0 16px;font-size:16px;line-height:1.6">${rows
      .map(([label, value]) => `<dt style="font-weight:700">${escapeHtml(label)}</dt><dd style="margin:0 0 8px">${escapeHtml(value)}</dd>`)
      .join("")}</dl>`,
    paragraph(`${escapeHtml(copy.payLead)} ${link(paymentUrl, copy.payLinkText)}`),
    paragraph(escapeHtml(paymentUrl)),
    small(escapeHtml(copy.noObligation)),
  ].join("\n"));

  return { subject: copy.subject(reference), html, text };
}
