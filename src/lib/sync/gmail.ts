import "server-only";
import { getGoogleAccessToken } from "@/lib/integrations/google/oauth";
import { AI_EXTRACTION_MODEL, getAnthropic } from "@/lib/ai/client";
import { syncGmailCore } from "./gmail-core";
import type { SyncContext, SyncStats } from "./types";

export { MAX_MESSAGES_PER_RUN, type GmailSyncState } from "./gmail-core";

/**
 * Server-side Gmail sync for one connection (one mailbox): gets a fresh access
 * token from the encrypted credentials, then runs the shared read-only sync.
 * Uses the service-role client, so every query is scoped to ctx.userId.
 */
export async function syncGmail(ctx: SyncContext): Promise<SyncStats> {
  const { admin, userId, connection } = ctx;
  const accessToken = await getGoogleAccessToken(admin, connection);
  const { data: profile } = await admin.from("profiles").select("ai_email_extraction_enabled").eq("id", userId).maybeSingle();
  const client = profile?.ai_email_extraction_enabled ? getAnthropic() : null;
  return syncGmailCore({ db: admin, userId, connection, accessToken, ai: client ? { client, model: AI_EXTRACTION_MODEL } : null, full: ctx.full });
}
