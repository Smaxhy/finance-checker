/**
 * Turns a Gmail message + extraction into rows for the `emails` and `events`
 * tables. Only structured metadata and Gmail's own short snippet are kept;
 * the email body is never stored.
 */
import type { EmailExtraction } from "./classify";
import { decodeEntities, header, parseFrom, type GmailMessage } from "./mime";

export interface EmailRow {
  user_id: string;
  connection_id: string | null;
  provider: "gmail";
  external_id: string;
  thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  category: EmailExtraction["category"];
  is_important: boolean;
  merchant: string | null;
  merchant_key: string | null;
  amount: number | null;
  currency: string | null;
  order_number: string | null;
  due_date: string | null;
  event_start: string | null;
  event_end: string | null;
  location: string | null;
  extracted: Record<string, unknown>;
  extraction_method: "rules" | "ai";
  web_link: string;
}

export interface EventRow {
  user_id: string;
  source: "email";
  external_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  kind: string;
  amount_due: number | null;
  currency: string | null;
  payment_due_date: string | null;
  status: "confirmed" | "cancelled";
  calendar_name: string;
  html_link: string;
}

export function messageMeta(msg: GmailMessage) {
  const from = parseFrom(header(msg, "From"));
  const subject = header(msg, "Subject")?.trim() ?? "";
  const internal = Number(msg.internalDate);
  const dateHeader = header(msg, "Date");
  const receivedAt = Number.isFinite(internal) && internal > 0 ? new Date(internal) : dateHeader ? new Date(dateHeader) : new Date();
  return {
    subject,
    fromName: from.name,
    fromEmail: from.email,
    snippet: decodeEntities(msg.snippet ?? "").trim(),
    receivedAt,
    labelIds: msg.labelIds ?? [],
  };
}

export function toEmailRow(msg: GmailMessage, x: EmailExtraction, ctx: { userId: string; connectionId: string | null; webLink: string; method: "rules" | "ai" }): EmailRow {
  const meta = messageMeta(msg);
  return {
    user_id: ctx.userId,
    connection_id: ctx.connectionId,
    provider: "gmail",
    external_id: msg.id,
    thread_id: msg.threadId ?? null,
    from_name: meta.fromName?.slice(0, 200) ?? null,
    from_email: meta.fromEmail?.slice(0, 254) ?? null,
    subject: meta.subject.slice(0, 500) || null,
    snippet: meta.snippet.slice(0, 300) || null,
    received_at: meta.receivedAt.toISOString(),
    category: x.category,
    is_important: x.isImportant,
    merchant: x.merchant?.slice(0, 120) ?? null,
    merchant_key: x.merchantKey,
    amount: x.amount,
    currency: x.currency,
    order_number: x.orderNumber,
    due_date: x.dueDate,
    event_start: x.eventStart,
    event_end: x.eventEnd,
    location: x.location?.slice(0, 200) ?? null,
    extracted: x.details,
    extraction_method: ctx.method,
    web_link: ctx.webLink,
  };
}

const KIND_TITLE: Record<string, string> = {
  flight: "Flight",
  hotel: "Stay",
  restaurant: "Reservation",
  appointment: "Appointment",
  meeting: "Meeting",
  ticket: "Event",
  delivery: "Delivery",
  travel: "Trip",
};

/** Calendar entry derived from a booking / travel / appointment / delivery email, if it has a date. */
export function toEventRow(row: EmailRow, x: EmailExtraction): EventRow | null {
  const d = x.details;
  let startsAt = x.eventStart;
  let allDay = Boolean(d.all_day);
  let endsAt = x.eventEnd;
  if (!startsAt && x.eventKind === "delivery" && typeof d.delivery_date === "string") {
    startsAt = `${d.delivery_date}T00:00:00.000Z`;
    allDay = true;
    endsAt = null;
  }
  if (!startsAt || !x.eventKind) return null;
  const what = x.eventKind === "flight" && d.flight ? `Flight ${d.flight}${d.from && d.to ? ` ${d.from} → ${d.to}` : ""}` : null;
  const title =
    what ??
    (x.eventKind === "delivery"
      ? `${x.merchant ?? "Package"} delivery${d.carrier ? ` (${d.carrier})` : ""}`
      : `${KIND_TITLE[x.eventKind] ?? "Event"}${x.merchant ? `: ${x.merchant}` : ""}`);
  const amountDue = typeof d.amount_due === "number" ? d.amount_due : null;
  return {
    user_id: row.user_id,
    source: "email",
    external_id: row.external_id,
    title: title.slice(0, 300),
    description: row.subject,
    location: row.location,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay,
    kind: x.eventKind,
    amount_due: amountDue,
    currency: amountDue ? (row.currency ?? "EUR") : null,
    payment_due_date: amountDue && d.pay_at_property ? startsAt.slice(0, 10) : null,
    status: d.cancelled ? "cancelled" : "confirmed",
    calendar_name: "From email",
    html_link: row.web_link,
  };
}
