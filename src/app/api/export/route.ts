import { NextResponse } from "next/server";
import { createClient, getSessionUser } from "@/lib/supabase/server";

const TABLES = ["profiles", "accounts", "transactions", "subscriptions", "budgets", "categories", "category_rules", "emails", "events", "tasks", "notifications", "connections", "sync_runs", "audit_log"] as const;

/**
 * GDPR data portability: a JSON copy of everything stored about the signed-in
 * user. Uses the user's own session, so row-level security guarantees only
 * their rows are included. Encrypted credentials are never readable here.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const supabase = await createClient();
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email },
    note: "OAuth tokens and bank session identifiers are stored encrypted and are not included.",
  };
  for (const table of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      let q = supabase.from(table).select("*").range(from, from + 999);
      if (table === "categories") q = q.eq("user_id", user.id);
      const { data, error } = await q;
      if (error) return NextResponse.json({ error: `Export failed on ${table}` }, { status: 500 });
      rows.push(...(data ?? []).map((r) => (table === "emails" ? { ...r, search: undefined } : r)));
      if (!data || data.length < 1000) break;
    }
    out[table] = rows;
  }
  await supabase.rpc("log_audit", { p_action: "privacy.export", p_details: {} });
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="command-centre-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
