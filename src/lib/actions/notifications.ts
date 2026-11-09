// Action logic shared by the server edition ("use server" wrappers in src/app/actions)
// and the GitHub Pages edition (runs in the browser against the local store).
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { refreshNotificationsForUser } from "@/lib/engines/notifications";

export async function markNotificationRead(id: string) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return;
  const { supabase } = await requireUser();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", parsed.data).is("read_at", null);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const { supabase } = await requireUser();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/", "layout");
}

export async function deleteNotification(id: string) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return;
  const { supabase } = await requireUser();
  await supabase.from("notifications").delete().eq("id", parsed.data);
  revalidatePath("/", "layout");
}

export async function refreshNotifications() {
  const { supabase, user } = await requireUser();
  const created = await refreshNotificationsForUser(supabase, user.id);
  revalidatePath("/", "layout");
  return { created };
}
