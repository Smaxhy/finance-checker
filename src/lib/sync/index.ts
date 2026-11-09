import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Connection } from "@/lib/types";
import { finishSyncRun, getConnection, startSyncRun, updateConnection } from "@/lib/integrations/connections";
import { hasScope } from "@/lib/integrations/google/oauth";
import { runPipeline, type PipelineResult } from "@/lib/engines/pipeline";
import { syncGmail } from "./gmail";
import { syncCalendar } from "./calendar";
import { syncBank } from "./bank";
import type { SyncStats } from "./types";

export interface ConnectionSyncResult {
  connectionId: string;
  provider: Connection["provider"];
  ok: boolean;
  stats: Record<string, SyncStats>;
  error?: string;
}

async function runStep(admin: AdminClient, userId: string, connection: Connection, kind: string, fn: () => Promise<SyncStats>) {
  const runId = await startSyncRun(admin, userId, connection.id, kind);
  try {
    const stats = await fn();
    await finishSyncRun(admin, runId, "success", stats);
    return stats;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finishSyncRun(admin, runId, "error", {}, message);
    throw e;
  }
}

/** Sync one connection (all of its services) for an already-authenticated user. */
export async function syncConnection(admin: AdminClient, userId: string, connectionId: string, opts: { full?: boolean; skipPipeline?: boolean } = {}): Promise<ConnectionSyncResult & { pipeline?: PipelineResult }> {
  const connection = await getConnection(admin, connectionId, userId);
  if (!connection) throw new Error("Connection not found");
  if (connection.status === "revoked") throw new Error("This connection has been disconnected");
  const ctx = { admin, userId, connection, full: opts.full };
  const stats: Record<string, SyncStats> = {};
  try {
    if (connection.provider === "google") {
      if (hasScope(connection, "gmail")) stats.gmail = await runStep(admin, userId, connection, "gmail", () => syncGmail(ctx));
      if (hasScope(connection, "calendar")) stats.calendar = await runStep(admin, userId, connection, "calendar", () => syncCalendar(ctx));
    } else if (connection.provider === "enable_banking") {
      stats.bank = await runStep(admin, userId, connection, "bank", () => syncBank(ctx));
    }
    await updateConnection(admin, connection.id, userId, { last_synced_at: new Date().toISOString(), last_error: null, ...(connection.status === "error" ? { status: "active" } : {}) });
    const pipeline = opts.skipPipeline ? undefined : await runPipeline(admin, userId);
    return { connectionId: connection.id, provider: connection.provider, ok: true, stats, pipeline };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const fresh = await getConnection(admin, connectionId, userId);
    await updateConnection(admin, connection.id, userId, { last_error: message.slice(0, 500), ...(fresh?.status === "expired" ? {} : { status: "error" }) });
    return { connectionId: connection.id, provider: connection.provider, ok: false, stats, error: message };
  }
}
