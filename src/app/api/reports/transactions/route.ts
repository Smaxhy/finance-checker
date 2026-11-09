import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { CSV_BOM, csvNumber, csvRow, csvText } from "../csv";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({ from: isoDate, to: isoDate });

const HEADER = ["date", "value_date", "description", "merchant", "counterparty", "amount", "currency", "type", "category", "account", "notes", "source", "is_demo"];

/** Authenticated CSV export of the signed-in user's transactions for a date range (RLS-scoped). */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = query.safeParse({ from: request.nextUrl.searchParams.get("from"), to: request.nextUrl.searchParams.get("to") });
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  const { from, to } = parsed.data;

  const supabase = await createClient();
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
    if (error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
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

  await supabase.rpc("log_audit", { p_action: "export.transactions_csv", p_details: { from, to, rows: lines.length - 1 } });
  return new Response(CSV_BOM + lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions_${from}_${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
