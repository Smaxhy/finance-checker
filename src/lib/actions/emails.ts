// Action logic shared by the server edition ("use server" wrappers in src/app/actions)
// and the GitHub Pages edition (runs in the browser against the local store).
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

/**
 * These actions only change Command Centre's own extracted records.
 * Nothing here (or anywhere in the app) sends, modifies or deletes Gmail messages.
 */

const CATEGORIES = ["receipt", "purchase", "order", "shipping", "subscription", "trial", "renewal", "cancellation", "bill", "booking", "travel", "appointment", "important", "other"] as const;

type Result = { ok: true } | { ok: false; message: string };

export async function updateEmailCategory(id: string, category: string): Promise<Result> {
  const parsed = z.object({ id: z.uuid(), category: z.enum(CATEGORIES) }).safeParse({ id, category });
  if (!parsed.success) return { ok: false, message: "Invalid category" };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("emails").update({ category: parsed.data.category }).eq("id", parsed.data.id);
  if (error) return { ok: false, message: error.message };
  await supabase.rpc("log_audit", { p_action: "email.recategorised", p_details: { id: parsed.data.id, category: parsed.data.category } });
  revalidatePath("/emails", "layout");
  return { ok: true };
}

export async function setEmailImportant(id: string, important: boolean): Promise<Result> {
  const parsed = z.object({ id: z.uuid(), important: z.boolean() }).safeParse({ id, important });
  if (!parsed.success) return { ok: false, message: "Invalid request" };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("emails").update({ is_important: parsed.data.important }).eq("id", parsed.data.id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/emails", "layout");
  revalidatePath("/");
  return { ok: true };
}

/** Removes the extracted record from Command Centre only. The message in Gmail is untouched. */
export async function removeEmailRecord(id: string): Promise<Result> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: "Invalid request" };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("emails").delete().eq("id", parsed.data);
  if (error) return { ok: false, message: error.message };
  await supabase.rpc("log_audit", { p_action: "email.record_removed", p_details: { id: parsed.data } });
  revalidatePath("/emails", "layout");
  revalidatePath("/");
  return { ok: true };
}
