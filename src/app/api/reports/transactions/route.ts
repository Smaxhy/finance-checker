import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { buildTransactionsCsv } from "../csv";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({ from: isoDate, to: isoDate });

/** Authenticated CSV export of the signed-in user's transactions for a date range (RLS-scoped). */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = query.safeParse({ from: request.nextUrl.searchParams.get("from"), to: request.nextUrl.searchParams.get("to") });
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  const { from, to } = parsed.data;

  const supabase = await createClient();
  let built: { csv: string; rows: number };
  try {
    built = await buildTransactionsCsv(supabase, user, from, to);
  } catch {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  await supabase.rpc("log_audit", { p_action: "export.transactions_csv", p_details: { from, to, rows: built.rows } });
  return new Response(built.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="transactions_${from}_${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
