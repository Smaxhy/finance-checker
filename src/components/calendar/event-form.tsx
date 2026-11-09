"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { createEvent, updateEvent, type EventInput } from "@/app/actions/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { EVENT_KINDS, EVENT_KIND_LABEL } from "@/lib/calendar/kind";
import type { EventKind } from "@/lib/types";

export interface EventFormValues {
  id?: string;
  title: string;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  kind: EventKind;
  amountDue: string;
  paymentDueDate: string;
}

export function emptyEvent(date: string): EventFormValues {
  return { title: "", date, endDate: date, allDay: false, startTime: "09:00", endTime: "10:00", location: "", description: "", kind: "personal", amountDue: "", paymentDueDate: "" };
}

function EventForm({ initial, onDone }: { initial: EventFormValues; onDone: () => void }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof EventFormValues>(k: K, val: EventFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = v.amountDue.trim() ? Number(v.amountDue.replace(",", ".")) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      setError("Enter a positive amount, or leave it empty");
      return;
    }
    const input: EventInput = {
      title: v.title,
      date: v.date,
      endDate: v.endDate || v.date,
      allDay: v.allDay,
      startTime: v.allDay ? undefined : v.startTime,
      endTime: v.allDay ? undefined : v.endTime || undefined,
      location: v.location,
      description: v.description,
      kind: v.kind,
      amountDue: amount,
      currency: "EUR",
      paymentDueDate: amount && v.paymentDueDate ? v.paymentDueDate : null,
    };
    start(async () => {
      const res = v.id ? await updateEvent(v.id, input) : await createEvent(input);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      toast.success(v.id ? "Event updated" : "Event created", { description: v.title });
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title">
        <Input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Dinner with Sam" autoFocus required maxLength={300} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={v.date} onChange={(e) => setV((s) => ({ ...s, date: e.target.value, endDate: s.endDate < e.target.value ? e.target.value : s.endDate }))} required />
        </Field>
        <Field label="Ends on">
          <Input type="date" value={v.endDate} min={v.date} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2/50 px-3 py-2">
        <span className="text-[13px] text-secondary">All day</span>
        <Switch checked={v.allDay} onChange={(c) => set("allDay", c)} label="All day" />
      </div>
      {!v.allDay && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <Input type="time" value={v.startTime} onChange={(e) => set("startTime", e.target.value)} required />
          </Field>
          <Field label="Ends">
            <Input type="time" value={v.endTime} onChange={(e) => set("endTime", e.target.value)} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={v.kind} onChange={(e) => set("kind", e.target.value as EventKind)}>
            {EVENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {EVENT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location">
          <Input value={v.location} onChange={(e) => set("location", e.target.value)} placeholder="Optional" maxLength={300} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount still to pay (€)" hint="Shown as an expected expense.">
          <Input inputMode="decimal" value={v.amountDue} onChange={(e) => set("amountDue", e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Payment due on">
          <Input type="date" value={v.paymentDueDate} onChange={(e) => set("paymentDueDate", e.target.value)} disabled={!v.amountDue.trim()} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={v.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" maxLength={2000} rows={3} />
      </Field>
      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {v.id ? "Save changes" : "Create event"}
        </Button>
      </div>
    </form>
  );
}

export function EventFormDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: EventFormValues;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={initial.id ? "Edit event" : "New event"} description="Events you create here stay in Command Centre - nothing is written to Google Calendar.">
        {open ? <EventForm key={initial.id ?? initial.date} initial={initial} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

export function NewEventButton({
  date,
  autoOpen = false,
  variant = "primary",
  size = "md",
  children,
}: {
  date: string;
  autoOpen?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(autoOpen);
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    // Drop ?new=event once the dialog closes so a refresh doesn't reopen it.
    if (!o && autoOpen && typeof window !== "undefined" && window.location.search.includes("new=")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  };
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Plus /> {children ?? "New event"}
      </Button>
      <EventFormDialog open={open} onOpenChange={onOpenChange} initial={emptyEvent(date)} />
    </>
  );
}
