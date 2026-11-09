import { describe, expect, it } from "vitest";
import { classifyCategory, extractEmail, isLikelyRelevant, type EmailInput } from "./classify";
import { findDates, findMoney, findOrderNumber, parseAmount, pickAmount, zonedIso, findTime } from "./extract";
import { decodeBase64Url, extractBodyText, htmlToText, parseFrom } from "./mime";

const received = new Date("2026-11-09T09:00:00Z");
const mail = (partial: Partial<EmailInput>): EmailInput => ({
  subject: "",
  fromName: null,
  fromEmail: null,
  snippet: "",
  body: "",
  receivedAt: received,
  labelIds: ["INBOX", "CATEGORY_UPDATES"],
  ...partial,
});

describe("amount parsing", () => {
  it("handles European and English formats", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("12,99")).toBe(12.99);
    expect(parseAmount("15.99")).toBe(15.99);
    expect(parseAmount("1 234,56")).toBe(1234.56);
    expect(parseAmount("1.234")).toBe(1234);
    expect(parseAmount("12,-")).toBe(12);
  });

  it("finds money with symbols before or after", () => {
    const found = findMoney("Totaal: € 64,99 · EUR 12,50 · 1.234,56 € · USD 20.00").map((m) => [m.amount, m.currency]);
    expect(found).toEqual([
      [64.99, "EUR"],
      [12.5, "EUR"],
      [1234.56, "EUR"],
      [20, "USD"],
    ]);
  });

  it("prefers the labelled total over item prices", () => {
    expect(pickAmount("USB-C hub € 29,99\nNotitieboek € 12,99\nVerzending € 0,00\nTotaal € 42,98")?.amount).toBe(42.98);
    expect(pickAmount("Montant total à payer : 182,40 €")?.amount).toBe(182.4);
  });
});

describe("date parsing", () => {
  it("parses ISO, numeric and written dates in three languages", () => {
    const dates = (t: string) => findDates(t, received).map((d) => d.date);
    expect(dates("on 2026-11-14")).toEqual(["2026-11-14"]);
    expect(dates("vervaldag 21/11/2026")).toEqual(["2026-11-21"]);
    expect(dates("tot 12 december 2026")).toEqual(["2026-12-12"]);
    expect(dates("le 3 janvier 2027")).toEqual(["2027-01-03"]);
    expect(dates("Renews on Nov 30, 2026")).toEqual(["2026-11-30"]);
    expect(dates("arriving 2 Jan")).toEqual(["2027-01-02"]); // year inferred forward
  });

  it("reads times and converts Brussels wall time to UTC", () => {
    expect(findTime("om 19u30")).toEqual({ h: 19, m: 30 });
    expect(findTime("at 7:05 PM")).toEqual({ h: 19, m: 5 });
    expect(zonedIso("2026-11-27", 7, 5)).toBe("2026-11-27T06:05:00.000Z"); // CET (UTC+1)
    expect(zonedIso("2026-07-01", 9, 0)).toBe("2026-07-01T07:00:00.000Z"); // CEST (UTC+2)
  });

  it("extracts order numbers but not dates or prices", () => {
    expect(findOrderNumber("Bedankt voor je bestelling 4012-338-912")).toBe("4012-338-912");
    expect(findOrderNumber("Booking confirmation FR8KQ2 for 2 passengers")).toBe("FR8KQ2");
    expect(findOrderNumber("Numéro de commande : 302-1234567-7654321")).toBe("302-1234567-7654321");
    expect(findOrderNumber("Order total 12.99")).toBeNull();
  });
});

describe("MIME helpers", () => {
  it("decodes base64url bodies and walks multipart payloads", () => {
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
    const text = extractBodyText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("View in browser") } },
        { mimeType: "text/html", body: { data: b64("<html><head><style>.x{}</style></head><body><p>Totaal&nbsp;&euro;&nbsp;42,98</p><p>Bestelling 4012-338-912</p></body></html>") } },
        { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "x" } },
      ],
    });
    expect(text).toContain("Totaal € 42,98");
    expect(text).toContain("Bestelling 4012-338-912");
    expect(decodeBase64Url(b64("héllo €"))).toBe("héllo €");
    expect(htmlToText("<div>a</div><div>b</div>")).toBe("a\nb");
  });

  it("parses From headers", () => {
    expect(parseFrom('"Zalando" <info@service-mail.zalando.be>')).toEqual({ name: "Zalando", email: "info@service-mail.zalando.be" });
    expect(parseFrom("noreply@bpost.be")).toEqual({ name: null, email: "noreply@bpost.be" });
  });
});

describe("classification + extraction (fixtures)", () => {
  it("bol.com order confirmation (nl)", () => {
    const x = extractEmail(
      mail({
        fromName: "bol.com",
        fromEmail: "klantenservice@bol.com",
        subject: "Bedankt voor je bestelling 4012-338-912",
        snippet: "Je bestelling wordt morgen geleverd.",
        body: "Hoi Alex,\nBedankt voor je bestelling!\nUSB-C hub € 29,99\nNotitieboek A5 € 12,99\nTotaal € 42,98\nBetaald met Bancontact.\nJe bestelling wordt morgen geleverd.",
      }),
    );
    expect(x.category).toBe("order");
    expect(x.merchantKey).toBe("bol");
    expect(x.amount).toBe(42.98);
    expect(x.orderNumber).toBe("4012-338-912");
    expect(x.details.delivery_date).toBe("2026-11-10");
    expect(x.details.payment_method).toBe("Bancontact");
  });

  it("bpost shipping notice attributes the shop, not the carrier", () => {
    const x = extractEmail(
      mail({
        fromName: "bpost",
        fromEmail: "noreply@bpost.be",
        subject: "Je pakje van bol.com komt morgen aan",
        snippet: "Track & trace 3232 1234 5678 9012. Verwachte levering tussen 10:00 en 14:00.",
        body: "Je pakje van bol.com komt morgen aan.\nTrack & trace: 3232 1234 5678 9012\nVerwachte levering op 10/11/2026 tussen 10:00 en 14:00.",
      }),
    );
    expect(x.category).toBe("shipping");
    expect(x.merchant).toBe("bol.com");
    expect(x.details.carrier).toBe("bpost");
    expect(x.details.tracking_number).toBe("3232123456789012");
    expect(x.details.delivery_date).toBe("2026-11-10");
    expect(x.eventKind).toBe("delivery");
  });

  it("Proximus bill with due date (nl)", () => {
    const x = extractEmail(
      mail({
        fromName: "Proximus",
        fromEmail: "e-invoice@proximus.com",
        subject: "Je factuur van Proximus is beschikbaar",
        snippet: "Bedrag: € 64,99 - wordt gedomicilieerd op 21/11/2026.",
        body: "Factuurnummer: 2026-1187734\nTe betalen bedrag: € 64,99\nDit bedrag wordt gedomicilieerd op 21/11/2026.",
      }),
    );
    expect(x.category).toBe("bill");
    expect(x.isImportant).toBe(true);
    expect(x.merchantKey).toBe("proximus");
    expect(x.amount).toBe(64.99);
    expect(x.dueDate).toBe("2026-11-21");
  });

  it("Engie bill in French with échéance", () => {
    const x = extractEmail(
      mail({
        fromName: "ENGIE",
        fromEmail: "noreply@engie.be",
        subject: "Votre facture de régularisation",
        snippet: "Montant total à payer : 182,40 €",
        body: "Montant total à payer : 182,40 €\nDate d'échéance : 21 novembre 2026",
      }),
    );
    expect(x.category).toBe("bill");
    expect(x.amount).toBe(182.4);
    expect(x.dueDate).toBe("2026-11-21");
  });

  it("Coolblue paid invoice is a receipt", () => {
    const x = extractEmail(
      mail({ fromName: "Coolblue", fromEmail: "noreply@coolblue.be", subject: "Je factuur voor bestelling 91827364", snippet: "Sony WH-1000XM6 - € 329,00. Betaald met Bancontact." }),
    );
    expect(x.category).toBe("receipt");
    expect(x.amount).toBe(329);
    expect(x.merchantKey).toBe("coolblue");
  });

  it("Audible free trial (en) with end date and price after trial", () => {
    const x = extractEmail(
      mail({
        fromName: "Audible",
        fromEmail: "noreply@audible.de",
        subject: "Welcome to Audible - your free trial has started",
        snippet: "Your 30-day free trial ends on 14 November 2026. After that, your membership is €9.95/month.",
      }),
    );
    expect(x.category).toBe("trial");
    expect(x.details.trial_end_date).toBe("2026-11-14");
    expect(x.details.billing_cycle).toBe("monthly");
    expect(x.amount).toBe(9.95);
  });

  it("French trial (essai gratuit)", () => {
    const x = extractEmail(mail({ fromName: "Deezer", subject: "Votre essai gratuit se termine bientôt", snippet: "Votre période d'essai prend fin le 20 novembre 2026, ensuite 11,99 € par mois." }));
    expect(x.category).toBe("trial");
    expect(x.details.trial_end_date).toBe("2026-11-20");
    expect(x.merchantKey).toBe("deezer");
  });

  it("Netflix price change is a renewal with old/new price", () => {
    const x = extractEmail(
      mail({ fromName: "Netflix", fromEmail: "info@account.netflix.com", subject: "We're updating your Netflix price", snippet: "Your Standard plan will go from €13.99 to €15.99/month starting with your next billing date, December 7, 2026." }),
    );
    expect(x.category).toBe("renewal");
    expect(x.details.old_price).toBe(13.99);
    expect(x.details.new_price).toBe(15.99);
    expect(x.amount).toBe(15.99);
    expect(x.details.renewal_date).toBe("2026-12-07");
  });

  it("Streamz cancellation confirmation (nl)", () => {
    const x = extractEmail(mail({ fromName: "Streamz", fromEmail: "noreply@streamz.be", subject: "Bevestiging van je opzegging", snippet: "We bevestigen dat je abonnement werd stopgezet." }));
    expect(x.category).toBe("cancellation");
    expect(x.merchantKey).toBe("streamz");
  });

  it("Ryanair booking is travel with a flight event in Brussels time", () => {
    const x = extractEmail(
      mail({
        fromName: "Ryanair",
        fromEmail: "itinerary@ryanair.com",
        subject: "Your Ryanair booking confirmation FR8KQ2",
        snippet: "Charleroi (CRL) → Lisbon (LIS) · 2 passengers",
        body: "Reservation number: FR8KQ2\nFlight FR 8341\nBrussels South Charleroi (CRL) → Lisbon (LIS)\nDeparture: 27 November 2026 at 07:05\nTotal paid: €129.98",
      }),
    );
    expect(x.category).toBe("travel");
    expect(x.isImportant).toBe(true);
    expect(x.eventKind).toBe("flight");
    expect(x.details.flight).toBe("FR 8341");
    expect([x.details.from, x.details.to]).toEqual(["CRL", "LIS"]);
    expect(x.eventStart).toBe("2026-11-27T06:05:00.000Z");
    expect(x.amount).toBe(129.98);
    expect(x.orderNumber).toBe("FR8KQ2");
  });

  it("Booking.com hotel with pay-at-property amount and check-out", () => {
    const x = extractEmail(
      mail({
        fromName: "Booking.com",
        fromEmail: "noreply@booking.com",
        subject: "Your reservation at Casa do Bairro is confirmed",
        snippet: "3 nights · €386 payable at the property",
        body: "Booking number: 4129.773.551\nCheck-in: Friday 27 November 2026 (from 15:00)\nCheck-out: Monday 30 November 2026 (until 11:00)\nAddress: Rua da Rosa 12, Lisbon\nTotal price: € 386\nYou'll pay at the property.",
      }),
    );
    expect(x.category).toBe("booking");
    expect(x.eventKind).toBe("hotel");
    expect(x.details.pay_at_property).toBe(true);
    expect(x.details.amount_due).toBe(386);
    expect(x.eventStart).toBe("2026-11-27T14:00:00.000Z");
    expect(x.eventEnd).toBe("2026-11-30T10:00:00.000Z");
    expect(x.location).toContain("Rua da Rosa 12");
  });

  it("dentist appointment reminder (nl)", () => {
    const x = extractEmail(
      mail({
        fromName: "Tandartsenpraktijk Claes",
        fromEmail: "afspraken@tandarts-claes.be",
        subject: "Herinnering: afspraak bij de tandarts",
        snippet: "Uw afspraak op 13/11/2026 om 09:15.",
        body: "Beste,\nUw afspraak is op 13/11/2026 om 09:15.\nAdres: Naamsesteenweg 120, 3001 Leuven",
      }),
    );
    expect(x.category).toBe("appointment");
    expect(x.eventKind).toBe("appointment");
    expect(x.eventStart).toBe("2026-11-13T08:15:00.000Z");
    expect(x.location).toBe("Naamsesteenweg 120, 3001 Leuven");
    expect(x.merchant).toBe("Tandartsenpraktijk Claes");
  });

  it("Zalando refund is a purchase update", () => {
    const x = extractEmail(mail({ fromName: "Zalando", subject: "We hebben je retour ontvangen - terugbetaling € 79,95", snippet: "Je terugbetaling wordt binnen 3 werkdagen verwerkt." }));
    expect(x.category).toBe("purchase");
    expect(x.details.refund).toBe(true);
    expect(x.amount).toBe(79.95);
  });

  it("MyMinfin notice is important", () => {
    const x = classifyCategory(mail({ fromName: "MyMinfin", subject: "Nieuw document beschikbaar in uw eBox", snippet: "Uw aanslagbiljet personenbelasting is beschikbaar." }));
    expect(x.isImportant).toBe(true);
  });

  it("ignores marketing and promotions", () => {
    expect(isLikelyRelevant(mail({ fromName: "Spotify", subject: "Start your free trial of Premium today - 50% off", snippet: "Limited time offer" }))).toBe(false);
    expect(isLikelyRelevant(mail({ fromName: "Shop", subject: "Your order has shipped", labelIds: ["CATEGORY_PROMOTIONS"] }))).toBe(false);
    expect(isLikelyRelevant(mail({ fromName: "Lotte", subject: "Drinks zaterdag?", snippet: "Zin om iets te drinken?" }))).toBe(false);
  });
});
