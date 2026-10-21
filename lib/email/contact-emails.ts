import { CONTACT_TOPIC_LABELS, type ContactTopic } from "@/lib/contact/fields";
import { escapeHtml, paragraph, shell, type RenderedEmail } from "./lead-emails";

/**
 * The contact form's one email (rulings R160, R172): an alert to the BIBO Bay staff inbox. Its
 * subject carries only the topic label, so no name, address or message text sits in inbox previews
 * and logs. The sender's address is labelled unverified, and unlike the signup alert this one sets
 * the sender as reply-to (lib/outbox/contact.ts), because answering them is the point.
 *
 * The output depends only on its input, so every attempt of one row builds the same message (a
 * provider refuses a reused idempotency key with another body).
 */
export interface StaffContactSummary {
  name: string;
  /** As submitted. Nothing on the form proves the sender owns it. */
  email: string;
  topic: ContactTopic;
  message: string;
  /** The message's `created_at` as the claim hands it out. */
  receivedAt: string;
}

/** `YYYY-MM-DD HH:MM UTC`, so the alert never depends on the server's time zone. */
export function formatReceivedAt(receivedAt: string): string {
  return `${new Date(receivedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function buildStaffContactAlert({ name, email, topic, message, receivedAt }: StaffContactSummary): RenderedEmail {
  const intro = "A message arrived through the contact form on the BIBO Bay website.";
  const note = "Replying to this email writes to the address above. Nothing on the form proves the sender owns it.";
  const rows: Array<[string, string]> = [
    ["Name", name],
    ["Email (unverified)", email],
    ["Topic", CONTACT_TOPIC_LABELS[topic]],
    ["Received", formatReceivedAt(receivedAt)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const text = [intro, "", ...rows.map(([label, value]) => `${label.padEnd(width)} ${value}`), "", note, "", "Message:", message].join("\n");
  const html = shell([
    paragraph(escapeHtml(intro)),
    `<dl style="margin:0 0 16px;font-size:15px;line-height:1.6">${rows
      .map(([label, value]) => `<dt style="font-weight:700">${escapeHtml(label)}</dt><dd style="margin:0 0 8px;overflow-wrap:anywhere">${escapeHtml(value)}</dd>`)
      .join("")}</dl>`,
    paragraph(escapeHtml(note)),
    `<p style="margin:0 0 4px;font-size:15px;font-weight:700">Message</p>`,
    `<div style="margin:0;font-size:16px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(message)}</div>`,
  ].join("\n"));
  return { subject: `New BIBO Bay message: ${CONTACT_TOPIC_LABELS[topic]}`, html, text };
}
