import type { TransactionKind } from "@/lib/types";
import { normaliseMerchant, type MerchantEntry } from "./merchants";

export interface CategoryRule {
  pattern: string;
  category_id: string;
}

export interface RawTransaction {
  amount: number; // signed, negative = outflow
  description?: string | null;
  counterpartyName?: string | null;
  counterpartyIbanHash?: string | null;
  mcc?: string | null;
}

export interface Classification {
  kind: TransactionKind;
  categoryId: string;
  categorySource: "auto" | "rule";
  merchant: string;
  merchantKey: string;
  catalogEntry?: MerchantEntry;
}

const TRANSFER_WORDS =
  /eigen\s+rekening|naar\s+(mijn\s+)?spaar|van\s+(mijn\s+)?spaar|spaarrekening|own\s+account|between\s+(my\s+)?accounts|compte\s+(propre|d['’]?[ée]pargne)|virement\s+(interne|vers\s+[ée]pargne)|transfer\s+to\s+savings|savings\s+transfer|overschrijving\s+eigen/i;
const CASH_WORDS = /geldopneming|geldautomaat|retrait\s+(d['’]?argent|bancontact|esp[eè]ces)|\batm\b|cash\s+withdrawal|withdrawal|bancontact\s+cash|opname\s+cash/i;
const SALARY_WORDS = /\b(loon|salaris|salaire|wedde|payroll|salary|r[ée]mun[ée]ration|maandloon|vakantiegeld|p[ée]cule|eindejaarspremie)\b/i;
const BENEFIT_WORDS = /groeipakket|famiris|famiwal|kids\s*life|kinderbijslag|allocations?\s+familiales|\brva\b|\bonem\b|uitkering/i;
const REFUND_WORDS = /terugbetaling|remboursement|refund|retour|teruggave|rembourse|reimburse|credit\s+note|creditnota/i;
const RENT_WORDS = /\b(huur|loyer|rent)\b|syndic|woonkrediet|hypothe|cr[ée]dit\s+hypoth/i;
const TAX_WORDS = /belasting|imp[ôo]ts?\b|fod\s*financi|spf\s*finances|myminfin|tax\s*(refund|return)|vlaamse\s*belastingdienst/i;
// Generic shop types for merchants that aren't in the catalogue (keeps the merchant name, sets the category).
const KEYWORD_CATEGORIES: [RegExp, string][] = [
  [/\b(bakkerij|bakker|boulangerie|p[âa]tisserie|bakery|slagerij|beenhouwerij|boucherie|butcher|kaashandel|fromagerie|groentenwinkel|primeur|supermarkt|supermarch[ée]|[ée]picerie|nachtwinkel|night\s*shop)\b/i, "groceries"],
  [/\b(restaurant|resto|brasserie|bistro|caf[ée]|eetcaf[ée]|frituur|friterie|frietkot|pizzeria|sushi|kebab|snack|tearoom|lunchbar|bar\s|pub\b|taverne)/i, "restaurants"],
  [/\b(apotheek|pharmacie|tandarts|dentiste|kinesist|kin[ée]|fysio|opticien|optiek|huisarts|dokter|m[ée]decin|fitness|sportschool|yoga|padel)\b/i, "health"],
  [/\b(parking|parkeer|taxi|tankstation|station\s*service|carwash|garage)\b/i, "transport"],
  [/\b(hotel|h[ôo]tel|camping|airline|luchthaven|a[ée]roport|airport)\b/i, "travel"],
  [/\b(cinema|bioscoop|cin[ée]ma|theater|th[ée][âa]tre|concert|museum|mus[ée]e|ticket)/i, "entertainment"],
  [/\b(boekhandel|librairie|bookshop|kledij|v[êe]tements|schoenen|chaussures|electro|meubel|meubles|tuincentrum|jardinerie)\b/i, "shopping"],
];
const FEE_WORDS = /\b(kosten|frais|fee|charges?\s+bancaires|beheerskosten|rekeningkosten|commission)\b/i;

// ISO 18245 merchant category codes -> category
function categoryFromMcc(mcc: string | null | undefined): string | undefined {
  if (!mcc) return undefined;
  const code = Number(mcc);
  if (!Number.isFinite(code)) return undefined;
  if (code === 6010 || code === 6011) return "cash";
  if ([5411, 5422, 5441, 5451, 5462, 5499].includes(code)) return "groceries";
  if ([5812, 5813, 5814].includes(code)) return "restaurants";
  if ((code >= 3000 && code <= 3350) || (code >= 3501 && code <= 3999) || [4411, 4511, 4722, 7011, 7012].includes(code)) return "travel";
  if ([4111, 4112, 4121, 4131, 4784, 5541, 5542, 5552, 7523, 7512].includes(code)) return "transport";
  if ([4814, 4900, 6300].includes(code)) return "bills";
  if ([4899, 5815, 5816, 5817, 5818].includes(code)) return "subscriptions";
  if ([7832, 7922, 7929, 7991, 7996, 7999, 5735].includes(code)) return "entertainment";
  if ([5912, 8011, 8021, 8031, 8042, 8043, 8049, 8062, 8099, 7997, 7298].includes(code)) return "health";
  if ((code >= 5300 && code <= 5399) || (code >= 5600 && code <= 5699) || (code >= 5700 && code <= 5799) || (code >= 5900 && code <= 5999) || [5200, 5251, 5261, 5311, 5331, 5732, 5734, 5942, 5945].includes(code)) return "shopping";
  if ([6513].includes(code)) return "housing";
  return undefined;
}

function applyUserRules(text: string, rules: CategoryRule[]): string | undefined {
  const lower = text.toLowerCase();
  // Longest pattern wins so specific rules beat generic ones.
  const sorted = [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
  return sorted.find((r) => lower.includes(r.pattern.toLowerCase()))?.category_id;
}

/**
 * Classify one transaction. Pure function; the caller supplies the user's
 * own-account IBAN hashes so transfers between own accounts are recognised.
 */
export function classifyTransaction(
  tx: RawTransaction,
  opts: { rules?: CategoryRule[]; ownIbanHashes?: Set<string>; incomeCategories?: Set<string> } = {},
): Classification {
  const rules = opts.rules ?? [];
  const text = [tx.counterpartyName, tx.description].filter(Boolean).join(" ");
  const merchant = normaliseMerchant(tx.counterpartyName, tx.description);
  const base = { merchant: merchant.name, merchantKey: merchant.key, catalogEntry: merchant.entry };
  const inflow = tx.amount > 0;

  // 1. Transfers between the user's own accounts never count as income/expense.
  if (tx.counterpartyIbanHash && opts.ownIbanHashes?.has(tx.counterpartyIbanHash)) {
    return { ...base, kind: "transfer", categoryId: "transfers", categorySource: "auto" };
  }
  if (TRANSFER_WORDS.test(text)) {
    return { ...base, kind: "transfer", categoryId: "transfers", categorySource: "auto" };
  }

  // 2. User rules win over everything else.
  const ruleCategory = applyUserRules(`${merchant.name} ${text}`, rules);
  if (ruleCategory) {
    if (ruleCategory === "transfers") return { ...base, kind: "transfer", categoryId: ruleCategory, categorySource: "rule" };
    const isIncomeCategory = opts.incomeCategories?.has(ruleCategory) ?? ["salary", "other_income", "refunds"].includes(ruleCategory);
    const kind: TransactionKind = inflow ? (isIncomeCategory ? "income" : "refund") : ruleCategory === "cash" ? "withdrawal" : "expense";
    return { ...base, kind, categoryId: ruleCategory, categorySource: "rule" };
  }

  // 3. Cash withdrawals.
  if (!inflow && (CASH_WORDS.test(text) || categoryFromMcc(tx.mcc) === "cash")) {
    return { ...base, merchant: "Cash withdrawal", merchantKey: "cash-withdrawal", kind: "withdrawal", categoryId: "cash", categorySource: "auto" };
  }

  // 4. Income.
  if (inflow) {
    if (SALARY_WORDS.test(text)) return { ...base, kind: "income", categoryId: "salary", categorySource: "auto" };
    if (TAX_WORDS.test(text)) return { ...base, kind: "income", categoryId: "other_income", categorySource: "auto" };
    if (BENEFIT_WORDS.test(text)) return { ...base, kind: "income", categoryId: "other_income", categorySource: "auto" };
    // Money back from a known merchant / health insurer = refund that reduces spending.
    if (merchant.entry && merchant.entry.category !== "other") {
      return { ...base, kind: "refund", categoryId: merchant.entry.category, categorySource: "auto" };
    }
    if (REFUND_WORDS.test(text)) return { ...base, kind: "refund", categoryId: "refunds", categorySource: "auto" };
    return { ...base, kind: "income", categoryId: "other_income", categorySource: "auto" };
  }

  // 5. Outflows.
  if (merchant.entry) return { ...base, kind: "expense", categoryId: merchant.entry.category, categorySource: "auto" };
  if (RENT_WORDS.test(text)) return { ...base, kind: "expense", categoryId: "housing", categorySource: "auto" };
  const keyword = KEYWORD_CATEGORIES.find(([re]) => re.test(text));
  if (keyword) return { ...base, kind: "expense", categoryId: keyword[1], categorySource: "auto" };
  const mccCategory = categoryFromMcc(tx.mcc);
  if (mccCategory) return { ...base, kind: "expense", categoryId: mccCategory, categorySource: "auto" };
  if (FEE_WORDS.test(text) && Math.abs(tx.amount) < 50) return { ...base, kind: "fee", categoryId: "bills", categorySource: "auto" };
  return { ...base, kind: "expense", categoryId: "other", categorySource: "auto" };
}

export interface PairableTransaction {
  id: string;
  account_id: string | null;
  booked_at: string;
  amount: number;
  kind: TransactionKind;
}

/**
 * Finds transfers between the user's own accounts that were not recognised
 * by IBAN or wording: an outflow on one account matched by an inflow of the
 * same amount on another own account within 3 days.
 */
export function pairInternalTransfers(txs: PairableTransaction[], maxDays = 3): string[] {
  const outflows = txs.filter((t) => t.amount < 0 && t.kind !== "transfer" && t.account_id);
  const inflows = txs.filter((t) => t.amount > 0 && t.kind !== "transfer" && t.account_id);
  const used = new Set<string>();
  const ids: string[] = [];
  for (const out of outflows) {
    const outDate = Date.parse(out.booked_at);
    const match = inflows.find(
      (inn) =>
        !used.has(inn.id) &&
        inn.account_id !== out.account_id &&
        Math.abs(inn.amount + out.amount) < 0.005 &&
        Math.abs(Date.parse(inn.booked_at) - outDate) <= maxDays * 86_400_000,
    );
    if (match) {
      used.add(match.id);
      ids.push(out.id, match.id);
    }
  }
  return ids;
}
