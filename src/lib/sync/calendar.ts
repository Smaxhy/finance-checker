import "server-only";
import { getGoogleAccessToken } from "@/lib/integrations/google/oauth";
import { syncCalendarCore } from "./calendar-core";
import type { SyncContext, SyncStats } from "./types";

/**
 * Server-side Google Calendar sync (read-only). Uses the service-role client,
 * so every query in the core is explicitly scoped to ctx.userId.
 */
export async function syncCalendar(ctx: SyncContext): Promise<SyncStats> {
  const { admin, userId, connection } = ctx;
  const accessToken = await getGoogleAccessToken(admin, connection);
  return syncCalendarCore({ db: admin, userId, connection, accessToken });
}
