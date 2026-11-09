import type { EventKind } from "@/lib/types";

/**
 * Infers what kind of event something is from its title, location and
 * description. Covers Dutch, French and English wording common in Belgium.
 * Order matters: the most specific kinds are checked first.
 */
const RULES: [EventKind, RegExp][] = [
  [
    "flight",
    /\bflight\b|\bvlucht\b|\bvol\s+(?:[a-z]{2}\s?\d|n[°o]|\d)|boarding|\bgate\s+[a-z]?\d|ryanair|brussels airlines|transavia|easyjet|lufthansa|\bklm\b|tui\s*fly|\b(?:fr|sn|kl|lh|hv|u2|tb|af|ba|lx|ib|vy)\s?\d{3,4}\b|✈/i,
  ],
  [
    "hotel",
    /\bhot[eè]l\b|airbnb|booking\.com|\bcheck[\s-]?(?:in|out)\b|overnachting|\bb\s?&\s?b\b|hostel|\bresort\b|\bnights?\)|\bnachten\b|\bnuits?\b/i,
  ],
  [
    "restaurant",
    /restaurant|\bresto\b|\bdinner\b|\bdiner\b|\bd[iî]ner\b|\blunch\b|\bbrunch\b|etentje|\beten\b|brasserie|bistro|thefork|lafourchette|r[ée]servation\s+(?:au|chez)|table\s+for/i,
  ],
  ["delivery", /deliver|levering|leverin|livraison|\bpakje\b|\bpackage\b|\bparcel\b|\bcolis\b|\bbpost\b|\bdhl\b|postnl|\bups\b|\bgls\b|\bdpd\b/i],
  [
    "appointment",
    /dentist|tandarts|dentiste|\bdoctor\b|\bdokter\b|huisarts|m[ée]decin|\bkapper\b|coiffeur|haircut|appointment|\bafspraak\b|rendez-vous|\brdv\b|\bkin[eé]\b|physio|optic|dierenarts|\bvet\b|v[ée]t[ée]rinaire|ziekenhuis|h[oô]pital|hospital|check-?up|consult/i,
  ],
  [
    "ticket",
    /concert|festival|\btickets?\b|\btheat(?:er|re)\b|th[ée][âa]tre|cinema|cin[ée]ma|kinepolis|\bmatch\b|voorstelling|spectacle|\bshow\b|\bopera\b|museum|mus[ée]e|ancienne belgique|sportpaleis|forest national|vorst nationaal/i,
  ],
  [
    "meeting",
    /meeting|vergadering|r[ée]union|\bcall\b|stand-?up|\bsync\b|\b1[:-]1\b|one[\s-]on[\s-]one|\breview\b|interview|sollicitatie|entretien|workshop|webinar|\bzoom\b|google meet|meet\.google|teams\.microsoft|\bteams\b|\bplanning\b|kick-?off|retro/i,
  ],
  ["payment", /\bpayment\b|\bbetaling\b|\bpaiement\b|invoice|factuur|facture|vervaldag|[ée]ch[ée]ance|\bdue\b|\bhuur\b|\bloyer\b|\brent\b|belasting|imp[ôo]ts?/i],
  ["travel", /\btrip\b|\breis\b|voyage|vacation|vakantie|vacances|holiday|\btrain\b|\btrein\b|eurostar|thalys|airport|luchthaven|a[ée]roport|\bgare\b|station\s/i],
  ["personal", /birthday|verjaardag|anniversaire|\bparty\b|\bfeest\b|\bdrinks?\b|\bgym\b|basic-?fit|\bsport\b|training|\byoga\b|\brun(?:ning)?\b|family|familie|famille|\bbbq\b|barbecue/i],
];

export function inferEventKind(title?: string | null, location?: string | null, description?: string | null): EventKind {
  const primary = `${title ?? ""} ${location ?? ""}`;
  for (const [kind, re] of RULES) if (re.test(primary)) return kind;
  // Descriptions are long and noisy; only use them for the clearest kinds.
  const desc = (description ?? "").slice(0, 600);
  for (const [kind, re] of RULES) {
    if ((kind === "flight" || kind === "hotel" || kind === "meeting") && re.test(desc)) return kind;
  }
  return "other";
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  flight: "Flight",
  hotel: "Hotel",
  restaurant: "Restaurant",
  appointment: "Appointment",
  meeting: "Meeting",
  ticket: "Tickets",
  delivery: "Delivery",
  payment: "Payment",
  travel: "Travel",
  personal: "Personal",
  other: "Other",
};

export const EVENT_KINDS = Object.keys(EVENT_KIND_LABEL) as EventKind[];
