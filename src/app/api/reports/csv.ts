/**
 * CSV helpers. Text cells are protected against spreadsheet formula injection
 * (OWASP): a leading = + - @ tab or carriage return is prefixed with a single
 * quote. Numeric cells we format ourselves are emitted as plain numbers.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvText(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvNumber(value: number | string | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(decimals) : "";
}

export function csvRow(cells: string[]): string {
  return cells.join(",");
}

/** UTF-8 BOM so Excel opens accented merchant names correctly. */
export const CSV_BOM = "﻿";
