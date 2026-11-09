import "server-only";
import { getGoogleAccessToken } from "@/lib/integrations/google/oauth";
import { getMessageFull, getMessageMetadata, gmailWebLink, listMessages, mapLimit } from "@/lib/integrations/google/gmail";
import { updateConnection } from "@/lib/integrations/connections";
import { getAnthropic } from "@/lib/ai/client";
import { extractEmail, isLikelyRelevant, type EmailInput } from "@/lib/email/classify";
import { extractWithAi } from "@/lib/email/ai";
import { extractBodyText, type GmailMessage } from "@/lib/email/mime";
import { messageMeta, toEmailRow, toEventRow, type EmailRow, type EventRow } from "@/lib/email/shape";
import type { SyncContext, SyncStats } from "./types";

/** Messages examined per run; a longer backfill resumes from the saved page token next run. */
export const MAX_MESSAGES_PER_RUN = 400;
const BACKFILL_DAYS = 365;
const CONCURRENCY = 6;
/** Re-scan overlap for incremental runs so late-arriving mail isn't missed. */
const OVERLAP_MS = 2 * 86_400_000;
const BASE_QUERY = "-category:promotions -category:social -category:forums -in:chats -in:spam -in:trash -in:drafts -in:sent";

export interface GmailSyncState {
  lastInternalDate?: number;
  backfillDone?: boolean;
  /** An interrupted listing to continue next run. */
  pending?: { query: string; pageToken: string };
  lastRunAt?: string;
}

/**
 * Read-only Gmail sync. Lists recent messages, prefilters on metadata, fetches
 * full content only for likely transactional mail, extracts structured fields
 * (rules, optionally refined by AI with the user's consent) and stores only
 * that metadata plus Gmail's snippet. Every query is scoped to ctx.userId.
 */
export async function syncGmail(ctx: SyncContext): Promise<SyncStats> {
  const { admin, userId, connection } = ctx;
  const accessToken = await getGoogleAccessToken(admin, connection);
  const state: GmailSyncState = ctx.full ? {} : { ...((connection.sync_state?.gmail as GmailSyncState | undefined) ?? {}) };
  const stats = { scanned: 0, alreadyKnown: 0, fetched: 0, stored: 0, events: 0, aiExtracted: 0, skipped: 0, complete: true };

  // --- 1. Decide what to list ------------------------------------------------
  let query: string;
  let pageToken: string | undefined;
  if (state.pending) {
    query = state.pending.query;
    pageToken = state.pending.pageToken;
  } else if (!state.backfillDone || !state.lastInternalDate) {
    query = `${BASE_QUERY} newer_than:${BACKFILL_DAYS}d`;
  } else {
    query = `${BASE_QUERY} after:${Math.floor((state.lastInternalDate - OVERLAP_MS) / 1000)}`;
  }

  // --- 2. List message ids (newest first), capped per run ----------------------
  const ids: string[] = [];
  let nextToken: string | undefined = pageToken;
  do {
    const page = await listMessages(accessToken, query, nextToken, 100);
    for (const m of page.messages ?? []) ids.push(m.id);
    nextToken = page.nextPageToken;
  } while (nextToken && ids.length < MAX_MESSAGES_PER_RUN);
  stats.scanned = ids.length;

  // --- 3. Skip messages we already stored ------------------------------------
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("emails").select("external_id").eq("user_id", userId).eq("provider", "gmail").in("external_id", ids.slice(i, i + 200));
    for (const r of data ?? []) known.add(r.external_id as string);
  }
  const todo = ids.filter((id) => !known.has(id));
  stats.alreadyKnown = known.size;

  // --- 4. Metadata pass + prefilter ----------------------------------------------
  let maxInternal = state.lastInternalDate ?? 0;
  const metas = await mapLimit(todo, CONCURRENCY, (id) => getMessageMetadata(accessToken, id).catch(() => null));
  const candidates: GmailMessage[] = [];
  for (const m of metas) {
    if (!m) continue;
    maxInternal = Math.max(maxInternal, Number(m.internalDate) || 0);
    if (isLikelyRelevant(messageMeta(m))) candidates.push(m);
    else stats.skipped++;
  }

  // --- 5. Full fetch + extraction ------------------------------------------------
  const { data: profile } = await admin.from("profiles").select("ai_email_extraction_enabled").eq("id", userId).maybeSingle();
  const ai = profile?.ai_email_extraction_enabled ? getAnthropic() : null;

  const emailRows: EmailRow[] = [];
  const eventRows: EventRow[] = [];
  await mapLimit(candidates, CONCURRENCY, async (meta) => {
    const full = await getMessageFull(accessToken, meta.id).catch(() => null);
    if (!full) return;
    stats.fetched++;
    const m = messageMeta(full);
    const input: EmailInput = { ...m, body: extractBodyText(full.payload) };
    let x = extractEmail(input);
    let method: "rules" | "ai" = "rules";
    if (ai && (x.category !== "other" || x.isImportant)) {
      const refined = await extractWithAi(ai, input, x);
      if (refined) {
        x = refined;
        method = "ai";
        stats.aiExtracted++;
      }
    }
    // Privacy: don't keep anything that isn't transactional or important.
    if (x.category === "other" && !x.isImportant) {
      stats.skipped++;
      return;
    }
    const row = toEmailRow(full, x, { userId, connectionId: connection.id, webLink: gmailWebLink(full.id), method });
    emailRows.push(row);
    const ev = toEventRow(row, x);
    if (ev) eventRows.push(ev);
  });

  // --- 6. Persist ------------------------------------------------------------------
  const idByExternal = new Map<string, string>();
  for (let i = 0; i < emailRows.length; i += 200) {
    const { data, error } = await admin
      .from("emails")
      .upsert(emailRows.slice(i, i + 200), { onConflict: "user_id,provider,external_id" })
      .select("id, external_id");
    if (error) throw new Error(`Could not store emails: ${error.message}`);
    for (const r of data ?? []) idByExternal.set(r.external_id as string, r.id as string);
  }
  stats.stored = emailRows.length;
  if (eventRows.length) {
    const rows = eventRows.map((e) => ({ ...e, email_id: idByExternal.get(e.external_id) ?? null }));
    const { error } = await admin.from("events").upsert(rows, { onConflict: "user_id,source,external_id" });
    if (error) throw new Error(`Could not store events from email: ${error.message}`);
    stats.events = rows.length;
  }

  // --- 7. Save the cursor (namespaced under sync_state.gmail) -----------------------
  const next: GmailSyncState = { lastInternalDate: maxInternal || state.lastInternalDate, lastRunAt: new Date().toISOString(), backfillDone: state.backfillDone };
  if (nextToken) {
    next.pending = { query, pageToken: nextToken };
    stats.complete = false;
  } else if (!state.backfillDone && query.includes("newer_than")) {
    next.backfillDone = true;
  } else if (state.pending && state.pending.query.includes("newer_than")) {
    next.backfillDone = true;
  }
  // Re-read so we don't clobber state written by other services on the same connection.
  const { data: fresh } = await admin.from("connections").select("sync_state").eq("id", connection.id).eq("user_id", userId).maybeSingle();
  const merged = { ...((fresh?.sync_state as Record<string, unknown> | null) ?? connection.sync_state ?? {}), gmail: next };
  await updateConnection(admin, connection.id, userId, { sync_state: merged });
  connection.sync_state = merged; // keep the in-memory copy current for later steps in this run

  return stats;
}
