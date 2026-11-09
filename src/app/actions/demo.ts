"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { applyDemoSubscriptionStates, clearDemo, seedDemoData } from "@/lib/demo/seed";
import { runPipeline } from "@/lib/engines/pipeline";

export async function loadDemoData(): Promise<{ ok: boolean; message: string }> {
  const { supabase, user } = await requireUser();
  try {
    const seeded = await seedDemoData(supabase, user.id);
    // Run the real detection pipeline over the sample data.
    await runPipeline(supabase, user.id, { demo: true });
    await applyDemoSubscriptionStates(supabase);
    await supabase.rpc("log_audit", { p_action: "demo.load", p_details: seeded });
    revalidatePath("/", "layout");
    return { ok: true, message: `${seeded.transactions} transactions, ${seeded.emails} emails and ${seeded.events} events - all marked DEMO.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not load demo data" };
  }
}

export async function clearDemoData(): Promise<{ ok: boolean; message: string }> {
  const { supabase } = await requireUser();
  try {
    await clearDemo(supabase);
    await supabase.rpc("log_audit", { p_action: "demo.clear", p_details: {} });
    revalidatePath("/", "layout");
    return { ok: true, message: "Demo data removed" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not remove demo data" };
  }
}
