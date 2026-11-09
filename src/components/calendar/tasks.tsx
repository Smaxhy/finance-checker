"use client";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, Check, Flag, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { createTask, deleteTask, setTaskCompleted, updateTask, type TaskInput } from "@/app/actions/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TaskGroup = "overdue" | "today" | "week" | "later" | "none" | "completed";

export interface TaskView {
  id: string;
  title: string;
  notes: string | null;
  priority: "low" | "normal" | "high";
  isReminder: boolean;
  isDemo: boolean;
  completed: boolean;
  group: TaskGroup;
  dueLabel: string | null;
  remindLabel: string | null;
  completedLabel: string | null;
  form: TaskFormValues;
}

export interface TaskFormValues {
  title: string;
  notes: string;
  dueDate: string;
  dueTime: string;
  remindDate: string;
  remindTime: string;
  isReminder: boolean;
  priority: "low" | "normal" | "high";
}

const GROUP_LABEL: Record<TaskGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "Next 7 days",
  later: "Later",
  none: "No due date",
  completed: "Completed",
};
const GROUP_ORDER: TaskGroup[] = ["overdue", "today", "week", "later", "none", "completed"];

export function emptyTask(today: string): TaskFormValues {
  return { title: "", notes: "", dueDate: today, dueTime: "", remindDate: "", remindTime: "", isReminder: false, priority: "normal" };
}

function toInput(v: TaskFormValues): TaskInput {
  return {
    title: v.title,
    notes: v.notes,
    dueDate: v.dueDate || null,
    dueTime: v.dueDate && v.dueTime ? v.dueTime : null,
    remindDate: v.remindDate || null,
    remindTime: v.remindDate && v.remindTime ? v.remindTime : null,
    isReminder: v.isReminder,
    priority: v.priority,
  };
}

function TaskForm({ id, initial, onDone }: { id?: string; initial: TaskFormValues; onDone: () => void }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof TaskFormValues>(k: K, val: TaskFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = id ? await updateTask(id, toInput(v)) : await createTask(toInput(v));
          if (!res.ok) return void setError(res.error ?? "Something went wrong");
          toast.success(id ? "Task updated" : v.isReminder ? "Reminder created" : "Task created", { description: v.title });
          onDone();
          router.refresh();
        });
      }}
    >
      <Field label="Title">
        <Input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Renew identity card" autoFocus required maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Due date">
          <Input type="date" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label="Due time" hint={v.dueDate && !v.dueTime ? "Defaults to 18:00" : undefined}>
          <Input type="time" value={v.dueTime} onChange={(e) => set("dueTime", e.target.value)} disabled={!v.dueDate} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Remind me on">
          <Input type="date" value={v.remindDate} onChange={(e) => set("remindDate", e.target.value)} />
        </Field>
        <Field label="At">
          <Input type="time" value={v.remindTime} onChange={(e) => set("remindTime", e.target.value)} disabled={!v.remindDate} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <Select value={v.priority} onChange={(e) => set("priority", e.target.value as TaskFormValues["priority"])}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <div className="flex h-8 w-full items-center justify-between rounded-lg border border-border bg-surface-2/50 px-3">
            <span className="text-[13px] text-secondary">It&apos;s a reminder</span>
            <Switch checked={v.isReminder} onChange={(c) => set("isReminder", c)} label="Reminder" />
          </div>
        </div>
      </div>
      <Field label="Notes">
        <Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Optional" maxLength={2000} />
      </Field>
      <p className="text-[12px] text-muted">Reminders show up in your upcoming timeline and notifications inside the app.</p>
      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {id ? "Save changes" : "Create"}
        </Button>
      </div>
    </form>
  );
}

export function TaskBoard({ tasks, today, autoOpen, toolbar }: { tasks: TaskView[]; today: string; autoOpen: boolean; toolbar?: React.ReactNode }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ id?: string; initial: TaskFormValues } | null>(autoOpen ? { initial: emptyTask(today) } : null);
  const [, start] = useTransition();
  const [optimistic, applyOptimistic] = useOptimistic(tasks, (state, change: { id: string; completed?: boolean; deleted?: boolean }) =>
    change.deleted ? state.filter((t) => t.id !== change.id) : state.map((t) => (t.id === change.id ? { ...t, completed: change.completed ?? t.completed } : t)),
  );

  const toggle = (t: TaskView) =>
    start(async () => {
      applyOptimistic({ id: t.id, completed: !t.completed });
      const res = await setTaskCompleted(t.id, !t.completed);
      if (!res.ok) toast.error(res.error ?? "Could not update the task");
      else if (!t.completed) toast.success("Task completed", { description: t.title });
      router.refresh();
    });

  const remove = (t: TaskView) =>
    start(async () => {
      applyOptimistic({ id: t.id, deleted: true });
      const res = await deleteTask(t.id);
      if (!res.ok) toast.error(res.error ?? "Could not delete the task");
      router.refresh();
    });

  const closeDialog = () => {
    setDialog(null);
    // Drop ?new=1 (from the command palette) so a refresh doesn't reopen the dialog.
    if (autoOpen && typeof window !== "undefined" && window.location.search.includes("new=")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  };

  const groups = GROUP_ORDER.map((g) => ({ g, list: optimistic.filter((t) => t.group === g) })).filter((x) => x.list.length > 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {toolbar}
        <Button variant="primary" onClick={() => setDialog({ initial: emptyTask(today) })}>
          <Plus /> New task
        </Button>
      </div>
      {groups.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <Check className="size-5 text-muted" />
          <p className="mt-2 text-[13.5px] font-medium">Nothing here</p>
          <p className="mt-1 text-[12.5px] text-muted">Create a task or reminder - it will also appear in your upcoming timeline.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(({ g, list }) => (
            <section key={g} aria-label={GROUP_LABEL[g]}>
              <h2 className={cn("mb-2 px-1 text-[12.5px] font-medium", g === "overdue" ? "text-danger" : "text-secondary")}>
                {GROUP_LABEL[g]} <span className="ml-1 text-muted tabular">{list.length}</span>
              </h2>
              <ul className="card divide-y divide-border p-0">
                {list.map((t) => (
                  <li key={t.id} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2/60">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={t.completed}
                      aria-label={t.completed ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
                      onClick={() => toggle(t)}
                      className={cn(
                        "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-all duration-150",
                        t.completed ? "border-accent-strong bg-accent-strong text-white" : "border-border-strong hover:border-accent",
                      )}
                    >
                      {t.completed && <Check className="size-3" strokeWidth={3} />}
                    </button>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDialog({ id: t.id, initial: t.form })}>
                      <p className={cn("flex flex-wrap items-center gap-1.5 text-[13px] font-medium transition-colors", t.completed && "text-muted line-through")}>
                        {t.title}
                        {t.priority === "high" && !t.completed && (
                          <Badge tone="warning">
                            <Flag /> High
                          </Badge>
                        )}
                        {t.isReminder && (
                          <Badge tone="accent">
                            <Bell /> Reminder
                          </Badge>
                        )}
                        {t.isDemo && <DemoBadge />}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {[t.completed ? t.completedLabel : t.dueLabel, !t.completed && t.remindLabel ? `remind ${t.remindLabel}` : null].filter(Boolean).join(" · ") || "No due date"}
                      </p>
                      {t.notes && <p className="mt-1 line-clamp-2 text-[12px] text-secondary">{t.notes}</p>}
                    </button>
                    <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" aria-label="Edit task" onClick={() => setDialog({ id: t.id, initial: t.form })}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete task" onClick={() => remove(t)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Dialog open={dialog !== null} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent title={dialog?.id ? "Edit task" : "New task or reminder"}>
          {dialog ? <TaskForm key={dialog.id ?? "new"} id={dialog.id} initial={dialog.initial} onDone={closeDialog} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
