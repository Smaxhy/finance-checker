import "server-only";
/**
 * Generates realistic Belgian sample data for exploring the app. Everything
 * is inserted with is_demo = true, displayed with a DEMO badge, and removable
 * in one action. Dates are relative to "today" so the demo always looks live.
 */
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { classifyTransaction } from "@/lib/finance/categorize";
import { addDays, addMonths, startOfMonth, toISODate } from "@/lib/dates";
import { hashIdentifier } from "@/lib/crypto";
import { slugify } from "@/lib/finance/merchants";
import { zonedToUtc } from "@/lib/calendar/time";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoTx {
  account: "checking" | "savings";
  date: Date;
  amount: number;
  description: string;
  counterparty?: string;
  counterpartyIban?: string;
}

const MONTH_NAMES = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const CHECKING_IBAN = "BE68539007547034";
const SAVINGS_IBAN = "BE71096123456769";

/** A wall-clock time in Brussels on the given calendar day (independent of the server's timezone). */
function at(base: Date, hour: number, minute = 0) {
  return zonedToUtc(toISODate(base), `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
}

export async function seedDemoData(supabase: AppSupabaseClient, userId: string, today = new Date()) {
  const rand = rng(20261109);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const between = (min: number, max: number) => Math.round((min + rand() * (max - min)) * 100) / 100;

  // ---------------------------------------------------------------- accounts
  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .upsert(
      [
        {
          user_id: userId,
          source: "demo",
          external_id: "demo-checking",
          name: "Zichtrekening",
          institution: "KBC (demo)",
          iban_masked: "BE68 •••• 7034",
          iban_hash: hashIdentifier(CHECKING_IBAN),
          type: "checking",
          balance: 2846.37,
          balance_updated_at: new Date().toISOString(),
          is_demo: true,
        },
        {
          user_id: userId,
          source: "demo",
          external_id: "demo-savings",
          name: "Spaarrekening",
          institution: "KBC (demo)",
          iban_masked: "BE71 •••• 6769",
          iban_hash: hashIdentifier(SAVINGS_IBAN),
          type: "savings",
          balance: 12480.0,
          balance_updated_at: new Date().toISOString(),
          is_demo: true,
        },
      ],
      { onConflict: "user_id,source,external_id" },
    )
    .select("id, external_id");
  if (accErr || !accounts) throw new Error(`Could not create demo accounts: ${accErr?.message}`);
  const accountId = { checking: accounts.find((a) => a.external_id === "demo-checking")!.id, savings: accounts.find((a) => a.external_id === "demo-savings")!.id };
  const ownHashes = new Set([hashIdentifier(CHECKING_IBAN), hashIdentifier(SAVINGS_IBAN)]);

  // ------------------------------------------------------------ transactions
  const txs: DemoTx[] = [];
  const start = startOfMonth(addMonths(today, -6));
  const add = (t: DemoTx) => {
    if (t.date <= today && t.date >= start) txs.push(t);
  };

  for (let m = 0; m <= 6; m++) {
    const monthStart = addMonths(start, m);
    const y = monthStart.getFullYear();
    const mo = monthStart.getMonth();
    const day = (d: number) => new Date(y, mo, Math.min(d, new Date(y, mo + 1, 0).getDate()));
    const monthName = MONTH_NAMES[mo];
    const isCurrent = mo === today.getMonth() && y === today.getFullYear();

    add({ account: "checking", date: day(25), amount: 3450, description: `Loon ${monthName}`, counterparty: "ACME Belgium NV", counterpartyIban: "BE12001234567890" });
    add({ account: "checking", date: day(1), amount: -1150, description: `Huur ${monthName} appartement`, counterparty: "Immo Vandenberghe", counterpartyIban: "BE45063987654321" });
    // Monthly transfer to own savings (must not count as spending or income).
    add({ account: "checking", date: day(26), amount: -400, description: "Overschrijving", counterparty: "Eigen spaarrekening", counterpartyIban: SAVINGS_IBAN });
    add({ account: "savings", date: day(26), amount: 400, description: "Overschrijving", counterparty: "Eigen zichtrekening", counterpartyIban: CHECKING_IBAN });

    add({ account: "checking", date: day(12), amount: -118, description: "EUROPESE DOMICILIERING ENGIE Electrabel voorschot" });
    add({ account: "checking", date: day(15), amount: -64.99, description: "EUROPESE DOMICILIERING PROXIMUS internet + tv" });
    add({ account: "checking", date: day(18), amount: -15, description: "MOBILE VIKINGS abonnement" });
    add({ account: "checking", date: day(3), amount: -24.5, description: "DKV Belgium hospitalisatieverzekering" });
    add({ account: "checking", date: day(28), amount: -2.5, description: "Beheerskosten rekening" });

    // Subscriptions - Netflix raised its price 3 months ago.
    add({ account: "checking", date: day(7), amount: m >= 4 ? -15.99 : -13.99, description: "NETFLIX.COM" });
    add({ account: "checking", date: day(14), amount: -11.99, description: "Spotify P2A9C1" });
    add({ account: "checking", date: day(9), amount: -11.99, description: "DEEZER SA PARIS" });
    add({ account: "checking", date: day(20), amount: -11.99, description: "DISNEY PLUS" });
    add({ account: "checking", date: day(2), amount: -2.99, description: "APPLE.COM/BILL ICLOUD" });
    add({ account: "checking", date: day(11), amount: -23, description: "OPENAI *CHATGPT SUBSCR" });
    add({ account: "checking", date: day(5), amount: -10, description: "GITHUB, INC. Copilot" });
    if (m <= 3) add({ account: "checking", date: day(22), amount: -12.99, description: "STREAMZ.BE" }); // cancelled ~2 months ago

    // Everyday spending
    const groceryCount = 9 + Math.floor(rand() * 4);
    for (let i = 0; i < groceryCount; i++) {
      const d = day(1 + Math.floor(rand() * 28));
      const shop = pick(["COLRUYT LEUVEN", "DELHAIZE LEUVEN", "ALDI HEVERLEE", "ALBERT HEIJN LEUVEN", "CARREFOUR MARKET KESSEL-LO", "BAKKERIJ VAN DAMME LEUVEN"]);
      const amt = shop.startsWith("BAKKERIJ") ? between(4, 14) : between(16, 96);
      add({ account: "checking", date: at(d, 17, 30), amount: -amt, description: `BETALING MET DEBETKAART ${shop}` });
    }
    const restaurantCount = (isCurrent ? 9 : 5) + Math.floor(rand() * 3);
    for (let i = 0; i < restaurantCount; i++) {
      const d = day(1 + Math.floor(rand() * 28));
      const place = pick(["DELIVEROO", "UBER *EATS", "EXKI LEUVEN", "LE PAIN QUOTIDIEN", "BRASSERIE DE MARKT LEUVEN", "TAKEAWAY.COM"]);
      const amt = place.includes("BRASSERIE") ? between(48, 92) : place.includes("EXKI") ? between(9, 15) : between(19, 38);
      add({ account: "checking", date: d, amount: -amt, description: place });
    }
    for (let i = 0; i < 6; i++) {
      const d = day(1 + Math.floor(rand() * 28));
      add({ account: "checking", date: d, amount: -pick([7.6, 11.4, 15.2]), description: "NMBS/SNCB MOBILE TICKET" });
    }
    add({ account: "checking", date: day(8), amount: -between(58, 74), description: "TOTALENERGIES 1234 HEVERLEE" });
    add({ account: "checking", date: day(23), amount: -between(55, 72), description: "TOTALENERGIES 1234 HEVERLEE" });
    add({ account: "checking", date: day(16), amount: -between(22, 41), description: "CAMBIO CARSHARING" });
    add({ account: "checking", date: day(10), amount: -50, description: "GELDOPNEMING BANCONTACT KBC LEUVEN" });
    add({ account: "checking", date: day(4 + Math.floor(rand() * 20)), amount: -between(8, 32), description: "MULTIPHARMA LEUVEN" });
    add({ account: "checking", date: day(6 + Math.floor(rand() * 18)), amount: -between(12, 26), description: "KINEPOLIS LEUVEN" });
    add({ account: "checking", date: day(13), amount: -between(24, 89), description: pick(["BOL.COM", "ZALANDO SE", "ACTION LEUVEN", "HEMA LEUVEN", "KRUIDVAT LEUVEN"]) });
    add({ account: "checking", date: day(21), amount: -between(15, 60), description: pick(["BOL.COM", "IKEA ZAVENTEM", "DECATHLON LEUVEN"]) });
  }

  // Basic-Fit bills every 4 weeks.
  for (let d = addDays(start, 3); d <= today; d = addDays(d, 28)) add({ account: "checking", date: d, amount: -29.99, description: "BASIC-FIT BELGIUM" });

  // One-offs
  add({ account: "checking", date: addDays(today, -4), amount: -329, description: "COOLBLUE BELGIE NV Sony WH-1000XM6" });
  add({ account: "checking", date: addDays(today, -26), amount: -129.98, description: "RYANAIR DAC FR8KQ2 CRL-LIS" });
  add({ account: "checking", date: addDays(today, -40), amount: -89, description: "TICKETMASTER BELGIUM Concert" });
  add({ account: "checking", date: addDays(today, -58), amount: -65, description: "Tandarts Dr. Claes" });
  add({ account: "checking", date: addDays(today, -44), amount: 45.6, description: "Terugbetaling CM Christelijke Mutualiteit" });
  add({ account: "checking", date: addDays(today, -19), amount: -79.95, description: "ZALANDO SE" });
  add({ account: "checking", date: addDays(today, -12), amount: 79.95, description: "ZALANDO SE terugbetaling retour" });
  add({ account: "checking", date: addDays(today, -120), amount: -89.9, description: "AMAZON PRIME DE*2K4L9" });
  add({ account: "checking", date: addDays(today, -341), amount: -99, description: "MICROSOFT*365 PERSONAL" });
  add({ account: "checking", date: addDays(today, -95), amount: 1250, description: "Belastingterugbetaling FOD Financien" });

  const txRows = txs.map((t, i) => {
    const c = classifyTransaction({ amount: t.amount, description: t.description, counterpartyName: t.counterparty, counterpartyIbanHash: t.counterpartyIban ? hashIdentifier(t.counterpartyIban) : null }, { ownIbanHashes: ownHashes });
    return {
      user_id: userId,
      account_id: accountId[t.account],
      source: "demo",
      external_id: `demo-${i}-${toISODate(t.date)}-${slugify(t.description).slice(0, 20)}`,
      booked_at: toISODate(t.date),
      amount: t.amount,
      currency: "EUR",
      description: t.description,
      merchant: c.merchant,
      merchant_key: c.merchantKey,
      counterparty_name: t.counterparty ?? null,
      counterparty_iban_masked: t.counterpartyIban ? `${t.counterpartyIban.slice(0, 4)} •••• ${t.counterpartyIban.slice(-4)}` : null,
      counterparty_iban_hash: t.counterpartyIban ? hashIdentifier(t.counterpartyIban) : null,
      kind: c.kind,
      category_id: c.categoryId,
      category_source: c.categorySource,
      is_demo: true,
    };
  });
  for (let i = 0; i < txRows.length; i += 500) {
    const { error } = await supabase.from("transactions").upsert(txRows.slice(i, i + 500), { onConflict: "user_id,source,external_id" });
    if (error) throw new Error(`Could not insert demo transactions: ${error.message}`);
  }

  // ------------------------------------------------------------------ emails
  const iso = (d: Date) => d.toISOString();
  const dIso = (d: Date) => toISODate(d);
  const flightDate = at(addDays(today, 18), 7, 5);
  const hotelIn = at(addDays(today, 18), 15);
  const hotelOut = at(addDays(today, 21), 11);
  const dinner = at(addDays(today, 2), 19, 30);
  const dentist = at(addDays(today, 4), 9, 15);
  const emails = [
    { key: "order-bol", from_name: "bol.com", from_email: "klantenservice@bol.com", subject: "Bedankt voor je bestelling 4012-338-912", received_at: iso(addDays(today, -3)), category: "order", merchant: "bol.com", merchant_key: "bol", amount: 42.98, order_number: "4012-338-912", snippet: "Je bestelling wordt morgen geleverd. Totaal: € 42,98", extracted: { items: ["USB-C hub", "Notitieboek A5"], delivery_date: dIso(addDays(today, 1)) } },
    { key: "ship-bpost", from_name: "bpost", from_email: "noreply@bpost.be", subject: "Je pakje van bol.com komt morgen aan", received_at: iso(addDays(today, -1)), category: "shipping", merchant: "bol.com", merchant_key: "bol", snippet: "Track & trace 3232 1234 5678. Verwachte levering tussen 10:00 en 14:00.", extracted: { carrier: "bpost", tracking_number: "323212345678", delivery_date: dIso(addDays(today, 1)) } },
    { key: "receipt-coolblue", from_name: "Coolblue", from_email: "noreply@coolblue.be", subject: "Je factuur voor bestelling 91827364", received_at: iso(addDays(today, -4)), category: "receipt", merchant: "Coolblue", merchant_key: "coolblue", amount: 329, order_number: "91827364", snippet: "Sony WH-1000XM6 - € 329,00. Betaald met Bancontact.", extracted: { items: ["Sony WH-1000XM6"], payment_method: "Bancontact" } },
    { key: "receipt-uber", from_name: "Uber Eats", from_email: "noreply@uber.com", subject: "Your Thursday evening order with Uber Eats", received_at: iso(addDays(today, -6)), category: "receipt", merchant: "Uber Eats", merchant_key: "uber-eats", amount: 27.4, snippet: "Total €27.40 · Pho Saigon Leuven", extracted: {} },
    { key: "refund-zalando", from_name: "Zalando", from_email: "info@service-mail.zalando.be", subject: "We hebben je retour ontvangen - terugbetaling € 79,95", received_at: iso(addDays(today, -13)), category: "purchase", merchant: "Zalando", merchant_key: "zalando", amount: 79.95, snippet: "Je terugbetaling wordt binnen 3 werkdagen verwerkt.", extracted: { refund: true } },
    { key: "netflix-price", from_name: "Netflix", from_email: "info@account.netflix.com", subject: "We're updating your Netflix price", received_at: iso(addDays(today, -100)), category: "renewal", merchant: "Netflix", merchant_key: "netflix", amount: 15.99, snippet: "Starting with your next billing date, your Standard plan will be €15.99/month.", extracted: { billing_cycle: "monthly", old_price: 13.99, new_price: 15.99 } },
    { key: "spotify-receipt", from_name: "Spotify", from_email: "no-reply@spotify.com", subject: "Your Spotify Premium receipt", received_at: iso(addDays(today, -25)), category: "receipt", merchant: "Spotify", merchant_key: "spotify", amount: 11.99, snippet: "Premium Individual - €11.99. Next payment on the 14th.", extracted: { billing_cycle: "monthly" } },
    { key: "audible-trial", from_name: "Audible", from_email: "noreply@audible.de", subject: "Welcome to Audible - your free trial has started", received_at: iso(addDays(today, -25)), category: "trial", merchant: "Audible", merchant_key: "audible", amount: 9.95, snippet: `Your 30-day free trial ends on ${dIso(addDays(today, 5))}. After that, your membership is €9.95/month.`, extracted: { trial_end_date: dIso(addDays(today, 5)), billing_cycle: "monthly" } },
    { key: "canva-trial", from_name: "Canva", from_email: "start@engage.canva.com", subject: "Your Canva Pro free trial is active", received_at: iso(addDays(today, -18)), category: "trial", merchant: "Canva", merchant_key: "canva", amount: 11.99, snippet: `Enjoy Canva Pro free until ${dIso(addDays(today, 12))}.`, extracted: { trial_end_date: dIso(addDays(today, 12)), billing_cycle: "monthly" } },
    { key: "ms365-renewal", from_name: "Microsoft", from_email: "microsoft-noreply@microsoft.com", subject: "Your Microsoft 365 Personal subscription will renew soon", received_at: iso(addDays(today, -2)), category: "renewal", merchant: "Microsoft 365", merchant_key: "microsoft-365", amount: 99, snippet: `Your subscription renews automatically on ${dIso(addDays(today, 24))} for €99.00.`, extracted: { renewal_date: dIso(addDays(today, 24)), billing_cycle: "yearly" } },
    { key: "streamz-cancel", from_name: "Streamz", from_email: "noreply@streamz.be", subject: "Bevestiging van je opzegging", received_at: iso(addDays(today, -60)), category: "cancellation", merchant: "Streamz", merchant_key: "streamz", snippet: "We bevestigen dat je abonnement werd stopgezet.", extracted: {} },
    { key: "proximus-bill", from_name: "Proximus", from_email: "e-invoice@proximus.com", subject: "Je factuur van Proximus is beschikbaar", received_at: iso(addDays(today, -3)), category: "bill", merchant: "Proximus", merchant_key: "proximus", amount: 64.99, due_date: dIso(addDays(today, 6)), snippet: "Bedrag: € 64,99 - wordt gedomicilieerd.", extracted: { invoice_number: "2026-1187734" }, is_important: true },
    { key: "engie-bill", from_name: "ENGIE", from_email: "noreply@engie.be", subject: "Je jaarlijkse afrekening", received_at: iso(addDays(today, -5)), category: "bill", merchant: "Engie", merchant_key: "engie", amount: 182.4, due_date: dIso(addDays(today, 12)), snippet: "Saldo te betalen: € 182,40 voor de vervaldag.", extracted: {}, is_important: true },
    { key: "ryanair", from_name: "Ryanair", from_email: "itinerary@ryanair.com", subject: "Your Ryanair booking confirmation FR8KQ2", received_at: iso(addDays(today, -26)), category: "travel", merchant: "Ryanair", merchant_key: "ryanair", amount: 129.98, order_number: "FR8KQ2", event_start: iso(flightDate), snippet: "Charleroi (CRL) → Lisbon (LIS) · 2 passengers", location: "Brussels South Charleroi Airport", extracted: { flight: "FR 8341", from: "CRL", to: "LIS" }, is_important: true },
    { key: "booking", from_name: "Booking.com", from_email: "noreply@booking.com", subject: "Your reservation at Casa do Bairro is confirmed", received_at: iso(addDays(today, -24)), category: "booking", merchant: "Booking.com", merchant_key: "booking", amount: 386, order_number: "4129.773.551", event_start: iso(hotelIn), event_end: iso(hotelOut), location: "Lisbon, Portugal", snippet: "3 nights · €386 payable at the property", extracted: { pay_at_property: true, amount_due: 386 }, is_important: true },
    { key: "thefork", from_name: "TheFork", from_email: "noreply@thefork.com", subject: "Reservation confirmed: Restaurant Zarza, 2 people", received_at: iso(addDays(today, -7)), category: "booking", merchant: "TheFork", merchant_key: "thefork", event_start: iso(dinner), location: "Bondgenotenlaan 92, Leuven", snippet: "Saturday at 19:30 for 2 people", extracted: {} },
    { key: "dentist", from_name: "Tandartsenpraktijk Claes", from_email: "afspraken@tandarts-claes.be", subject: "Herinnering: afspraak bij de tandarts", received_at: iso(addDays(today, -1)), category: "appointment", merchant: "Dentist", merchant_key: "dentist", event_start: iso(dentist), location: "Naamsesteenweg 120, Leuven", snippet: "Controle en reiniging - gelieve 5 minuten vroeger aanwezig te zijn.", extracted: {}, is_important: true },
    { key: "myminfin", from_name: "MyMinfin", from_email: "noreply@minfin.fed.be", subject: "Nieuw document beschikbaar in uw eBox", received_at: iso(addDays(today, -9)), category: "important", merchant: "FOD Financiën / SPF Finances", merchant_key: "fod-financien", due_date: null, snippet: "Uw aanslagbiljet personenbelasting is beschikbaar.", extracted: {}, is_important: true },
    { key: "amazon-prime", from_name: "Amazon.de", from_email: "prime@amazon.de", subject: "Your Amazon Prime membership has renewed", received_at: iso(addDays(today, -120)), category: "renewal", merchant: "Amazon Prime", merchant_key: "amazon-prime", amount: 89.9, snippet: "Thanks for being a Prime member. €89.90 annual fee.", extracted: { billing_cycle: "yearly", renewal_date: dIso(addDays(today, 245)) } },
    { key: "kinepolis", from_name: "Kinepolis", from_email: "tickets@kinepolis.be", subject: "Je tickets voor vrijdag", received_at: iso(addDays(today, -8)), category: "receipt", merchant: "Kinepolis", merchant_key: "kinepolis", amount: 24.4, snippet: "2 tickets · zaal 7 · 20:15", extracted: {} },
    { key: "basicfit", from_name: "Basic-Fit", from_email: "noreply@basic-fit.com", subject: "Je lidmaatschap bij Basic-Fit", received_at: iso(addDays(today, -150)), category: "subscription", merchant: "Basic-Fit", merchant_key: "basic-fit", amount: 29.99, snippet: "Comfort lidmaatschap - € 29,99 per 4 weken.", extracted: { billing_cycle: "monthly" } },
  ];
  const { error: emailErr } = await supabase.from("emails").upsert(
    emails.map((e) => ({
      user_id: userId,
      provider: "demo",
      external_id: `demo-${e.key}`,
      from_name: e.from_name,
      from_email: e.from_email,
      subject: e.subject,
      snippet: e.snippet,
      received_at: e.received_at,
      category: e.category,
      is_important: e.is_important ?? false,
      merchant: e.merchant,
      merchant_key: e.merchant_key,
      amount: e.amount ?? null,
      currency: e.amount ? "EUR" : null,
      order_number: e.order_number ?? null,
      due_date: e.due_date ?? null,
      event_start: e.event_start ?? null,
      event_end: e.event_end ?? null,
      location: e.location ?? null,
      extracted: e.extracted,
      extraction_method: "demo",
      is_demo: true,
    })),
    { onConflict: "user_id,provider,external_id" },
  );
  if (emailErr) throw new Error(`Could not insert demo emails: ${emailErr.message}`);
  const { data: emailIds } = await supabase.from("emails").select("id, external_id").eq("is_demo", true);
  const emailId = (key: string) => emailIds?.find((e) => e.external_id === `demo-${key}`)?.id ?? null;

  // ------------------------------------------------------------------ events
  const nextMonday = addDays(today, ((8 - today.getDay()) % 7) || 7);
  const events = [
    { key: "flight", title: "Flight FR 8341 Charleroi → Lisbon", kind: "flight", starts_at: iso(flightDate), ends_at: iso(at(addDays(today, 18), 8, 50)), location: "Brussels South Charleroi Airport (CRL)", email: "ryanair", calendar: "Travel" },
    { key: "hotel", title: "Casa do Bairro (3 nights)", kind: "hotel", starts_at: iso(hotelIn), ends_at: iso(hotelOut), location: "Lisbon, Portugal", email: "booking", amount_due: 386, payment_due_date: dIso(addDays(today, 18)), calendar: "Travel" },
    { key: "flight-back", title: "Flight FR 8342 Lisbon → Charleroi", kind: "flight", starts_at: iso(at(addDays(today, 21), 18, 40)), location: "Lisbon Airport (LIS)", calendar: "Travel" },
    { key: "dinner", title: "Dinner at Restaurant Zarza", kind: "restaurant", starts_at: iso(dinner), ends_at: iso(at(addDays(today, 2), 22)), location: "Bondgenotenlaan 92, Leuven", email: "thefork", calendar: "Personal" },
    { key: "dentist", title: "Dentist - check-up", kind: "appointment", starts_at: iso(dentist), ends_at: iso(at(addDays(today, 4), 9, 45)), location: "Naamsesteenweg 120, Leuven", email: "dentist", calendar: "Personal" },
    { key: "delivery", title: "bol.com delivery (bpost)", kind: "delivery", starts_at: iso(at(addDays(today, 1), 10)), ends_at: iso(at(addDays(today, 1), 14)), all_day: false, email: "ship-bpost", calendar: "Deliveries" },
    { key: "standup", title: "Weekly planning", kind: "meeting", starts_at: iso(at(nextMonday, 9, 30)), ends_at: iso(at(nextMonday, 10, 15)), location: "Google Meet", calendar: "Work" },
    { key: "review", title: "Quarterly review with Sarah", kind: "meeting", starts_at: iso(at(addDays(today, 3), 14)), ends_at: iso(at(addDays(today, 3), 15)), location: "Office - Room 2.04", calendar: "Work" },
    { key: "birthday", title: "Lotte's birthday drinks", kind: "personal", starts_at: iso(at(addDays(today, 9), 20)), location: "Café Belge, Leuven", calendar: "Personal" },
    { key: "concert", title: "Concert - Ancienne Belgique", kind: "ticket", starts_at: iso(at(addDays(today, 27), 20)), location: "Ancienne Belgique, Brussels", calendar: "Personal" },
    { key: "gym1", title: "Gym - Basic-Fit", kind: "personal", starts_at: iso(at(addDays(today, 1), 18, 30)), ends_at: iso(at(addDays(today, 1), 19, 30)), calendar: "Personal" },
    { key: "gym2", title: "Gym - Basic-Fit", kind: "personal", starts_at: iso(at(addDays(today, 5), 18, 30)), ends_at: iso(at(addDays(today, 5), 19, 30)), calendar: "Personal" },
    { key: "past1", title: "Haircut", kind: "appointment", starts_at: iso(at(addDays(today, -6), 11)), calendar: "Personal" },
  ];
  const { error: evErr } = await supabase.from("events").upsert(
    events.map((e) => ({
      user_id: userId,
      source: "demo",
      external_id: `demo-${e.key}`,
      title: e.title,
      kind: e.kind,
      starts_at: e.starts_at,
      ends_at: e.ends_at ?? null,
      all_day: false,
      location: e.location ?? null,
      email_id: e.email ? emailId(e.email) : null,
      amount_due: e.amount_due ?? null,
      currency: e.amount_due ? "EUR" : null,
      payment_due_date: e.payment_due_date ?? null,
      calendar_name: `${e.calendar} (demo)`,
      is_demo: true,
    })),
    { onConflict: "user_id,source,external_id" },
  );
  if (evErr) throw new Error(`Could not insert demo events: ${evErr.message}`);

  // ------------------------------------------------------------------- tasks
  await supabase.from("tasks").delete().eq("is_demo", true);
  const task = (t: { title: string; due_at: string | null; priority: "low" | "normal" | "high"; is_reminder?: boolean; remind_at?: string | null; completed_at?: string | null }) => ({
    user_id: userId,
    title: t.title,
    due_at: t.due_at,
    priority: t.priority,
    is_reminder: t.is_reminder ?? false,
    remind_at: t.remind_at ?? null,
    completed_at: t.completed_at ?? null,
    is_demo: true,
  });
  const { error: taskErr } = await supabase.from("tasks").insert([
    task({ title: "Check tax assessment in MyMinfin", due_at: iso(at(addDays(today, 3), 18)), priority: "high" }),
    task({ title: "Decide whether to keep Audible before the trial ends", due_at: iso(at(addDays(today, 4), 20)), is_reminder: true, remind_at: iso(at(addDays(today, 4), 9)), priority: "high" }),
    task({ title: "Pay hotel balance at check-in (€386)", due_at: iso(hotelIn), is_reminder: true, priority: "normal" }),
    task({ title: "Renew identity card at the municipality", due_at: iso(at(addDays(today, 20), 12)), priority: "normal" }),
    task({ title: "Return library books", due_at: iso(at(addDays(today, -1), 17)), priority: "low" }),
    task({ title: "Book car service", due_at: null, priority: "low", completed_at: iso(addDays(today, -2)) }),
  ]);
  if (taskErr) throw new Error(`Could not insert demo tasks: ${taskErr.message}`);

  // ----------------------------------------------------------------- budgets
  await supabase.from("budgets").upsert(
    [
      { user_id: userId, category_id: "groceries", amount: 450 },
      { user_id: userId, category_id: "restaurants", amount: 220 },
      { user_id: userId, category_id: "shopping", amount: 250 },
      { user_id: userId, category_id: "transport", amount: 260 },
      { user_id: userId, category_id: "entertainment", amount: 80 },
    ],
    { onConflict: "user_id,category_id", ignoreDuplicates: true },
  );

  return { transactions: txRows.length, emails: emails.length, events: events.length };
}

/** Status changes the demo needs that real detection would never make on its own. */
export async function applyDemoSubscriptionStates(supabase: AppSupabaseClient, userId: string, today = new Date()) {
  // Streamz: cancellation confirmed by email ~2 months ago. Detection rightly
  // ignores a charge stream that stopped, so the record is created here.
  const { data: streamz } = await supabase
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        name: "Streamz",
        provider: "Streamz",
        merchant_key: "streamz",
        category_id: "subscriptions",
        amount: 12.99,
        billing_cycle: "monthly",
        status: "cancelled",
        last_payment_date: toISODate(addDays(today, -78)),
        last_payment_amount: 12.99,
        started_at: toISODate(startOfMonth(addMonths(today, -6))),
        cancellation_requested_at: addDays(today, -62).toISOString(),
        cancellation_confirmed_at: addDays(today, -60).toISOString(),
        cancellation_reference: "Confirmation email from Streamz",
        detection_source: "demo",
        detection_confidence: 0.9,
        charge_count: 4,
        user_confirmed: true,
        is_demo: true,
      },
      { onConflict: "user_id,merchant_key,billing_cycle" },
    )
    .select("id")
    .single();
  if (streamz) await supabase.from("transactions").update({ subscription_id: streamz.id }).eq("merchant_key", "streamz").eq("is_demo", true);
  // Disney+: the user started cancelling but no confirmation yet.
  await supabase
    .from("subscriptions")
    .update({ status: "cancellation_pending", cancellation_requested_at: addDays(today, -2).toISOString(), cancellation_deadline: toISODate(addDays(today, 8)) })
    .eq("merchant_key", "disney-plus")
    .eq("is_demo", true);
  // Mark a couple as reviewed so "possibly forgotten" stays meaningful.
  await supabase.from("subscriptions").update({ user_confirmed: true, last_reviewed_at: addDays(today, -20).toISOString() }).in("merchant_key", ["netflix", "spotify", "proximus", "engie"]).eq("is_demo", true);
  // Payment methods as a bank would report them.
  await supabase.from("subscriptions").update({ payment_method: "KBC Visa Debit •• 7034" }).eq("is_demo", true).is("payment_method", null);
}

export async function clearDemo(supabase: AppSupabaseClient) {
  for (const table of ["notifications", "events", "tasks", "transactions", "subscriptions", "emails", "accounts"] as const) {
    const { error } = await supabase.from(table).delete().eq("is_demo", true);
    if (error) throw new Error(`Could not remove demo ${table}: ${error.message}`);
  }
}
