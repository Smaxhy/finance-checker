// Holds no secrets: the Anthropic client is passed in, so this also runs in the browser
// in the GitHub Pages edition (with the user's own API key).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { EmailCategory, EventKind } from "@/lib/types";
import { FALLBACK_BETA, supportsServerFallback } from "@/lib/ai/models";
import { matchMerchant, slugify } from "@/lib/finance/merchants";
import type { EmailExtraction, EmailInput } from "./classify";
import { zonedIso } from "./extract";

/**
 * Optional AI refinement of the rule-based extraction. Only called when the
 * user has opted in (profiles.ai_email_extraction_enabled) and an API key is
 * configured. Any failure falls back to the rules result.
 */

// Body text sent to the model is capped at 12,000 characters per email. The
// fields we need (totals, dates, booking references) sit near the top of
// transactional emails; the cap bounds cost and keeps long newsletters /
// legal footers out of the request.
export const AI_BODY_CHAR_CAP = 12_000;

const CATEGORIES = ["receipt", "purchase", "order", "shipping", "subscription", "trial", "renewal", "cancellation", "bill", "booking", "travel", "appointment", "important", "other"] as const;
const EVENT_KINDS = ["flight", "hotel", "restaurant", "appointment", "meeting", "ticket", "delivery", "travel", "other"] as const;

const ExtractionSchema = z.object({
  category: z.enum(CATEGORIES),
  is_important: z.boolean().describe("true for bills, deadlines, appointments, travel, trials ending, official/legal mail"),
  merchant: z.string().nullable().describe("company or person the email is about, e.g. 'Netflix', 'Booking.com'"),
  amount: z.number().nullable().describe("total amount charged, due or paid; null if none"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. EUR"),
  order_number: z.string().nullable(),
  due_date: z.string().nullable().describe("YYYY-MM-DD payment due date for bills"),
  trial_end_date: z.string().nullable().describe("YYYY-MM-DD"),
  renewal_date: z.string().nullable().describe("YYYY-MM-DD next renewal / charge date"),
  billing_cycle: z.enum(["weekly", "monthly", "quarterly", "yearly"]).nullable(),
  event_kind: z.enum(EVENT_KINDS).nullable(),
  event_start_date: z.string().nullable().describe("YYYY-MM-DD (check-in, departure, appointment, delivery)"),
  event_start_time: z.string().nullable().describe("HH:MM 24h local time"),
  event_end_date: z.string().nullable(),
  event_end_time: z.string().nullable(),
  location: z.string().nullable(),
  items: z.array(z.string()).describe("purchased item names, max 5"),
  pay_at_property: z.boolean(),
  refund: z.boolean(),
  cancelled: z.boolean().describe("true if the email confirms a cancellation"),
  tracking_number: z.string().nullable(),
  carrier: z.string().nullable(),
});

const SYSTEM = `You extract structured data from transactional emails for a personal finance and planning app used in Belgium.
Emails may be in Dutch, French or English. Use only information present in the email; return null (or false / []) for anything not stated.
Dates must be YYYY-MM-DD; use the received date to resolve dates without a year. Times are 24h local times as written in the email.
Amounts are numbers with a dot as decimal separator (e.g. "€ 1.234,56" -> 1234.56).
Category guide: receipt = paid invoice/receipt; bill = invoice still to pay; order = order confirmation; shipping = delivery/tracking notice;
purchase = refunds/returns or other purchase updates; subscription/trial/renewal/cancellation = subscription lifecycle;
booking = hotel/restaurant/event reservation; travel = flights/trains; appointment = doctor/dentist/hairdresser/meeting; important = other deadlines or official mail;
other = anything else (newsletters, marketing, personal chat).`;

const isDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function extractWithAi(client: Anthropic, model: string, input: EmailInput, base: EmailExtraction): Promise<EmailExtraction | null> {
  const body = (input.body ?? "").slice(0, AI_BODY_CHAR_CAP);
  try {
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 4000,
      ...(supportsServerFallback(model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
      output_config: { effort: "low", format: betaZodOutputFormat(ExtractionSchema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Received: ${input.receivedAt.toISOString()}\nFrom: ${input.fromName ?? ""} <${input.fromEmail ?? ""}>\nSubject: ${input.subject}\n\n${body || input.snippet}`,
        },
      ],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return null;
    const o = res.parsed_output;
    // Prefer the catalogue identity (rules already matched it from the sender) so keys stay stable.
    const entry = matchMerchant(o.merchant);
    const merchant = entry?.name ?? base.merchant ?? o.merchant;
    const merchantKey = entry?.key ?? base.merchantKey ?? (o.merchant ? slugify(o.merchant) : null);
    const time = (t: string | null) => (t && /^\d{1,2}:\d{2}$/.test(t) ? t.split(":").map(Number) : null);
    const start = isDate(o.event_start_date);
    const st = time(o.event_start_time);
    const end = isDate(o.event_end_date);
    const et = time(o.event_end_time);
    const details = { ...base.details };
    if (isDate(o.trial_end_date)) details.trial_end_date = o.trial_end_date!;
    if (isDate(o.renewal_date)) details.renewal_date = o.renewal_date!;
    if (o.billing_cycle) details.billing_cycle = o.billing_cycle;
    if (o.items.length) details.items = o.items.slice(0, 5);
    if (o.pay_at_property) {
      details.pay_at_property = true;
      if (o.amount) details.amount_due = o.amount;
    }
    if (o.refund) details.refund = true;
    if (o.cancelled) details.cancelled = true;
    if (o.tracking_number) details.tracking_number = o.tracking_number;
    if (o.carrier) details.carrier = o.carrier;
    if (o.event_kind === "delivery" && start) details.delivery_date = start;
    if (start && !st) details.all_day = true;
    return {
      category: o.category as EmailCategory,
      isImportant: o.is_important || base.isImportant,
      merchant,
      merchantKey,
      amount: o.amount ?? base.amount,
      currency: o.amount !== null ? (o.currency ?? base.currency ?? "EUR") : base.currency,
      orderNumber: o.order_number ?? base.orderNumber,
      dueDate: isDate(o.due_date) ?? base.dueDate,
      eventStart: start && o.event_kind !== "delivery" ? zonedIso(start, st?.[0] ?? 0, st?.[1] ?? 0) : base.eventStart,
      eventEnd: end ? zonedIso(end, et?.[0] ?? 11, et?.[1] ?? 0) : base.eventEnd,
      location: o.location ?? base.location,
      eventKind: (o.event_kind as EventKind | null) ?? base.eventKind,
      details,
    };
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.warn("AI email extraction failed, using rules:", e.status, e.message);
    else console.warn("AI email extraction failed, using rules:", e instanceof Error ? e.message : e);
    return null;
  }
}
