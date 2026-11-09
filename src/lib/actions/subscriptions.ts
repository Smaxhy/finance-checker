// Action logic shared by the server edition ("use server" wrappers in src/app/actions)
// and the GitHub Pages edition (runs in the browser against the local store).
import { revalidatePath } from "@/lib/revalidate";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { normaliseMerchant, slugify } from "@/lib/finance/merchants";
import { toISODate } from "@/lib/dates";
import type { SubscriptionStatus } from "@/lib/types";

/**
 * Subscription management. Nothing here contacts a provider: cancellation
 * state only ever changes because the user explicitly says so.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  id?: string;
}

const id = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optionalDate = z.union([isoDate, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));
const cycle = z.enum(["weekly", "monthly", "quarterly", "semiannual", "yearly", "unknown"]);
const httpsUrl = z
  .union([z.url({ protocol: /^https$/ }), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const editable = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  amount: z.coerce.number().min(0).max(100000).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("EUR"),
  billing_cycle: cycle,
  next_payment_date: optionalDate,
  payment_method: optionalText(80),
  category_id: z.string().min(1).max(60),
  notes: optionalText(1000),
  cancellation_deadline: optionalDate,
  cancel_url: httpsUrl,
});

function revalidate(subscriptionId?: string) {
  revalidatePath("/subscriptions", "layout");
  if (subscriptionId) revalidatePath(`/subscriptions/${subscriptionId}`);
  revalidatePath("/", "layout");
}

function fail(e: unknown): ActionResult {
  if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Invalid input" };
  return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
}

const createSchema = editable.extend({
  status: z.enum(["active", "trial"]).default("active"),
  trial_ends_at: optionalDate,
});

export async function createSubscription(input: z.input<typeof createSchema>): Promise<ActionResult> {
  try {
    const data = createSchema.parse(input);
    if (data.status === "trial" && !data.trial_ends_at) return { ok: false, message: "Add the date the free trial ends" };
    const { supabase, user } = await requireUser();
    const merchant = normaliseMerchant(data.name);
    const entry = merchant.entry;
    const { data: row, error } = await supabase
      .from("subscriptions")
      .insert({
        user_id: user.id,
        name: data.name,
        provider: entry?.name ?? data.name,
        merchant_key: entry?.key ?? (slugify(data.name) || "manual"),
        category_id: data.category_id,
        amount: data.amount ?? null,
        currency: data.currency,
        billing_cycle: data.billing_cycle,
        status: data.status,
        trial_ends_at: data.status === "trial" ? data.trial_ends_at : null,
        next_payment_date: data.status === "trial" ? data.trial_ends_at : data.next_payment_date,
        payment_method: data.payment_method,
        notes: data.notes,
        cancellation_deadline: data.cancellation_deadline,
        cancel_url: data.cancel_url ?? entry?.subscription?.cancelUrl ?? null,
        cancel_instructions: entry?.subscription?.steps.join("\n") ?? null,
        started_at: toISODate(new Date()),
        detection_source: "manual",
        user_confirmed: true,
        last_reviewed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { ok: false, message: `You're already tracking a ${data.billing_cycle} ${data.name} subscription.` };
      return { ok: false, message: error.message };
    }
    await supabase.rpc("log_audit", { p_action: "subscription.create", p_details: { id: row.id, name: data.name } });
    revalidate(row.id);
    return { ok: true, message: `${data.name} added`, id: row.id };
  } catch (e) {
    return fail(e);
  }
}

export async function updateSubscription(subscriptionId: string, input: z.input<typeof editable>): Promise<ActionResult> {
  try {
    const sid = id.parse(subscriptionId);
    const data = editable.parse(input);
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("subscriptions")
      .update({
        name: data.name,
        amount: data.amount ?? null,
        currency: data.currency,
        billing_cycle: data.billing_cycle,
        next_payment_date: data.next_payment_date,
        payment_method: data.payment_method,
        category_id: data.category_id,
        notes: data.notes,
        cancellation_deadline: data.cancellation_deadline,
        cancel_url: data.cancel_url,
      })
      .eq("id", sid);
    if (error) return { ok: false, message: error.code === "23505" ? "Another subscription with this name and billing cycle already exists." : error.message };
    revalidate(sid);
    return { ok: true, message: "Changes saved" };
  } catch (e) {
    return fail(e);
  }
}

async function setFields(subscriptionId: string, fields: Record<string, unknown>, audit?: { action: string; details?: Record<string, unknown> }, allowedFrom?: SubscriptionStatus[]): Promise<ActionResult> {
  const sid = id.parse(subscriptionId);
  const { supabase } = await requireUser();
  if (allowedFrom) {
    const { data: current } = await supabase.from("subscriptions").select("status").eq("id", sid).maybeSingle();
    if (!current) return { ok: false, message: "Subscription not found" };
    if (!allowedFrom.includes(current.status as SubscriptionStatus)) return { ok: false, message: "That change isn't possible from the current status." };
  }
  const { data, error } = await supabase.from("subscriptions").update(fields).eq("id", sid).select("id, name").maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Subscription not found" };
  if (audit) await supabase.rpc("log_audit", { p_action: audit.action, p_details: { id: sid, name: data.name, ...(audit.details ?? {}) } });
  revalidate(sid);
  return { ok: true, message: "Updated" };
}

export async function confirmDetection(subscriptionId: string): Promise<ActionResult> {
  try {
    const r = await setFields(subscriptionId, { user_confirmed: true, dismissed: false, last_reviewed_at: new Date().toISOString() });
    return r.ok ? { ...r, message: "Confirmed as a recurring payment" } : r;
  } catch (e) {
    return fail(e);
  }
}

export async function dismissSubscription(subscriptionId: string): Promise<ActionResult> {
  try {
    const r = await setFields(subscriptionId, { dismissed: true, user_confirmed: false }, { action: "subscription.dismiss" });
    return r.ok ? { ...r, message: "Dismissed - it won't count as a subscription" } : r;
  } catch (e) {
    return fail(e);
  }
}

export async function restoreSubscription(subscriptionId: string): Promise<ActionResult> {
  try {
    const r = await setFields(subscriptionId, { dismissed: false });
    return r.ok ? { ...r, message: "Restored" } : r;
  } catch (e) {
    return fail(e);
  }
}

export async function markReviewed(subscriptionId: string): Promise<ActionResult> {
  try {
    const r = await setFields(subscriptionId, { last_reviewed_at: new Date().toISOString(), user_confirmed: true });
    return r.ok ? { ...r, message: "Marked as reviewed" } : r;
  } catch (e) {
    return fail(e);
  }
}

/** The user says they asked the provider to cancel. Not the same as cancelled. */
export async function requestCancellation(subscriptionId: string, deadline?: string | null): Promise<ActionResult> {
  try {
    const d = optionalDate.parse(deadline ?? null);
    const fields: Record<string, unknown> = { status: "cancellation_pending", cancellation_requested_at: new Date().toISOString() };
    if (d) fields.cancellation_deadline = d;
    const r = await setFields(subscriptionId, fields, { action: "subscription.cancellation_requested" }, ["active", "trial", "paused"]);
    return r.ok ? { ...r, message: "Marked as cancellation requested - waiting for the provider's confirmation" } : r;
  } catch (e) {
    return fail(e);
  }
}

const confirmSchema = z.object({
  acknowledged: z.literal(true, { error: "Tick the box to confirm you received a confirmation from the provider" }),
  reference: optionalText(200),
});

/** Only the user can declare a cancellation confirmed, and only with an explicit acknowledgement. */
export async function confirmCancellation(subscriptionId: string, input: { acknowledged: boolean; reference?: string | null }): Promise<ActionResult> {
  try {
    const data = confirmSchema.parse(input);
    const now = new Date().toISOString();
    const { supabase } = await requireUser();
    const sid = id.parse(subscriptionId);
    const { data: current } = await supabase.from("subscriptions").select("cancellation_requested_at, status").eq("id", sid).maybeSingle();
    if (!current) return { ok: false, message: "Subscription not found" };
    if (current.status === "cancelled") return { ok: false, message: "This subscription is already marked as cancelled." };
    const r = await setFields(
      sid,
      {
        status: "cancelled",
        cancellation_confirmed_at: now,
        cancellation_requested_at: current.cancellation_requested_at ?? now,
        cancellation_reference: data.reference,
        user_confirmed: true,
      },
      { action: "subscription.cancellation_confirmed", details: { reference: data.reference } },
    );
    return r.ok ? { ...r, message: "Cancellation confirmed. We'll alert you if it charges again." } : r;
  } catch (e) {
    return fail(e);
  }
}

/** Undo a cancellation request/confirmation (e.g. the provider never processed it, or you re-subscribed). */
export async function reactivateSubscription(subscriptionId: string): Promise<ActionResult> {
  try {
    const sid = id.parse(subscriptionId);
    const { supabase } = await requireUser();
    const { data: current } = await supabase.from("subscriptions").select("trial_ends_at, status").eq("id", sid).maybeSingle();
    if (!current) return { ok: false, message: "Subscription not found" };
    const status: SubscriptionStatus = current.trial_ends_at && current.trial_ends_at >= toISODate(new Date()) ? "trial" : "active";
    const r = await setFields(
      sid,
      { status, cancellation_requested_at: null, cancellation_confirmed_at: null, cancellation_reference: null, dismissed: false },
      { action: "subscription.reactivated", details: { from: current.status } },
    );
    return r.ok ? { ...r, message: "Subscription is active again" } : r;
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSubscription(subscriptionId: string): Promise<ActionResult> {
  try {
    const sid = id.parse(subscriptionId);
    const { supabase } = await requireUser();
    const { data: current } = await supabase.from("subscriptions").select("detection_source, name").eq("id", sid).maybeSingle();
    if (!current) return { ok: false, message: "Subscription not found" };
    if (current.detection_source !== "manual") return { ok: false, message: "Detected subscriptions can't be deleted - dismiss it instead so it isn't re-detected." };
    const { error } = await supabase.from("subscriptions").delete().eq("id", sid);
    if (error) return { ok: false, message: error.message };
    await supabase.rpc("log_audit", { p_action: "subscription.delete", p_details: { id: sid, name: current.name } });
    revalidate();
    return { ok: true, message: `${current.name} deleted` };
  } catch (e) {
    return fail(e);
  }
}
