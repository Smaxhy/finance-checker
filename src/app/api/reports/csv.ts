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

export const TRANSACTIONS_HEADER = ["date", "value_date", "description", "merchant", "counterparty", "amount", "currency", "type", "category", "account", "notes", "source", "is_demo"];

/**
 * Builds the transactions CSV for a date range. Shared by the server route and
 * the GitHub Pages edition (which runs it in the browser against local data).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildTransactionsCsv(supabase: any, user: { id: string }, from: string, to: string): Promise<{ csv: string; rows: number }> {
  const HEADER = TRANSACTIONS_HEADER;
  const [{ data: categories }, { data: accounts }] = await Promise.all([
    supabase.from("categories").select("id, name"),
    supabase.from("accounts").select("id, name, institution"),
  ]);
  const catName = new Map(((categories ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const accName = new Map(((accounts ?? []) as { id: string; name: string; institution: string | null }[]).map((a) => [a.id, a.institution ? `${a.institution} - ${a.name}` : a.name]));

  const lines = [csvRow(HEADER)];
  const PAGE = 1000;
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("booked_at, value_date, description, merchant, counterparty_name, amount, currency, kind, category_id, account_id, notes, source, is_demo")
      .eq("user_id", user.id)
      .gte("booked_at", from)
      .lte("booked_at", to)
      .order("booked_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error("query_failed");
    for (const t of data ?? []) {
      lines.push(
        csvRow([
          csvText(t.booked_at),
          csvText(t.value_date),
          csvText(t.description),
          csvText(t.merchant),
          csvText(t.counterparty_name),
          csvNumber(t.amount),
          csvText(t.currency),
          csvText(t.kind),
          csvText(t.category_id ? (catName.get(t.category_id) ?? t.category_id) : ""),
          csvText(t.account_id ? (accName.get(t.account_id) ?? "") : ""),
          csvText(t.notes),
          csvText(t.source),
          t.is_demo ? "yes" : "no",
        ]),
      );
    }
    if (!data || data.length < PAGE) break;
  }

  return { csv: CSV_BOM + lines.join("\r\n") + "\r\n", rows: lines.length - 1 };
}
