import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncConnection } from "@/lib/sync";
import { runPipeline } from "@/lib/engines/pipeline";
import { purgeExpiredEmails } from "@/lib/email/retention";
import type { Connection } from "@/lib/types";

export const maxDuration = 800;

function authorised(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret ?? ""}`;
  if (!env.cronSecret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Daily job (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`):
 * 1. sync every active connection, 2. re-run detection + notifications for
 * each user with data, 3. purge email data past each user's retention period,
 * 4. flag bank consents that are about to expire.
 * Uses the service role; every step is scoped to one user id at a time.
 */
export async function GET(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const started = Date.now();
  const summary = { connections: 0, syncErrors: 0, users: 0, emailsPurged: 0, notifications: 0, expiringConsents: 0 };

  const { data: connections } = await admin.from("connections").select("*").in("status", ["active", "error"]);
  const users = new Set<string>();
  for (const c of (connections ?? []) as Connection[]) {
    users.add(c.user_id);
    if (Date.now() - started > (maxDuration - 120) * 1000) break; // leave time for the rest
    summary.connections++;
    const res = await syncConnection(admin, c.user_id, c.id, { skipPipeline: true });
    if (!res.ok) summary.syncErrors++;
    if (c.provider === "enable_banking" && c.consent_expires_at && Date.parse(c.consent_expires_at) - Date.now() < 7 * 86_400_000) {
      summary.expiringConsents++;
      await admin.from("notifications").upsert(
        {
          user_id: c.user_id,
          type: "consent_expiring",
          title: `Bank access for ${c.label} expires soon`,
          body: "PSD2 rules require you to renew access every 180 days. Renew it to keep transactions syncing.",
          severity: "warning",
          link: "/settings/accounts",
          dedupe_key: `consent:${c.id}:${c.consent_expires_at.slice(0, 10)}`,
        },
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
      );
    }
  }

  // Users with any data (including manual/CSV-only users) get detection + notifications.
  const { data: profiles } = await admin.from("profiles").select("id, email_retention_days");
  for (const p of (profiles ?? []) as { id: string; email_retention_days: number }[]) {
    const { count } = await admin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", p.id);
    const { count: subs } = await admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", p.id);
    if (!users.has(p.id) && !count && !subs) continue;
    summary.users++;
    try {
      const result = await runPipeline(admin, p.id);
      summary.notifications += result.notificationsCreated;
    } catch (e) {
      console.error("Daily pipeline failed for a user", e instanceof Error ? e.message : e);
    }
    summary.emailsPurged += await purgeExpiredEmails(admin, p.id, p.email_retention_days).catch(() => 0);
  }

  return NextResponse.json({ ok: true, ms: Date.now() - started, ...summary });
}
