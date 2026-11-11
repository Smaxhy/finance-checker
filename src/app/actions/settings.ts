"use server";
import { calendarIdOf } from "@/lib/calendar/google-sync";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { audit, getConnection, listConnections, readSecrets } from "@/lib/integrations/connections";
import { revokeGoogleToken, type GoogleSecrets } from "@/lib/integrations/google/oauth";
import { deleteSession } from "@/lib/integrations/enablebanking";
import { integrationStatus } from "@/lib/env";
import type { Connection } from "@/lib/types";

type Result = { ok: true; message?: string } | { ok: false; message: string };

const profileInput = z.object({
  display_name: z.string().trim().max(80).optional(),
  locale: z.enum(["en-BE", "nl-BE", "fr-BE", "de-BE", "en-GB"]).optional(),
  theme: z.enum(["dark", "light"]).optional(),
});

export async function updateProfile(input: z.input<typeof profileInput>): Promise<Result> {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update({ ...parsed.data, display_name: parsed.data.display_name || null }).eq("id", user.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
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
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("profiles")
    .update({ notification_prefs: parsed.data.prefs, large_purchase_threshold: parsed.data.large_purchase_threshold })
    .eq("id", user.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/settings/preferences");
  return { ok: true };
}

const privacyInput = z.object({
  ai_assistant_enabled: z.boolean().optional(),
  ai_email_extraction_enabled: z.boolean().optional(),
  email_retention_days: z.number().int().min(30).max(3650).optional(),
});

export async function updatePrivacy(input: z.input<typeof privacyInput>): Promise<Result> {
  const parsed = privacyInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const { supabase, user } = await requireUser();
  const { error } = await supabase.from("profiles").update(parsed.data).eq("id", user.id);
  if (error) return { ok: false, message: error.message };
  await supabase.rpc("log_audit", { p_action: "privacy.updated", p_details: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Revoke access at the provider (best effort) - Google token / PSD2 session. */
async function revokeAtProvider(admin: AdminClient, connection: Connection) {
  if (connection.provider === "google" && integrationStatus().google.configured) {
    const secrets = await readSecrets<GoogleSecrets>(admin, connection.id, connection.user_id).catch(() => null);
    if (secrets?.refresh_token) await revokeGoogleToken(secrets.refresh_token);
  }
  if (connection.provider === "enable_banking" && integrationStatus().enableBanking.configured) {
    const secrets = await readSecrets<{ session_id: string }>(admin, connection.id, connection.user_id).catch(() => null);
    if (secrets?.session_id) await deleteSession(secrets.session_id).catch(() => undefined);
  }
}

async function deleteConnectionData(admin: AdminClient, userId: string, connection: Connection) {
  if (connection.provider === "google") {
    const { data: emails } = await admin.from("emails").select("id").eq("user_id", userId).eq("connection_id", connection.id);
    const ids = ((emails ?? []) as { id: string }[]).map((e) => e.id);
    for (let i = 0; i < ids.length; i += 500) await admin.from("events").delete().eq("user_id", userId).eq("source", "email").in("email_id", ids.slice(i, i + 500));
    await admin.from("emails").delete().eq("user_id", userId).eq("connection_id", connection.id);
    if (connection.scopes.some((s) => s.includes("calendar"))) {
      // Only this account's calendars when other Google calendar accounts are connected.
      const own = new Set((connection.sync_state?.calendar as { calendarIds?: string[] } | undefined)?.calendarIds ?? []);
      const { data: others } = await admin.from("connections").select("scopes").eq("user_id", userId).eq("provider", "google").neq("id", connection.id);
      const otherCalendars = ((others ?? []) as { scopes: string[] }[]).some((c) => c.scopes.some((s) => s.includes("calendar")));
      if (!otherCalendars) {
        await admin.from("events").delete().eq("user_id", userId).eq("source", "google");
      } else {
        const { data: events } = await admin.from("events").select("id, external_id").eq("user_id", userId).eq("source", "google");
        const doomed = ((events ?? []) as { id: string; external_id: string }[]).filter((e) => own.has(calendarIdOf(e.external_id))).map((e) => e.id);
        for (let i = 0; i < doomed.length; i += 200) await admin.from("events").delete().eq("user_id", userId).in("id", doomed.slice(i, i + 200));
      }
    }
  }
  if (connection.provider === "enable_banking") {
    // Deleting the accounts cascades to their transactions.
    await admin.from("accounts").delete().eq("user_id", userId).eq("connection_id", connection.id);
  }
}

const disconnectInput = z.object({ id: z.uuid(), deleteData: z.boolean() });

export async function disconnectConnection(input: z.input<typeof disconnectInput>): Promise<Result> {
  const parsed = disconnectInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid input" };
  const { user } = await requireUser();
  const admin = createAdminClient();
  const connection = await getConnection(admin, parsed.data.id, user.id);
  if (!connection) return { ok: false, message: "Connection not found" };
  await revokeAtProvider(admin, connection);
  if (parsed.data.deleteData) await deleteConnectionData(admin, user.id, connection);
  await admin.from("connections").delete().eq("id", connection.id).eq("user_id", user.id);
  await audit(admin, user.id, `connection.${connection.provider}.disconnected`, { label: connection.label, deletedData: parsed.data.deleteData });
  revalidatePath("/", "layout");
  return { ok: true, message: parsed.data.deleteData ? "Disconnected and imported data deleted" : "Disconnected - previously imported data was kept" };
}

const USER_TABLES = ["notifications", "events", "tasks", "transactions", "subscriptions", "emails", "budgets", "category_rules", "accounts", "sync_runs", "connections"] as const;

async function wipeUserData(admin: AdminClient, userId: string) {
  for (const c of await listConnections(admin, userId)) await revokeAtProvider(admin, c);
  for (const table of USER_TABLES) {
    const { error } = await admin.from(table).delete().eq("user_id", userId);
    if (error) throw new Error(`Could not delete ${table}: ${error.message}`);
  }
  await admin.from("categories").delete().eq("user_id", userId);
}

export async function deleteAllData(confirmation: string): Promise<Result> {
  if (confirmation !== "DELETE") return { ok: false, message: 'Type DELETE to confirm' };
  const { user } = await requireUser();
  const admin = createAdminClient();
  try {
    await wipeUserData(admin, user.id);
    await audit(admin, user.id, "privacy.all_data_deleted", {});
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Deletion failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "All your data has been deleted. Your account still exists." };
}

export async function deleteAccount(confirmation: string): Promise<Result> {
  const { user, supabase } = await requireUser();
  if (!user.email || confirmation.trim().toLowerCase() !== user.email.toLowerCase()) return { ok: false, message: "Type your email address to confirm" };
  const admin = createAdminClient();
  try {
    await wipeUserData(admin, user.id);
    // Removing the auth user cascades to the profile and any remaining rows.
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(error.message);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Account deletion failed" };
  }
  await supabase.auth.signOut().catch(() => undefined);
  redirect("/login?deleted=1");
}
