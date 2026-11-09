import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getProfile, must } from "@/lib/data/core";
import { addDaysKey, dayKeyInTz, formatDayKey, relativeDayKey, timeInTz } from "@/lib/calendar/time";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/misc";
import { CalendarTabs } from "@/components/calendar/calendar-tabs";
import { TaskBoard, type TaskGroup, type TaskView } from "@/components/calendar/tasks";

export const metadata = { title: "Tasks" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default async function TasksPage({ searchParams }: PageProps<"/calendar/tasks">) {
  const sp = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === sp.filter) ? (sp.filter as FilterKey) : "open";
  const { supabase } = await requireUser();
  const profile = await getProfile();
  const tz = profile?.timezone ?? "Europe/Brussels";
  const now = new Date();
  const today = dayKeyInTz(now, tz);

  const rows = must(await supabase.from("tasks").select("*").order("completed_at", { ascending: false, nullsFirst: true }).order("due_at", { ascending: true, nullsFirst: false }).limit(500), "tasks") as Task[];

  const label = (iso: string) => {
    const rel = relativeDayKey(dayKeyInTz(iso, tz), today);
    return `${["Today", "Tomorrow", "Yesterday"].includes(rel) ? rel.toLowerCase() : rel} at ${timeInTz(iso, tz)}`;
  };

  const view: TaskView[] = rows.map((t) => {
    const dueDay = t.due_at ? dayKeyInTz(t.due_at, tz) : null;
    let group: TaskGroup;
    if (t.completed_at) group = "completed";
    else if (!t.due_at || !dueDay) group = "none";
    else if (new Date(t.due_at) < now) group = "overdue";
    else if (dueDay === today) group = "today";
    else if (dueDay <= addDaysKey(today, 7)) group = "week";
    else group = "later";
    return {
      id: t.id,
      title: t.title,
      notes: t.notes,
      priority: t.priority,
      isReminder: t.is_reminder,
      isDemo: t.is_demo,
      completed: Boolean(t.completed_at),
      group,
      dueLabel: t.due_at ? `Due ${label(t.due_at)}` : null,
      remindLabel: t.remind_at ? label(t.remind_at) : null,
      completedLabel: t.completed_at ? `Completed ${formatDayKey(dayKeyInTz(t.completed_at, tz), { day: "numeric", month: "short" })}` : null,
      form: {
        title: t.title,
        notes: t.notes ?? "",
        dueDate: t.due_at ? dayKeyInTz(t.due_at, tz) : "",
        dueTime: t.due_at ? timeInTz(t.due_at, tz) : "",
        remindDate: t.remind_at ? dayKeyInTz(t.remind_at, tz) : "",
        remindTime: t.remind_at ? timeInTz(t.remind_at, tz) : "",
        isReminder: t.is_reminder,
        priority: t.priority,
      },
    };
  });

  const counts = {
    open: view.filter((t) => !t.completed).length,
    overdue: view.filter((t) => t.group === "overdue").length,
    completed: view.filter((t) => t.completed).length,
    all: view.length,
  };
  const shown = view.filter((t) => (filter === "open" ? !t.completed : filter === "overdue" ? t.group === "overdue" : filter === "completed" ? t.completed : true));

  return (
    <div>
      <PageHeader
        title="Tasks & reminders"
        description={`${counts.open} open${counts.overdue ? ` · ${counts.overdue} overdue` : ""} · due dates appear on your calendar and upcoming timeline`}
      >
        <CalendarTabs active="/calendar/tasks" counts={{ "/calendar/tasks": counts.open }} />
      </PageHeader>
      <div className="mx-auto max-w-3xl">
        <TaskBoard
          tasks={shown}
          today={today}
          autoOpen={sp.new === "1"}
          toolbar={
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter tasks">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={f.key === "open" ? "/calendar/tasks" : `/calendar/tasks?filter=${f.key}`}
                  role="tab"
                  aria-selected={filter === f.key}
                  scroll={false}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-medium ring-1 transition-colors ring-inset",
                    filter === f.key ? "bg-surface-3 text-fg ring-border-strong" : "text-muted ring-border hover:text-secondary",
                    f.key === "overdue" && counts.overdue > 0 && filter !== f.key && "text-danger",
                  )}
                >
                  {f.label}
                  <span className="text-[11px] text-muted tabular">{counts[f.key]}</span>
                </Link>
              ))}
            </div>
          }
        />
      </div>
    </div>
  );
}
