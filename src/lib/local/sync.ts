/**
 * Checks the connected Google accounts from the browser (GitHub Pages
 * edition): Gmail and Calendar, read-only, one mailbox after the other, then
 * the detection pipeline over everything that came in.
 */
import type { Connection } from "@/lib/types";
import { hasScope } from "@/lib/integrations/google/scopes";
import { GoogleAuthError } from "@/lib/integrations/google/http";
import { syncGmailCore, type GmailSyncProgress } from "@/lib/sync/gmail-core";
import { syncCalendarCore } from "@/lib/sync/calendar-core";
import { runPipeline, type PipelineResult } from "@/lib/engines/pipeline";
import { purgeExpiredEmails } from "@/lib/email/retention";
import type { SyncStats } from "@/lib/sync/types";
import type { AppSupabaseClient } from "./server";
import { LOCAL_CHANGE_EVENT, LOCAL_USER_ID, localDb, ready } from "./db";
import { clearToken, getToken, googleConnections } from "./google";
import { getAiModel } from "./prefs";

const db = localDb as unknown as AppSupabaseClient;
/** One check reads at most this many batches of 400 messages per mailbox; the rest continues next time. */
const MAX_GMAIL_RUNS = 5;
export const NEEDS_SIGN_IN = "needs_sign_in";

export interface LocalSyncResult {
  connectionId: string;
  provider: Connection["provider"];
  label: string;
  ok: boolean;
  stats: Record<string, SyncStats>;
  error?: string;
  /** True when the only problem is an expired sign-in (fixed by one tap). */
  needsSignIn?: boolean;
}

export interface LocalSyncProgress {
  label: string;
  step: "gmail" | "calendar";
  detail?: GmailSyncProgress;
}

let running: Promise<{ results: LocalSyncResult[]; pipeline: PipelineResult }> | null = null;

async function recordRun<T extends SyncStats>(connectionId: string, kind: string, fn: () => Promise<T>): Promise<T> {
  const { data } = await localDb.from("sync_runs").insert({ user_id: LOCAL_USER_ID, connection_id: connectionId, kind }).select("id").single();
  const runId = (data as { id?: string } | null)?.id;
  const finish = (patch: Record<string, unknown>) => (runId ? localDb.from("sync_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", runId) : Promise.resolve());
  try {
    const stats = await fn();
    await finish({ status: "success", stats });
    return stats;
  } catch (e) {
    await finish({ status: "error", error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) });
    throw e;
  }
}

async function aiForExtraction() {
  const { data } = await localDb.from("profiles").select("ai_email_extraction_enabled").eq("id", LOCAL_USER_ID).maybeSingle();
  if (!(data as { ai_email_extraction_enabled?: boolean } | null)?.ai_email_extraction_enabled) return null;
  const { browserAnthropic } = await import("./assistant");
  const client = await browserAnthropic();
  return client ? { client, model: getAiModel() } : null;
}

async function syncOne(connection: Connection, opts: { full?: boolean; onProgress?: (p: LocalSyncProgress) => void }): Promise<LocalSyncResult> {
  const base = { connectionId: connection.id, provider: connection.provider, label: connection.label };
  const token = getToken(connection.id);
  if (!token) return { ...base, ok: false, stats: {}, needsSignIn: true, error: NEEDS_SIGN_IN };
  const stats: Record<string, SyncStats> = {};
  try {
    if (hasScope(connection, "gmail")) {
      const ai = await aiForExtraction();
      const total = { scanned: 0, alreadyKnown: 0, fetched: 0, stored: 0, events: 0, aiExtracted: 0, skipped: 0, complete: true };
      for (let run = 0; run < MAX_GMAIL_RUNS; run++) {
        const s = await recordRun(connection.id, "gmail", () =>
          syncGmailCore({ db, userId: LOCAL_USER_ID, connection, accessToken: token, ai, full: opts.full && run === 0, onProgress: (detail) => opts.onProgress?.({ label: connection.label, step: "gmail", detail }) }),
        );
        for (const k of ["scanned", "alreadyKnown", "fetched", "stored", "events", "aiExtracted", "skipped"] as const) total[k] += Number(s[k] ?? 0);
        total.complete = s.complete !== false;
        if (total.complete) break;
      }
      stats.gmail = total;
    }
    if (hasScope(connection, "calendar")) {
      opts.onProgress?.({ label: connection.label, step: "calendar" });
      stats.calendar = await recordRun(connection.id, "calendar", () => syncCalendarCore({ db, userId: LOCAL_USER_ID, connection, accessToken: token }));
    }
    await localDb.from("connections").update({ last_synced_at: new Date().toISOString(), last_error: null, status: "active" }).eq("id", connection.id);
    return { ...base, ok: true, stats };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof GoogleAuthError && e.reconnect) {
      // The token was rejected (expired early or access removed at Google).
      clearToken(connection.id);
      return { ...base, ok: false, stats, needsSignIn: true, error: NEEDS_SIGN_IN };
    }
    await localDb.from("connections").update({ last_error: message.slice(0, 500), status: "error" }).eq("id", connection.id);
    return { ...base, ok: false, stats, error: message };
  }
}

/**
 * Checks one connection, or every connected Google account. Mailboxes whose
 * sign-in has expired are reported with `needsSignIn` instead of failing the
 * whole check. Calls made while a check is running share its result.
 */
export function syncGoogleLocal(opts: { connectionId?: string; full?: boolean; onProgress?: (p: LocalSyncProgress) => void } = {}): Promise<{ results: LocalSyncResult[]; pipeline: PipelineResult }> {
  if (running) return running;
  running = (async () => {
    await ready();
    const all = await googleConnections();
    const targets = opts.connectionId ? all.filter((c) => c.id === opts.connectionId) : all;
    const results: LocalSyncResult[] = [];
    for (const c of targets) results.push(await syncOne(c, opts));
    // Storage limitation: drop extracted email data older than the user's retention period.
    const { data: profile } = await localDb.from("profiles").select("email_retention_days").eq("id", LOCAL_USER_ID).maybeSingle();
    await purgeExpiredEmails(db, LOCAL_USER_ID, Number((profile as { email_retention_days?: number } | null)?.email_retention_days ?? 730)).catch(() => 0);
    const pipeline = await runPipeline(db, LOCAL_USER_ID);
    try {
      localStorage.setItem("cc:lastPipeline", String(Date.now()));
      if (results.some((r) => r.ok)) localStorage.setItem("cc:lastMailCheck", String(Date.now()));
    } catch {
      // storage blocked
    }
    window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
    return { results, pipeline };
  })().finally(() => {
    running = null;
  });
  return running;
}

export function describeSync(results: LocalSyncResult[]): string {
  const ok = results.filter((r) => r.ok);
  const emails = ok.reduce((a, r) => a + Number(r.stats.gmail?.stored ?? 0), 0);
  const events = ok.reduce((a, r) => a + Number(r.stats.calendar?.upserted ?? r.stats.calendar?.stored ?? 0), 0);
  const parts = [`${emails} new email${emails === 1 ? "" : "s"}`];
  if (ok.some((r) => r.stats.calendar)) parts.push(`${events} calendar event${events === 1 ? "" : "s"}`);
  const more = ok.some((r) => r.stats.gmail?.complete === false) ? " More history loads on the next check." : "";
  return `${parts.join(", ")} from ${ok.length} account${ok.length === 1 ? "" : "s"}.${more}`;
}
