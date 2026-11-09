/**
 * Rule-based field extraction for transactional emails in Dutch, French and
 * English. Pure functions; every date is returned as YYYY-MM-DD (or ISO
 * datetime for events, interpreted in Europe/Brussels local time).
 */

export const TIME_ZONE = "Europe/Brussels";

// ---------------------------------------------------------------- amounts

export interface MoneyMatch {
  amount: number;
  currency: string;
  index: number;
}

const CURRENCY_SYMBOL: Record<string, string> = { "€": "EUR", eur: "EUR", euro: "EUR", euros: "EUR", $: "USD", usd: "USD", "£": "GBP", gbp: "GBP", chf: "CHF" };

/** Parses "1.234,56", "1,234.56", "12,99", "15.99", "1 234,56", "329" into a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s  ']/g, "").replace(/,-$/, "");
  if (!/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const count = (ch: string) => s.split(ch).length - 1;
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,234" / "1,234,567" are thousands; "12,99" / "12,9" are decimals.
    s = count(",") > 1 || s.length - lastComma - 1 === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot > -1) {
    if (count(".") > 1 || (s.length - lastDot - 1 === 3 && s.length > 4)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const NUM = String.raw`\d{1,3}(?:[.,\s  ]\d{3})*(?:[.,]\d{1,2})?(?![\d])|\d+(?:[.,]\d{1,2})?(?![\d])`;
const MONEY_PATTERNS: RegExp[] = [
  new RegExp(String.raw`(€|EUR|USD|GBP|CHF|\$|£)\s?(${NUM}|\d+,-)`, "gi"),
  new RegExp(String.raw`(?<![\d.,])(${NUM})\s?(€|EUR|euros?|USD|GBP|CHF)(?![a-z])`, "gi"),
];

export function findMoney(text: string): MoneyMatch[] {
  const out: MoneyMatch[] = [];
  const seen = new Set<number>();
  for (const pattern of MONEY_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text))) {
      const symbolFirst = /[^\d\s]/.test(m[1][0]) && !/^\d/.test(m[1]);
      const symbol = (symbolFirst ? m[1] : m[2]).toLowerCase();
      const raw = symbolFirst ? m[2] : m[1];
      const amount = parseAmount(raw);
      if (amount === null || amount <= 0 || amount > 1_000_000) continue;
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      out.push({ amount, currency: CURRENCY_SYMBOL[symbol] ?? "EUR", index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

const TOTAL_WORDS = /\b(total|totaal|totaalbedrag|te betalen|à payer|a payer|montant|bedrag|amount|saldo|charged|betaald|paid|payé|grand total|order total|you paid|price|prijs|prix|membership is|subscription is|per maand|\/month|per month|par mois)\b/i;

/** Picks the amount that most plausibly is "the" total: labelled amounts first, else the largest. */
export function pickAmount(text: string): MoneyMatch | null {
  const all = findMoney(text);
  if (all.length === 0) return null;
  const labelled = all.filter((m) => TOTAL_WORDS.test(text.slice(Math.max(0, m.index - 40), m.index + 4)));
  const strong = labelled.filter((m) => /total|totaal|te betalen|à payer|a payer|saldo|you paid|grand/i.test(text.slice(Math.max(0, m.index - 40), m.index)));
  if (strong.length) return strong.reduce((a, b) => (b.amount > a.amount ? b : a));
  if (labelled.length) return labelled[0];
  return all.reduce((a, b) => (b.amount > a.amount ? b : a));
}

// ------------------------------------------------------------------ dates

const MONTHS: Record<string, number> = {};
const monthNames: [number, string[]][] = [
  [1, ["january", "jan", "januari", "janvier", "janv"]],
  [2, ["february", "feb", "februari", "février", "fevrier", "févr", "fevr"]],
  [3, ["march", "mar", "maart", "mrt", "mars"]],
  [4, ["april", "apr", "avril", "avr"]],
  [5, ["may", "mei", "mai"]],
  [6, ["june", "jun", "juni", "juin"]],
  [7, ["july", "jul", "juli", "juillet", "juil"]],
  [8, ["august", "aug", "augustus", "août", "aout"]],
  [9, ["september", "sep", "sept", "septembre"]],
  [10, ["october", "oct", "oktober", "okt", "octobre"]],
  [11, ["november", "nov", "novembre"]],
  [12, ["december", "dec", "decembre", "décembre", "déc"]],
];
for (const [n, names] of monthNames) for (const name of names) MONTHS[name] = n;
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

export interface DateMatch {
  date: string; // YYYY-MM-DD
  index: number;
  length: number;
  yearInferred: boolean;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** For dates without a year, choose the year that puts the date closest after (ref - 60 days). */
function inferYear(m: number, d: number, ref: Date): number {
  const y = ref.getUTCFullYear();
  const candidate = Date.UTC(y, m - 1, d);
  return candidate < ref.getTime() - 60 * 86_400_000 ? y + 1 : y;
}

export function findDates(text: string, ref: Date = new Date()): DateMatch[] {
  const out: DateMatch[] = [];
  const push = (date: string | null, index: number, length: number, yearInferred = false) => {
    if (date && !out.some((o) => o.index === index)) out.push({ date, index, length, yearInferred });
  };
  let m: RegExpExecArray | null;

  const isoRe = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;
  while ((m = isoRe.exec(text))) push(iso(+m[1], +m[2], +m[3]), m.index, m[0].length);

  // 14/11/2026, 14-11-2026, 14.11.2026 (day first - European)
  const numRe = /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/g;
  while ((m = numRe.exec(text))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    push(iso(y, +m[2], +m[1]), m.index, m[0].length);
  }

  // 14 november 2026 / 14 nov. 2026 / 14 novembre / le 14 nov
  const dmy = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th|er|e)?\.?\s+(${MONTH_RE})\.?(?:,?\s+(20\d{2}))?\b`, "gi");
  while ((m = dmy.exec(text))) {
    const month = MONTHS[m[2].toLowerCase()];
    const d = +m[1];
    const y = m[3] ? +m[3] : inferYear(month, d, ref);
    push(iso(y, month, d), m.index, m[0].length, !m[3]);
  }

  // November 14, 2026 / Nov 14 2026 / Nov 14
  const mdy = new RegExp(String.raw`\b(${MONTH_RE})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b`, "gi");
  while ((m = mdy.exec(text))) {
    const month = MONTHS[m[1].toLowerCase()];
    const d = +m[2];
    const y = m[3] ? +m[3] : inferYear(month, d, ref);
    push(iso(y, month, d), m.index, m[0].length, !m[3]);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** First date whose preceding context (up to `window` chars) matches `keywords`. */
export function dateNear(text: string, keywords: RegExp, ref: Date = new Date(), window = 70): DateMatch | null {
  for (const d of findDates(text, ref)) {
    const before = text.slice(Math.max(0, d.index - window), d.index);
    if (keywords.test(before)) return d;
  }
  return null;
}

/** Time of day right after a date (or anywhere if `from` not given): 19:30, 19u30, 7:05 PM, 07h05. */
export function findTime(text: string, from = 0, window = 60): { h: number; m: number } | null {
  const slice = text.slice(from, from + window);
  const re = /\b(\d{1,2})\s?[:hu.]\s?(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?!\d)/i;
  const m = slice.match(re);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const ampm = m[3]?.toLowerCase().replace(/\./g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/** Converts a wall-clock time in Europe/Brussels into a UTC ISO string. */
export function zonedIso(date: string, h = 0, m = 0, tz = TIME_ZONE): string {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  const offset = asIfUtc - guess;
  return new Date(guess - offset).toISOString();
}

// ------------------------------------------------------------- identifiers

const ORDER_RE =
  /\b(?:order|bestel(?:ling)?|commande|booking|boeking|reservation|reservering|réservation|confirmation|bevestigings?|invoice|factuur|facture|dossier|referentie|référence|reference|ref\.?|pnr)\s*(?:number|nummer|nr\.?|no\.?|n[°º]\.?|#|code|id)?\s*[:#]?\s*((?=[A-Z0-9.\-]*\d)[A-Z0-9][A-Z0-9.\-]{4,22}[A-Z0-9])\b/i;

export function findOrderNumber(text: string): string | null {
  const m = text.match(ORDER_RE);
  if (!m) return null;
  const value = m[1].replace(/\.$/, "");
  // Exclude things that are clearly dates or amounts.
  if (/^\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}$/.test(value) || /^\d{1,4}[.,]\d{2}$/.test(value)) return null;
  return value;
}

export function findFlight(text: string): { flight: string; from?: string; to?: string } | null {
  const f = text.match(/\b(?:flight|vlucht|vol)\s*(?:number|nummer|n[°º])?\s*:?\s*([A-Z0-9]{2})\s?(\d{2,4})\b/i);
  const route = text.match(/\(([A-Z]{3})\)\s*(?:→|->|-|to|naar|vers|à)\s*[^()\n]{0,40}\(([A-Z]{3})\)/) ?? text.match(/\b([A-Z]{3})\s*(?:→|->|–|-)\s*([A-Z]{3})\b/);
  if (!f && !route) return null;
  return { flight: f ? `${f[1].toUpperCase()} ${f[2]}` : "", from: route?.[1], to: route?.[2] };
}

export const CARRIERS: { name: string; re: RegExp }[] = [
  { name: "bpost", re: /\bbpost\b/i },
  { name: "PostNL", re: /postnl/i },
  { name: "DHL", re: /\bdhl\b/i },
  { name: "DPD", re: /\bdpd\b/i },
  { name: "GLS", re: /\bgls\b/i },
  { name: "UPS", re: /\bups\b(?![a-z])/i },
  { name: "FedEx", re: /fedex/i },
  { name: "Mondial Relay", re: /mondial\s*relay/i },
];

export function findCarrier(text: string): string | null {
  return CARRIERS.find((c) => c.re.test(text))?.name ?? null;
}

export function findTracking(text: string): string | null {
  const m = text.match(/(?:track(?:ing)?(?:\s*&\s*trace)?|track\s*&\s*trace|zending|colis|suivi|barcode|tracking number|trackingnummer)\s*(?:number|nummer|code|n[°º])?\s*[:#]?\s*([A-Z0-9][A-Z0-9 ]{8,30}[A-Z0-9])\b/i);
  if (!m) return null;
  const v = m[1].replace(/\s+/g, "");
  return /\d{6,}/.test(v) ? v : null;
}

export function findBillingCycle(text: string): "weekly" | "monthly" | "quarterly" | "yearly" | null {
  if (/per\s+4\s+weken|every\s+4\s+weeks|toutes\s+les\s+4\s+semaines|\/\s*4\s*weken/i.test(text)) return "monthly";
  if (/\/\s?(month|maand|mois|mo)\b|per\s+(month|maand)|par\s+mois|monthly|maandelijks|mensuel|each month|every month|elke maand/i.test(text)) return "monthly";
  if (/\/\s?(year|jaar|an|yr)\b|per\s+(year|jaar)|par\s+an|annual|yearly|jaarlijks|annuel|each year|every year|elk jaar/i.test(text)) return "yearly";
  if (/quarterly|per\s+kwartaal|trimestriel/i.test(text)) return "quarterly";
  if (/\/\s?(week|wk)\b|per\s+week|weekly|wekelijks|hebdomadaire/i.test(text)) return "weekly";
  return null;
}

/** "from €13.99 to €15.99" / "van € 13,99 naar € 15,99" / "de 13,99 € à 15,99 €" */
export function findPriceChange(text: string): { old_price: number; new_price: number } | null {
  const money = String.raw`(?:€|EUR)?\s?(\d+(?:[.,]\d{1,2})?)\s?(?:€|EUR)?`;
  const re = new RegExp(String.raw`(?:from|van|de)\s+${money}\s+(?:to|naar|à|a)\s+${money}`, "i");
  const m = text.match(re);
  if (!m) return null;
  const a = parseAmount(m[1]);
  const b = parseAmount(m[2]);
  return a && b && a !== b ? { old_price: a, new_price: b } : null;
}
