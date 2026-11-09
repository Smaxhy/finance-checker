/**
 * Rule-based email classification + extraction. Works on its own (no AI);
 * the optional AI pass only refines its output.
 */
import type { EmailCategory, EventKind } from "@/lib/types";
import { matchMerchant, cleanMerchantName, slugify, type MerchantEntry } from "@/lib/finance/merchants";
import {
  dateNear,
  findBillingCycle,
  findCarrier,
  findDates,
  findFlight,
  findOrderNumber,
  findPriceChange,
  findTime,
  findTracking,
  pickAmount,
  zonedIso,
} from "./extract";

export interface EmailInput {
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  snippet: string;
  body?: string;
  receivedAt: Date;
  labelIds?: string[];
}

export interface ExtractedDetails {
  trial_end_date?: string;
  renewal_date?: string;
  billing_cycle?: string;
  delivery_date?: string;
  tracking_number?: string;
  carrier?: string;
  items?: string[];
  pay_at_property?: boolean;
  amount_due?: number;
  refund?: boolean;
  cancelled?: boolean;
  flight?: string;
  from?: string;
  to?: string;
  old_price?: number;
  new_price?: number;
  invoice_number?: string;
  payment_method?: string;
  [key: string]: unknown;
}

export interface EmailExtraction {
  category: EmailCategory;
  isImportant: boolean;
  merchant: string | null;
  merchantKey: string | null;
  amount: number | null;
  currency: string | null;
  orderNumber: string | null;
  dueDate: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  location: string | null;
  eventKind: EventKind | null;
  details: ExtractedDetails;
}

// --------------------------------------------------------------- patterns
const R = {
  cancellation:
    /\b(cancellation (is )?confirm|confirm(ation)? of (your )?cancellation|(subscription|membership|plan) (has been|was|is) (cancel+ed|ended|terminated)|we('ve| have) cancel+ed your (subscription|membership|plan)|you('ve| have) cancel+ed|bevestiging van (je|uw) opzegging|(je|uw) abonnement (werd|is) (stopgezet|opgezegd|beëindigd)|opzegging (is )?bevestigd|confirmation de (votre )?résiliation|votre abonnement (a été )?(résilié|annulé)|nous confirmons (la )?résiliation)/i,
  trial:
    /((free trial|trial|proefperiode|proefabonnement|essai gratuit|période d'essai|periode d'essai)[^.\n]{0,40}\b(has started|started|is active|is now active|begins|begint|is gestart|loopt|ends|will end|ending|expires|eindigt|loopt af|se termine|prend fin|commence)|\byour (free )?trial\b|\bje (gratis )?proefperiode\b|\bvotre (période d'essai|essai gratuit)\b|\bfree until\b|\bgratis tot\b)/i,
  flight: /\b(boarding pass|flight|itinerary|e-?ticket|vlucht|instapkaart|carte d'embarquement|\bvol\b|ryanair|brussels airlines|transavia|klm|lufthansa|easyjet|vueling|tui fly|air france)\b/i,
  train: /\b(eurostar|thalys|train ticket|treinticket|billet de train|sncb europe|nmbs.*ticket|deutsche bahn|db ticket)\b/i,
  shipping:
    /\b(shipped|has been dispatched|on (its|the) way|out for delivery|track(ing)? (your )?(order|package|parcel)|verzonden|onderweg|wordt (morgen |vandaag |binnenkort )?geleverd|(komt|komen) (morgen |vandaag )?aan|je pakje|uw pakje|je pakket|uw pakket|zending|colis|expédié|en cours de livraison|livraison prévue|sera livré|delivery (update|scheduled|expected)|arriving (today|tomorrow|on))\b/i,
  hotel: /\b(hotel|booking\.com|airbnb|check-?in|accommodation|verblijf|séjour|hébergement|nights?\b|nachten|nuits?)\b/i,
  restaurant: /\b(thefork|the fork|lafourchette|restaurant|table for|tafel voor|table pour|resy|opentable)\b/i,
  ticket: /\b(tickets? (for|voor|pour)|your tickets|je tickets|vos billets|ticketmaster|kinepolis|concert|festival|e-?tickets?)\b/i,
  booking: /\b(booking (is )?confirm|reservation (is )?confirm|your (reservation|booking)|reservering|boeking|réservation|reserved|gereserveerd|réservé)\b/i,
  appointment:
    /\b(appointment|afspraak|rendez-vous|rdv|consultation|tandarts|dentist|dokter|huisarts|médecin|kinesist|kiné|kapper|coiffeur|hairdresser|physio|ophthalm|oogarts|dermatolo)\b/i,
  meeting: /\b(meeting|vergadering|réunion|invitation:|uitnodiging:|interview|sollicitatiegesprek)\b/i,
  renewal:
    /\b(renew(s|ed|al)?|auto-?renew|will be (charged|billed)|automatically (renew|charged|billed)|verleng(d|ing)|wordt verlengd|renouvel|price (change|increase|update)|updating your .{0,40}price|new price|prijs(wijziging|aanpassing|verhoging)|nouveau (prix|tarif)|hausse de prix)\b/i,
  billUnpaid:
    /\b(payment due|amount due|due date|due on|pay by|te betalen|vervaldag|vervaldatum|uiterlijk|à payer|a payer|échéance|date limite|domicili|wordt gedomicilieerd|will be debited|saldo te betalen|afrekening|aanslagbiljet|payment request|betalingsverzoek|herinnering.*(factuur|betaling)|rappel)\b/i,
  invoice: /\b(invoice|factuur|facture|bill (is )?(ready|available)|your (monthly )?(bill|statement)|rekening van|avis d'échéance)\b/i,
  paid: /\b(receipt|ontvangstbewijs|kassabon|kassaticket|reçu|paid|betaald|payé|payment (received|confirm|successful)|betaling (ontvangen|geslaagd|bevestigd)|paiement (reçu|confirmé|accepté)|thank(s| you) for your payment|bedankt voor (je|uw) betaling|merci pour votre paiement|order total|you paid)\b/i,
  order:
    /\b(order (confirm|received|placed|number)|your order|thanks? for (your )?(order|purchase)|bestelling|bestelnummer|bedankt voor (je|uw) (bestelling|aankoop)|commande|merci pour votre (commande|achat)|purchase confirm)\b/i,
  refund: /\b(refund|terugbetaling|remboursement|retour (ontvangen|verwerkt)|return (received|processed)|we('ve| have) received your return|credit note|creditnota)\b/i,
  subscription:
    /\b(subscription|membership|abonnement|lidmaatschap|welcome to .{0,30}(premium|plus|pro|unlimited|membership)|you('re| are) (now )?subscribed|thanks for subscribing|bedankt voor je abonnement|votre abonnement)\b/i,
  important:
    /\b(action required|actie vereist|action requise|urgent|dringend|deadline|final notice|laatste herinnering|dernier rappel|myminfin|ebox|aanslagbiljet|belastingaangifte|tax return|déclaration d'impôt|impôts?|contract|huurcontract|lease|insurance claim|schadeclaim|identity card|identiteitskaart|carte d'identité|security alert|beveiligingswaarschuwing|verify your|password (reset|changed))\b/i,
  payAtProperty: /\b(pay(able)? at the (property|hotel)|payment at (the )?property|ter plaatse (te )?betalen|betaling bij aankomst|te betalen in het hotel|à payer sur place|paiement (à l'établissement|sur place))\b/i,
};

const GENERIC_SENDER = /^(no-?reply|noreply|do-?not-?reply|info|notifications?|support|service|hello|team|news|mail|billing|account|accounts|klantenservice|service-client)$/i;
const MARKETING = /(\b(unsubscribe from (this|our) newsletter|newsletter|black friday|cyber monday|last chance|webinar|sale ends|limited[- ]time offer|promo code|kortingscode|code promo|special offer|exclusive offer)\b|\d+\s?% (off|korting|de réduction)|\b(start|try|get|claim|unlock|begin)\b[^.\n]{0,25}\b(free trial|trial|gratis proefperiode|essai gratuit)\b)/i;
/** Catalogue entries that describe a kind of business rather than a brand; keep the sender's own name for display. */
const GENERIC_ENTRIES = new Set(["pharmacy", "dentist", "doctor", "hospital", "mutualite", "insurance", "water"]);

function senderMerchant(input: EmailInput, text: string, category: EmailCategory): { name: string | null; key: string | null; entry?: MerchantEntry } {
  const domain = input.fromEmail?.split("@")[1]?.replace(/^(e?mail|info|news|service|account|accounts|notifications?|em|e)\./, "") ?? "";
  const tryMatch = (...xs: (string | null | undefined)[]) => {
    for (const x of xs) {
      const e = matchMerchant(x);
      if (e) return e;
    }
    return undefined;
  };
  // Carriers deliver for someone else: prefer the shop mentioned in the subject.
  const isCarrier = Boolean(findCarrier(`${input.fromName ?? ""} ${input.fromEmail ?? ""}`));
  const entry = isCarrier || category === "shipping" ? tryMatch(input.subject, input.snippet, input.fromName) : tryMatch(input.fromName, input.subject, domain, input.snippet);
  if (entry && GENERIC_ENTRIES.has(entry.key) && input.fromName && !GENERIC_SENDER.test(input.fromName.trim())) {
    return { name: cleanMerchantName(input.fromName), key: entry.key, entry };
  }
  if (entry) return { name: entry.name, key: entry.key, entry };
  if (isCarrier) {
    const carrier = findCarrier(`${input.fromName ?? ""} ${input.fromEmail ?? ""}`)!;
    return { name: carrier, key: slugify(carrier) };
  }
  const name = input.fromName && !GENERIC_SENDER.test(input.fromName.trim()) ? input.fromName : domain.split(".").slice(-2, -1)[0] ?? null;
  if (!name) return { name: null, key: null };
  const clean = cleanMerchantName(name);
  void text;
  return { name: clean, key: slugify(clean) || null };
}

/** Category from subject + snippet (+ sender hints). Body is only used for field extraction. */
export function classifyCategory(input: Pick<EmailInput, "subject" | "snippet" | "fromName" | "fromEmail" | "labelIds">): { category: EmailCategory; isImportant: boolean } {
  const head = `${input.subject}\n${input.snippet}`;
  const from = `${input.fromName ?? ""} ${input.fromEmail ?? ""}`;
  const labels = new Set(input.labelIds ?? []);
  const fromCarrier = Boolean(findCarrier(from));
  const merchant = matchMerchant(input.fromName) ?? matchMerchant(input.subject);

  // Promotions ("50% off", "start your free trial") are never transactional.
  if (MARKETING.test(head) && !R.paid.test(head) && !R.billUnpaid.test(head) && !R.order.test(input.subject)) {
    return { category: "other", isImportant: labels.has("STARRED") };
  }

  let category: EmailCategory = "other";
  if (R.cancellation.test(head) && !R.booking.test(input.subject)) category = "cancellation";
  else if (R.trial.test(head)) category = "trial";
  else if ((R.flight.test(head) || R.train.test(head) || merchant?.category === "travel") && !R.refund.test(head) && !MARKETING.test(head)) {
    category = R.hotel.test(head) && !R.flight.test(input.subject) ? "booking" : "travel";
  } else if (R.order.test(input.subject) && !R.shipping.test(input.subject) && !R.paid.test(input.subject) && !R.invoice.test(input.subject) && !R.refund.test(head)) category = "order";
  else if (fromCarrier || R.shipping.test(head)) category = "shipping";
  else if ((R.booking.test(head) || R.restaurant.test(head) || R.ticket.test(input.subject)) && !MARKETING.test(head)) category = "booking";
  else if (R.appointment.test(head) || (R.meeting.test(input.subject) && labels.has("IMPORTANT"))) category = "appointment";
  else if (R.renewal.test(head) && !R.paid.test(input.subject)) category = "renewal";
  else if (R.billUnpaid.test(head) && !/\bbetaald\b|\bpaid\b|\bpayé\b/i.test(head)) category = "bill";
  else if (R.invoice.test(head) && merchant?.category === "bills" && !R.paid.test(head)) category = "bill";
  else if (R.paid.test(head) || (R.invoice.test(input.subject) && !R.billUnpaid.test(head))) category = "receipt";
  else if (R.refund.test(head)) category = "purchase";
  else if (R.order.test(head)) category = "order";
  else if (R.subscription.test(input.subject) && !MARKETING.test(head)) category = "subscription";
  else if (R.important.test(head)) category = "important";

  const isImportant =
    labels.has("STARRED") ||
    category === "bill" ||
    category === "appointment" ||
    category === "travel" ||
    (category === "booking" && R.hotel.test(head)) ||
    category === "trial" ||
    category === "important" ||
    (R.important.test(head) && !MARKETING.test(head));

  return { category, isImportant };
}

const KW = {
  trialEnd: /(trial|proef\w*|essai)[^.\n]{0,60}(end|ends|ending|expire|eindigt|loopt af|afloop|termine|prend fin|until|tot|jusqu)|(free|gratis) (until|tot)|ends on|eindigt op|se termine le|valable jusqu|jusqu'au|until\s*$/i,
  renewal: /renew|verleng|renouvel|next (billing|payment|charge)|volgende (betaling|factuur)|prochain (paiement|prélèvement)|billed on|charged on|starting with|vanaf|à partir du|will be charged/i,
  due: /due|vervaldag|vervaldatum|te betalen (voor|vóór|tegen)|uiterlijk|betaal(d)? (voor|vóór)|avant le|échéance|date limite|payment date|betaaldatum|debited on|gedomicilieerd op|prélevé le/i,
  delivery: /deliver|geleverd|levering|leverdatum|livraison|livré|arriv|aankomst|bezorg/i,
  start: /check-?in|aankomst|arrivée|arrival|depart|vertrek|départ|on|op|le|date|datum|when|wanneer|quand|at|om|à/i,
  checkout: /check-?out|vertrek|départ|until|tot|jusqu/i,
};

function locationFrom(text: string): string | null {
  const m = text.match(/\b(?:address|adres|adresse|location|locatie|lieu|where|waar|venue)\s*:?\s*([^\n]{6,90})/i);
  if (m) return m[1].trim().replace(/[.;,]+$/, "");
  const street = text.match(/\b([A-ZÀ-ÿ][\wÀ-ÿ'.-]+(?:straat|laan|steenweg|plein|lei|dreef|weg|kaai|rue|avenue|boulevard|chaussée|place)\s+\d{1,4}[a-z]?(?:,\s*\d{4})?(?:\s+[A-ZÀ-ÿ][\wÀ-ÿ-]+)?)/);
  return street ? street[1].trim() : null;
}

/** Full rule-based extraction for one email. */
export function extractEmail(input: EmailInput): EmailExtraction {
  const { category, isImportant } = classifyCategory(input);
  const text = `${input.subject}\n${input.snippet}\n${input.body ?? ""}`;
  const ref = input.receivedAt;
  const details: ExtractedDetails = {};

  const merchant = senderMerchant(input, text, category);
  const money = pickAmount(text);
  let amount = money?.amount ?? null;
  const currency = money?.currency ?? null;

  const cycle = findBillingCycle(text);
  if (cycle && ["trial", "subscription", "renewal", "receipt"].includes(category)) details.billing_cycle = cycle;

  let dueDate: string | null = null;
  let eventStart: string | null = null;
  let eventEnd: string | null = null;
  let eventKind: EventKind | null = null;

  if (category === "trial") {
    const d = dateNear(text, KW.trialEnd, ref) ?? findDates(text, ref).find((x) => x.date >= toDay(ref)) ?? null;
    if (d) details.trial_end_date = d.date;
  }
  if (category === "renewal" || category === "subscription" || category === "receipt") {
    const d = dateNear(text, KW.renewal, ref);
    if (d && d.date >= toDay(ref)) details.renewal_date = d.date;
    const pc = findPriceChange(text);
    if (pc) {
      details.old_price = pc.old_price;
      details.new_price = pc.new_price;
      amount = pc.new_price;
    }
  }
  if (category === "bill") {
    const d = dateNear(text, KW.due, ref);
    dueDate = d?.date ?? null;
  }
  if (category === "shipping" || category === "order") {
    const d = dateNear(text, KW.delivery, ref);
    if (d && d.date >= toDay(ref)) details.delivery_date = d.date;
    else if (/\b(tomorrow|morgen|demain)\b/i.test(text)) details.delivery_date = toDay(new Date(ref.getTime() + 86_400_000));
    else if (/\b(today|vandaag|aujourd'hui)\b/i.test(`${input.subject} ${input.snippet}`)) details.delivery_date = toDay(ref);
    const carrier = findCarrier(`${input.fromName ?? ""} ${input.fromEmail ?? ""} ${text.slice(0, 600)}`);
    if (carrier) details.carrier = carrier;
    const tracking = findTracking(text);
    if (tracking) details.tracking_number = tracking;
    if (category === "shipping") amount = null; // shipping notices rarely carry the order total reliably
  }
  if (R.refund.test(`${input.subject} ${input.snippet}`)) details.refund = true;

  if (category === "travel" || category === "booking" || category === "appointment") {
    const flight = category === "travel" ? findFlight(text) : null;
    if (flight) {
      if (flight.flight) details.flight = flight.flight;
      if (flight.from) details.from = flight.from;
      if (flight.to) details.to = flight.to;
    }
    const startMatch = dateNear(text, KW.start, ref, 40) ?? findDates(text, ref).find((x) => x.date >= toDay(ref)) ?? null;
    if (startMatch && startMatch.date >= toDay(new Date(ref.getTime() - 86_400_000))) {
      const time = findTime(text, startMatch.index, startMatch.length + 40);
      eventStart = zonedIso(startMatch.date, time?.h ?? 0, time?.m ?? 0);
      if (!time) details.all_day = true;
      const end = findDates(text, ref).find((x) => x.index > startMatch.index && x.date >= startMatch.date && KW.checkout.test(text.slice(Math.max(0, x.index - 40), x.index)));
      if (end) {
        const t = findTime(text, end.index, end.length + 40);
        eventEnd = zonedIso(end.date, t?.h ?? 11, t?.m ?? 0);
      }
    }
    eventKind =
      category === "appointment"
        ? R.meeting.test(input.subject) && !R.appointment.test(input.subject)
          ? "meeting"
          : "appointment"
        : category === "travel"
          ? R.flight.test(text)
            ? "flight"
            : "travel"
          : R.hotel.test(text)
            ? "hotel"
            : R.restaurant.test(text)
              ? "restaurant"
              : R.ticket.test(text)
                ? "ticket"
                : "other";
    if (category === "booking" && R.payAtProperty.test(text) && amount) {
      details.pay_at_property = true;
      details.amount_due = amount;
    }
    if (/\b(cancel+ed|geannuleerd|annulée?)\b/i.test(input.subject)) details.cancelled = true;
  }
  if (category === "shipping" && details.delivery_date) eventKind = "delivery";

  const orderNumber = findOrderNumber(text);
  if (category === "bill" && orderNumber) details.invoice_number = orderNumber;
  const payment = text.match(/\b(bancontact|visa|mastercard|maestro|paypal|apple pay|google pay|payconiq|ideal|sepa direct debit|domiciliëring|domiciliation)\b/i);
  if (payment && ["receipt", "order", "purchase", "subscription", "renewal"].includes(category)) details.payment_method = payment[1];

  return {
    category,
    isImportant,
    merchant: merchant.name,
    merchantKey: merchant.key,
    amount,
    currency: amount !== null ? (currency ?? "EUR") : null,
    orderNumber,
    dueDate,
    eventStart,
    eventEnd,
    location: category === "travel" || category === "booking" || category === "appointment" ? locationFrom(text) : null,
    eventKind,
    details,
  };
}

function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Cheap first-pass filter on metadata only: is this message worth fetching in full? */
export function isLikelyRelevant(input: Pick<EmailInput, "subject" | "snippet" | "fromName" | "fromEmail" | "labelIds">): boolean {
  const labels = new Set(input.labelIds ?? []);
  if (["SPAM", "TRASH", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "CHAT", "DRAFT", "SENT"].some((l) => labels.has(l))) return false;
  const { category, isImportant } = classifyCategory(input);
  return category !== "other" || isImportant;
}
