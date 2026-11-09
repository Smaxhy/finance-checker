import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Connection } from "@/lib/types";
import { decryptJson, encryptJson } from "@/lib/crypto";

/**
 * Connection records are readable by their owner (RLS); the encrypted
 * secrets table is only reachable with the service-role client used here.
 * Every function takes the authenticated userId and filters on it.
 */

export async function getConnection(admin: AdminClient, id: string, userId: string): Promise<Connection | null> {
  const { data } = await admin.from("connections").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return (data as Connection | null) ?? null;
}

export async function listConnections(admin: AdminClient, userId: string): Promise<Connection[]> {
  const { data } = await admin.from("connections").select("*").eq("user_id", userId).order("created_at");
  return (data ?? []) as Connection[];
}

export async function upsertConnection(
  admin: AdminClient,
  input: {
    userId: string;
    provider: Connection["provider"];
    label: string;
    scopes: string[];
    consentExpiresAt?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<Connection> {
  const { data, error } = await admin
    .from("connections")
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        label: input.label,
        scopes: input.scopes,
        status: "active",
        last_error: null,
        consent_expires_at: input.consentExpiresAt ?? null,
        metadata: input.metadata ?? {},
      },
      { onConflict: "user_id,provider,label" },
    )
    .select("*")
    .single();
  if (error || !data) throw new Error(`Could not save connection: ${error?.message}`);
  return data as Connection;
}

export async function readSecrets<T>(admin: AdminClient, connectionId: string, userId: string): Promise<T | null> {
  const { data } = await admin.from("connection_secrets").select("ciphertext").eq("connection_id", connectionId).eq("user_id", userId).maybeSingle();
  if (!data?.ciphertext) return null;
  return decryptJson<T>(data.ciphertext);
}

export async function writeSecrets(admin: AdminClient, connectionId: string, userId: string, secrets: unknown): Promise<void> {
  const { error } = await admin
    .from("connection_secrets")
    .upsert({ connection_id: connectionId, user_id: userId, ciphertext: encryptJson(secrets), updated_at: new Date().toISOString() }, { onConflict: "connection_id" });
  if (error) throw new Error(`Could not store credentials: ${error.message}`);
}

export async function updateConnection(admin: AdminClient, id: string, userId: string, patch: Partial<Pick<Connection, "status" | "last_error" | "last_synced_at" | "sync_state" | "metadata" | "scopes" | "consent_expires_at">>) {
  await admin.from("connections").update(patch).eq("id", id).eq("user_id", userId);
}

export async function startSyncRun(admin: AdminClient, userId: string, connectionId: string | null, kind: string): Promise<string> {
  const { data } = await admin.from("sync_runs").insert({ user_id: userId, connection_id: connectionId, kind }).select("id").single();
  return data?.id as string;
}

export async function finishSyncRun(admin: AdminClient, runId: string, status: "success" | "error", stats: Record<string, unknown>, error?: string) {
  if (!runId) return;
  await admin.from("sync_runs").update({ status, stats, error: error?.slice(0, 1000) ?? null, finished_at: new Date().toISOString() }).eq("id", runId);
}

export async function audit(admin: AdminClient, userId: string, action: string, details: Record<string, unknown> = {}) {
  await admin.from("audit_log").insert({ user_id: userId, action, details });
}
