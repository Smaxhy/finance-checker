// Settings actions for the GitHub Pages edition (data lives in this browser only).
import { z } from "zod";
import { LOCAL_CHANGE_EVENT, LOCAL_USER_ID, localDb, wipeAll } from "../db";

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

export async function disconnectConnection(): Promise<Result> {
  return { ok: false, message: "Connections aren't available in the GitHub Pages edition." };
}

export async function deleteAllData(confirmation: string): Promise<Result> {
  if (confirmation !== "DELETE") return { ok: false, message: "Type DELETE to confirm" };
  await wipeAll();
  changed();
  return { ok: true, message: "All data stored in this browser has been deleted." };
}

// There is no account in this edition; deleting "the account" means deleting all local data.
export async function deleteAccount(): Promise<Result> {
  await wipeAll();
  changed();
  return { ok: true, message: "All data stored in this browser has been deleted." };
}
