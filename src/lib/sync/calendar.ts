import "server-only";
import { getGoogleAccessToken, googleFetch } from "@/lib/integrations/google/oauth";
import { runCalendarSync, type CalendarStore, type GoogleEventRow } from "@/lib/calendar/google-sync";
import { DEFAULT_TZ } from "@/lib/calendar/time";
import type { SyncContext, SyncStats } from "./types";

/**
 * Read-only Google Calendar sync. Uses the service-role client, so every
 * query below is explicitly scoped to ctx.userId.
 */
export async function syncCalendar(ctx: SyncContext): Promise<SyncStats> {
  const { admin, userId, connection } = ctx;
  const token = await getGoogleAccessToken(admin, connection);
  const { data: profile } = await admin.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const tz = (profile?.timezone as string | undefined) ?? DEFAULT_TZ;

  const store: CalendarStore = {
    async listExisting(fromIso, toIso) {
      const { data, error } = await admin
        .from("events")
        .select("id, external_id")
        .eq("user_id", userId)
        .eq("source", "google")
        .gte("starts_at", fromIso)
        .lt("starts_at", toIso);
      if (error) throw new Error(`Could not read synced events: ${error.message}`);
      return (data ?? []) as { id: string; external_id: string }[];
    },
    async upsert(rows: GoogleEventRow[]) {
      const scoped = rows.map((r) => ({ ...r, user_id: userId }));
      const { error } = await admin.from("events").upsert(scoped, { onConflict: "user_id,source,external_id" });
      if (error) throw new Error(`Could not save calendar events: ${error.message}`);
    },
    async deleteIds(ids: string[]) {
      if (ids.length === 0) return;
      const { error } = await admin.from("events").delete().eq("user_id", userId).eq("source", "google").in("id", ids);
      if (error) throw new Error(`Could not remove deleted calendar events: ${error.message}`);
    },
  };

  const stats = await runCalendarSync({ fetchJson: <T,>(url: string) => googleFetch<T>(token, url), store, userId, tz });
  return { ...stats };
}
