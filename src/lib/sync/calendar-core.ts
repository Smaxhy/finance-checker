// Browser-safe core of the Google Calendar sync (read-only): the data client and
// access token are passed in.
import type { Connection } from "@/lib/types";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { googleFetch } from "@/lib/integrations/google/http";
import { GOOGLE_SCOPES } from "@/lib/integrations/google/scopes";
import { runCalendarSync, type CalendarStore, type GoogleEventRow } from "@/lib/calendar/google-sync";
import { DEFAULT_TZ } from "@/lib/calendar/time";
import type { SyncStats } from "./types";

export interface CalendarSyncState {
  /** Calendars this account showed at its last sync. */
  calendarIds?: string[];
  lastRunAt?: string;
}

export async function syncCalendarCore({ db, userId, connection, accessToken }: { db: AppSupabaseClient; userId: string; connection: Connection; accessToken: string }): Promise<SyncStats> {
  const { data: profile } = await db.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const tz = (profile?.timezone as string | undefined) ?? DEFAULT_TZ;

  // With more than one Google calendar account, each account only cleans up its own calendars.
  const { data: others } = await db.from("connections").select("id, scopes, status").eq("user_id", userId).eq("provider", "google");
  const calendarAccounts = ((others ?? []) as { id: string; scopes: string[]; status: string }[]).filter((c) => c.status !== "revoked" && c.scopes.includes(GOOGLE_SCOPES.calendar));
  const previous = (connection.sync_state?.calendar as CalendarSyncState | undefined)?.calendarIds;
  let calendarIds: string[] = [];

  const store: CalendarStore = {
    async listExisting(fromIso, toIso) {
      const { data, error } = await db.from("events").select("id, external_id").eq("user_id", userId).eq("source", "google").gte("starts_at", fromIso).lt("starts_at", toIso);
      if (error) throw new Error(`Could not read synced events: ${error.message}`);
      return (data ?? []) as { id: string; external_id: string }[];
    },
    async upsert(rows: GoogleEventRow[]) {
      const scoped = rows.map((r) => ({ ...r, user_id: userId }));
      const { error } = await db.from("events").upsert(scoped, { onConflict: "user_id,source,external_id" });
      if (error) throw new Error(`Could not save calendar events: ${error.message}`);
    },
    async deleteIds(ids: string[]) {
      if (ids.length === 0) return;
      const { error } = await db.from("events").delete().eq("user_id", userId).eq("source", "google").in("id", ids);
      if (error) throw new Error(`Could not remove deleted calendar events: ${error.message}`);
    },
  };

  const stats = await runCalendarSync({
    fetchJson: <T,>(url: string) => googleFetch<T>(accessToken, url),
    store,
    userId,
    tz,
    ownCalendarIds: calendarAccounts.length > 1 ? (previous ?? []) : undefined,
    onCalendars: (ids) => (calendarIds = ids),
  });

  // Remember this account's calendars (namespaced under sync_state.calendar, without clobbering other services).
  const { data: fresh } = await db.from("connections").select("sync_state").eq("id", connection.id).eq("user_id", userId).maybeSingle();
  const merged = { ...((fresh?.sync_state as Record<string, unknown> | null) ?? connection.sync_state ?? {}), calendar: { calendarIds, lastRunAt: new Date().toISOString() } satisfies CalendarSyncState };
  await db.from("connections").update({ sync_state: merged }).eq("id", connection.id).eq("user_id", userId);
  connection.sync_state = merged;
  return { ...stats };
}
