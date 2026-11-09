import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";

/**
 * GDPR storage limitation: deletes extracted email records older than the
 * user's retention window (profiles.email_retention_days). Only our extracted
 * metadata is removed - nothing in the user's mailbox is touched.
 */
export async function purgeExpiredEmails(admin: AdminClient, userId: string, days: number): Promise<number> {
  const safeDays = Math.min(3650, Math.max(30, Math.round(days)));
  const cutoff = new Date(Date.now() - safeDays * 86_400_000).toISOString();
  const { count, error } = await admin.from("emails").delete({ count: "exact" }).eq("user_id", userId).lt("received_at", cutoff);
  if (error) throw new Error(`Could not purge expired emails: ${error.message}`);
  return count ?? 0;
}
