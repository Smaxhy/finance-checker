/**
 * Bank CSV import. Belgian banks (KBC, BNP Paribas Fortis, Belfius, ING,
 * Argenta, Crelan…) export CSV with Dutch, French or English headers, ";"
 * separators and comma decimals. This module detects the layout, maps the
 * columns, and parses rows into a neutral shape. Pure - no I/O.
 */
import Papa from "papaparse";
import { createHash } from "node:crypto";

export type CsvField = "date" | "amount" | "debit" | "credit" | "description" | "counterparty" | "counterpartyAccount" | "currency" | "account";

export type CsvMapping = Partial<Record<CsvField, number>>;

export interface ParsedCsvRow {
  date: string; // YYYY-MM-DD
  amount: number; // signed
  currency: string;
  description: string;
  counterparty: string | null;
  counterpartyAccount: string | null;
  account: string | null;
  externalId: string;
}

export interface CsvAnalysis {
  delimiter: string;
  headers: string[];
  headerRow: number;
  mapping: CsvMapping;
  rows: ParsedCsvRow[];
  errors: { line: number; message: string }[];
  totalLines: number;
}

const HEADER_PATTERNS: Record<CsvField, RegExp[]> = {
  date: [/^(boekings?datum|booking\s*date|date\s*(de\s*)?(comptabilisation|d['’]?ex[ée]cution)|uitvoeringsdatum|transaction\s*date|datum|date|date\s*operation|date\s*op[ée]ration)$/i, /datum|date/i],
  amount: [/^(bedrag|montant|amount|amount\s*\(eur\)|bedrag\s*\(eur\)|montant\s*\(eur\)|transaction\s*amount)$/i, /bedrag|montant|amount/i],
  debit: [/^(debet|d[ée]bit|uitgaven|withdrawals?|af|money\s*out|paid\s*out)$/i],
  credit: [/^(credit|cr[ée]dit|inkomsten|deposits?|bij|money\s*in|paid\s*in)$/i],
  description: [/^(omschrijving|mededeling|description|communication|libell[ée]|details|transaction\s*details|vrije\s*mededeling|detail\s*de\s*l['’]op[ée]ration)$/i, /omschrijving|mededeling|description|communication|libell/i],
  counterparty: [/^(naam\s*(van\s*de\s*)?tegenpartij|naam\s*begunstigde|begunstigde|nom\s*(de\s*la\s*)?contrepartie|counterparty(\s*name)?|beneficiary|payee)$/i, /tegenpartij|contrepartie|counterparty|begunstigde|b[ée]n[ée]ficiaire/i, /^(name|naam|nom)$/i],
  // A bare "Contrepartie"/"Tegenpartij" column usually holds the IBAN (e.g. BNP Paribas Fortis).
  counterpartyAccount: [/^(rekening\s*tegenpartij|tegenrekening|rekeningnummer\s*tegenpartij|compte\s*(de\s*la\s*)?contrepartie|counterparty\s*(account|iban)|iban\s*tegenpartij|iban\s*contrepartie|contrepartie|tegenpartij)$/i],
  currency: [/^(munt|valuta|devise|currency|munteenheid)$/i],
  account: [/^(rekening(nummer)?|compte|account(\s*number)?|iban)$/i],
};

function normaliseHeader(h: string) {
  return h.replace(/^﻿/, "").replace(/["']/g, "").trim();
}

export function detectMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {};
  const used = new Set<number>();
  const fields: CsvField[] = ["counterpartyAccount", "date", "amount", "debit", "credit", "description", "counterparty", "currency", "account"];
  // Two passes: exact patterns first, then loose ones.
  for (const pass of [0, 1, 2]) {
    for (const field of fields) {
      if (mapping[field] !== undefined) continue;
      const pattern = HEADER_PATTERNS[field][pass];
      if (!pattern) continue;
      const idx = headers.findIndex((h, i) => !used.has(i) && pattern.test(normaliseHeader(h)));
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

/** "1.234,56" / "1,234.56" / "-12,5" / "€ 12,00" / "12.00-" → number */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[€$£\s ]|EUR|USD|GBP/gi, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma) s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}

/** dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd, yyyymmdd → YYYY-MM-DD (European day-first) */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().slice(0, 19);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(year, +m[2], +m[1]);
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function findHeaderRow(rows: string[][]): number {
  // Some exports start with a few metadata lines; the header is the first row
  // that maps at least a date and an amount-ish column.
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = detectMapping(rows[i]);
    if (m.date !== undefined && (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined)) return i;
  }
  return 0;
}

export function analyseCsv(text: string, overrideMapping?: CsvMapping): CsvAnalysis {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimitersToGuess: [";", ",", "\t", "|"] });
  const all = parsed.data.filter((r) => r.some((c) => c && c.trim()));
  const headerRow = findHeaderRow(all);
  const headers = (all[headerRow] ?? []).map(normaliseHeader);
  const mapping = overrideMapping ?? fixIbanColumns(detectMapping(headers), all.slice(headerRow + 1, headerRow + 30));
  const rows: ParsedCsvRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Map<string, number>();

  for (let i = headerRow + 1; i < all.length; i++) {
    const r = all[i];
    const cell = (f: CsvField) => (mapping[f] !== undefined ? (r[mapping[f]!] ?? "").trim() : "");
    const date = parseDate(cell("date"));
    let amount: number | null = null;
    if (mapping.amount !== undefined) amount = parseAmount(cell("amount"));
    else {
      const debit = parseAmount(cell("debit"));
      const credit = parseAmount(cell("credit"));
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null) amount = Math.abs(credit);
    }
    if (!date || amount === null) {
      errors.push({ line: i + 1, message: !date ? `Unreadable date "${cell("date")}"` : `Unreadable amount` });
      continue;
    }
    if (amount === 0) continue;
    const description = cell("description").replace(/\s+/g, " ");
    const counterparty = cell("counterparty") || null;
    const counterpartyAccount = cell("counterpartyAccount").replace(/\s+/g, "") || null;
    const account = cell("account").replace(/\s+/g, "") || null;
    // Stable id for idempotent re-imports; identical lines on the same day are numbered.
    const base = [date, amount.toFixed(2), description, counterparty ?? "", counterpartyAccount ?? "", account ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({
      date,
      amount,
      currency: (cell("currency") || "EUR").toUpperCase().slice(0, 3),
      description: description || counterparty || "Transaction",
      counterparty,
      counterpartyAccount,
      account,
      externalId: createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 40),
    });
  }
  return { delimiter: parsed.meta.delimiter, headers, headerRow, mapping, rows, errors, totalLines: all.length - headerRow - 1 };
}

/** If the "counterparty name" column actually contains IBANs, treat it as the account column. */
function fixIbanColumns(mapping: CsvMapping, sample: string[][]): CsvMapping {
  if (mapping.counterparty === undefined || mapping.counterpartyAccount !== undefined) return mapping;
  const values = sample.map((r) => r[mapping.counterparty!]).filter((v) => v && v.trim());
  if (values.length && values.filter((v) => looksLikeIban(v)).length / values.length >= 0.6) {
    return { ...mapping, counterpartyAccount: mapping.counterparty, counterparty: undefined };
  }
  return mapping;
}

export function looksLikeIban(value: string | null | undefined): boolean {
  return Boolean(value && /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(value.replace(/\s+/g, "")));
}
