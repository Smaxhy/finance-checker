// Settings actions for the GitHub Pages edition (data lives in this browser only).
import { z } from "zod";
import { LOCAL_CHANGE_EVENT, LOCAL_USER_ID, localDb, wipeAll } from "../db";
import { clearLocalSecrets } from "../prefs";
import { clearAllTokens, clearToken, getToken, revokeToken } from "../google";
import { GOOGLE_SCOPES } from "@/lib/integrations/google/scopes";
import { calendarIdOf } from "@/lib/calendar/google-sync";
import type { Connection } from "@/lib/types";

type Result = { ok: true; message?: string } | { ok: false; message: string };

function changed() {
  window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
}

async function updateOwnProfile(patch: Record<string, unknown>): Promise<Result> {
  const { error } = await localDb.from("profiles").update(patch).eq("id", LOCAL_USER_ID);
  if (error) return { ok: false, message: error.message };
  changed();
  return { ok: true };
}

const profileInput = z.object({
  display_name: z.string().trim().max(80).optional(),
  locale: z.enum(["en-BE", "nl-BE", "fr-BE", "de-BE", "en-GB"]).optional(),
  theme: z.enum(["dark", "light"]).optional(),
});

export async function updateProfile(input: z.input<typeof profileInput>): Promise<Result> {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const patch: Record<string, unknown> = { ...parsed.data };
  if ("display_name" in parsed.data) patch.display_name = parsed.data.display_name || null;
  return updateOwnProfile(patch);
}

const prefsInput = z.object({
  prefs: z.object({
    upcoming_payment: z.boolean(),
    trial_ending: z.boolean(),
    new_recurring: z.boolean(),
    price_increase: z.boolean(),
    large_purchase: z.boolean(),
    upcoming_bill: z.boolean(),
    event_soon: z.boolean(),
    unusual_spending: z.boolean(),
    charge_after_cancel: z.boolean(),
    days_ahead: z.number().int().min(1).max(30),
  }),
  large_purchase_threshold: z.number().min(10).max(100_000),
});

export async function updateNotificationPrefs(input: z.input<typeof prefsInput>): Promise<Result> {
  const parsed = prefsInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  return updateOwnProfile({ notification_prefs: parsed.data.prefs, large_purchase_threshold: parsed.data.large_purchase_threshold });
}

const privacyInput = z.object({
  ai_assistant_enabled: z.boolean().optional(),
  ai_email_extraction_enabled: z.boolean().optional(),
  email_retention_days: z.number().int().min(30).max(3650).optional(),
});

export async function updatePrivacy(input: z.input<typeof privacyInput>): Promise<Result> {
  const parsed = privacyInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  return updateOwnProfile(parsed.data);
}

const disconnectInput = z.object({ id: z.string().min(1), deleteData: z.boolean() });

/** Removes a Google account: revokes the token at Google (best effort), forgets it, and optionally deletes what it imported. */
export async function disconnectConnection(input: z.input<typeof disconnectInput>): Promise<Result> {
  const parsed = disconnectInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const { data } = await localDb.from("connections").select("*").eq("id", parsed.data.id).maybeSingle();
  const connection = data as Connection | null;
  if (!connection) return { ok: false, message: "Connection not found" };

  const token = getToken(connection.id);
  if (token) await revokeToken(token);
  clearToken(connection.id);

  if (parsed.data.deleteData && connection.provider === "google") {
    const { data: emails } = await localDb.from("emails").select("id").eq("connection_id", connection.id);
    const ids = ((emails ?? []) as { id: string }[]).map((e) => e.id);
    for (let i = 0; i < ids.length; i += 500) await localDb.from("events").delete().eq("source", "email").in("email_id", ids.slice(i, i + 500));
    await localDb.from("emails").delete().eq("connection_id", connection.id);
    if (connection.scopes.includes(GOOGLE_SCOPES.calendar)) {
      // Only this account's calendars: other connected Google accounts keep their events.
      const own = new Set(((connection.sync_state?.calendar as { calendarIds?: string[] } | undefined)?.calendarIds ?? []) as string[]);
      const { data: others } = await localDb.from("connections").select("id, scopes").eq("provider", "google").neq("id", connection.id);
      const otherCalendars = ((others ?? []) as { scopes: string[] }[]).some((c) => c.scopes.includes(GOOGLE_SCOPES.calendar));
      const { data: events } = await localDb.from("events").select("id, external_id").eq("source", "google");
      const doomed = ((events ?? []) as { id: string; external_id: string }[]).filter((e) => !otherCalendars || own.has(calendarIdOf(e.external_id))).map((e) => e.id);
      for (let i = 0; i < doomed.length; i += 500) await localDb.from("events").delete().in("id", doomed.slice(i, i + 500));
    }
  }
  await localDb.from("connections").delete().eq("id", connection.id);
  changed();
  const revoked = token ? "" : " To also remove this app from your Google account, open myaccount.google.com/permissions.";
  return { ok: true, message: `${parsed.data.deleteData ? "Disconnected and imported data deleted." : "Disconnected - previously imported data was kept."}${revoked}` };
}

export async function deleteAllData(confirmation: string): Promise<Result> {
  if (confirmation !== "DELETE") return { ok: false, message: "Type DELETE to confirm" };
  await wipeAll();
  clearLocalSecrets();
  clearAllTokens();
  changed();
  return { ok: true, message: "All data stored in this browser has been deleted." };
}

// There is no account in this edition; deleting "the account" means deleting all local data.
export async function deleteAccount(): Promise<Result> {
  await wipeAll();
  clearLocalSecrets();
  clearAllTokens();
  changed();
  return { ok: true, message: "All data stored in this browser has been deleted." };
}
