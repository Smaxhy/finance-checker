"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { EVENT_KINDS } from "@/lib/calendar/kind";
import { addDaysKey, zonedToUtc } from "@/lib/calendar/time";
import { userTimezone } from "@/lib/calendar/items";
import type { EventKind } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const timeKey = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const eventInput = z
  .object({
    title: z.string().trim().min(1, "Give the event a title").max(300),
    date: dateKey,
    allDay: z.boolean(),
    startTime: timeKey.optional(),
    endTime: timeKey.optional(),
    endDate: dateKey.optional(),
    location: optionalText(300),
    description: optionalText(2000),
    kind: z.enum(EVENT_KINDS as [EventKind, ...EventKind[]]),
    amountDue: z.number().positive().max(1_000_000).optional().nullable(),
    currency: z.string().length(3).optional(),
    paymentDueDate: dateKey.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.allDay && !v.startTime) ctx.addIssue({ code: "custom", message: "Pick a start time", path: ["startTime"] });
    const end = v.endDate ?? v.date;
    if (end < v.date) ctx.addIssue({ code: "custom", message: "The end date is before the start", path: ["endDate"] });
    if (!v.allDay && v.startTime && v.endTime && end === v.date && v.endTime <= v.startTime) {
      ctx.addIssue({ code: "custom", message: "The end time is before the start", path: ["endTime"] });
    }
  });

export type EventInput = z.input<typeof eventInput>;

function firstIssue(e: z.ZodError) {
  return e.issues[0]?.message ?? "Invalid input";
}

function toRow(v: z.output<typeof eventInput>, tz: string) {
  const endDate = v.endDate ?? v.date;
  const startsAt = zonedToUtc(v.date, v.allDay ? "00:00" : v.startTime!, tz);
  let endsAt: Date | null;
  if (v.allDay) endsAt = zonedToUtc(addDaysKey(endDate, 1), "00:00", tz); // exclusive, like Google
  else if (v.endTime) endsAt = zonedToUtc(endDate, v.endTime, tz);
  else endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  return {
    title: v.title,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    all_day: v.allDay,
    location: v.location,
    description: v.description,
    kind: v.kind,
    amount_due: v.amountDue ?? null,
    currency: v.amountDue ? (v.currency ?? "EUR") : null,
    payment_due_date: v.amountDue ? (v.paymentDueDate ?? null) : null,
  };
}

function revalidateCalendar() {
  revalidatePath("/calendar", "layout");
  revalidatePath("/");
}

export async function createEvent(input: EventInput): Promise<ActionResult> {
  const parsed = eventInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { supabase, user } = await requireUser();
  const tz = await userTimezone(supabase, user.id);
  const { data, error } = await supabase
    .from("events")
    .insert({ ...toRow(parsed.data, tz), user_id: user.id, source: "manual" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not save the event." };
  revalidateCalendar();
  return { ok: true, id: data.id };
}

/** Only manually created events can be edited; synced events are read-only mirrors. */
export async function updateEvent(id: string, input: EventInput): Promise<ActionResult> {
  const idOk = z.uuid().safeParse(id);
  const parsed = eventInput.safeParse(input);
  if (!idOk.success) return { ok: false, error: "Unknown event" };
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { supabase, user } = await requireUser();
  const tz = await userTimezone(supabase, user.id);
  const { data, error } = await supabase.from("events").update(toRow(parsed.data, tz)).eq("id", idOk.data).eq("source", "manual").select("id");
  if (error) return { ok: false, error: "Could not update the event." };
  if (!data?.length) return { ok: false, error: "Only events you created here can be edited." };
  revalidateCalendar();
  return { ok: true, id: idOk.data };
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const idOk = z.uuid().safeParse(id);
  if (!idOk.success) return { ok: false, error: "Unknown event" };
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("events").delete().eq("id", idOk.data).eq("source", "manual").select("id");
  if (error) return { ok: false, error: "Could not delete the event." };
  if (!data?.length) return { ok: false, error: "Only events you created here can be deleted." };
  revalidateCalendar();
  return { ok: true };
}

// ---------------------------------------------------------------- tasks ----

const taskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title").max(300),
  notes: optionalText(2000),
  dueDate: dateKey.optional().nullable(),
  dueTime: timeKey.optional().nullable(),
  remindDate: dateKey.optional().nullable(),
  remindTime: timeKey.optional().nullable(),
  isReminder: z.boolean().default(false),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
});

export type TaskInput = z.input<typeof taskInput>;

function taskRow(v: z.output<typeof taskInput>, tz: string) {
  return {
    title: v.title,
    notes: v.notes,
    due_at: v.dueDate ? zonedToUtc(v.dueDate, v.dueTime ?? "18:00", tz).toISOString() : null,
    remind_at: v.remindDate ? zonedToUtc(v.remindDate, v.remindTime ?? "09:00", tz).toISOString() : null,
    is_reminder: v.isReminder,
    priority: v.priority,
  };
}

export async function createTask(input: TaskInput): Promise<ActionResult> {
  const parsed = taskInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { supabase, user } = await requireUser();
  const tz = await userTimezone(supabase, user.id);
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...taskRow(parsed.data, tz), user_id: user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not save the task." };
  revalidateCalendar();
  return { ok: true, id: data.id };
}

export async function updateTask(id: string, input: TaskInput): Promise<ActionResult> {
  const idOk = z.uuid().safeParse(id);
  const parsed = taskInput.safeParse(input);
  if (!idOk.success) return { ok: false, error: "Unknown task" };
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { supabase, user } = await requireUser();
  const tz = await userTimezone(supabase, user.id);
  const { error } = await supabase.from("tasks").update(taskRow(parsed.data, tz)).eq("id", idOk.data);
  if (error) return { ok: false, error: "Could not update the task." };
  revalidateCalendar();
  return { ok: true, id: idOk.data };
}

export async function setTaskCompleted(id: string, completed: boolean): Promise<ActionResult> {
  const idOk = z.uuid().safeParse(id);
  if (!idOk.success) return { ok: false, error: "Unknown task" };
  const { supabase } = await requireUser();
  const { error } = await supabase
    .from("tasks")
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq("id", idOk.data);
  if (error) return { ok: false, error: "Could not update the task." };
  revalidateCalendar();
  return { ok: true };
}

export async function deleteTask(id: string): Promise<ActionResult> {
  const idOk = z.uuid().safeParse(id);
  if (!idOk.success) return { ok: false, error: "Unknown task" };
  const { supabase } = await requireUser();
  const { error } = await supabase.from("tasks").delete().eq("id", idOk.data);
  if (error) return { ok: false, error: "Could not delete the task." };
  revalidateCalendar();
  return { ok: true };
}
