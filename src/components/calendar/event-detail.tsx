"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink, Lock, Mail, MapPin, Pencil, Trash2, Wallet } from "lucide-react";
import { deleteEvent } from "@/app/actions/calendar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EVENT_ICONS } from "@/components/lists/lists";
import { EVENT_KIND_LABEL } from "@/lib/calendar/kind";
import { formatMoney } from "@/lib/format";
import type { CalendarEvent } from "@/lib/types";
import { EventFormDialog, type EventFormValues } from "./event-form";

export interface EventDetailData {
  event: CalendarEvent;
  whenLabel: string;
  paymentDueLabel: string | null;
  emailSubject: string | null;
  form: EventFormValues | null; // set for editable (manual) events
}

const SOURCE_LABEL: Record<CalendarEvent["source"], string> = {
  google: "Google Calendar",
  email: "Found in email",
  manual: "Created here",
  demo: "Sample data",
};

export function EventDetailDialog({ data, closeHref }: { data: EventDetailData | null; closeHref: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const close = () => router.replace(closeHref, { scroll: false });

  if (!data) return null;
  const { event: ev } = data;
  const Icon = EVENT_ICONS[ev.kind];
  const editable = ev.source === "manual" && data.form;

  return (
    <>
      <Dialog open={!editing} onOpenChange={(o) => !o && close()}>
        <DialogContent
          title={
            <span className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-accent-soft text-accent-text">
                <Icon className="size-3.5" />
              </span>
              <span className={ev.status === "cancelled" ? "text-muted line-through" : undefined}>{ev.title}</span>
            </span>
          }
          description={data.whenLabel}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{EVENT_KIND_LABEL[ev.kind]}</Badge>
              <Badge tone="outline">{SOURCE_LABEL[ev.source]}</Badge>
              {ev.calendar_name && <Badge tone="neutral">{ev.calendar_name}</Badge>}
              {ev.status !== "confirmed" && <Badge tone={ev.status === "cancelled" ? "danger" : "warning"}>{ev.status === "cancelled" ? "Cancelled" : "Tentative"}</Badge>}
              {ev.is_demo && <DemoBadge />}
            </div>

            <dl className="space-y-2.5 text-[13px]">
              {ev.location && (
                <div className="flex gap-3">
                  <dt className="sr-only">Location</dt>
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                  <dd className="break-words">{ev.location}</dd>
                </div>
              )}
              {ev.amount_due ? (
                <div className="flex gap-3">
                  <dt className="sr-only">Amount due</dt>
                  <Wallet className="mt-0.5 size-4 shrink-0 text-muted" />
                  <dd>
                    <span className="font-medium tabular">{formatMoney(Number(ev.amount_due), ev.currency ?? "EUR")}</span> still to pay
                    {data.paymentDueLabel ? ` · due ${data.paymentDueLabel}` : ev.kind === "hotel" ? " at check-in" : ""}
                  </dd>
                </div>
              ) : null}
              {ev.email_id && (
                <div className="flex gap-3">
                  <dt className="sr-only">Source email</dt>
                  <Mail className="mt-0.5 size-4 shrink-0 text-muted" />
                  <dd>
                    <Link href={`/emails?id=${ev.email_id}`} className="text-accent-text hover:underline">
                      {data.emailSubject ?? "Open the email it came from"}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>

            {ev.description && <p className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-[12.5px] whitespace-pre-line text-secondary">{ev.description}</p>}

            {!editable && (
              <p className="flex items-start gap-2 text-[12px] text-muted">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                {ev.source === "google"
                  ? "Synced read-only from Google Calendar. Edit it in Google Calendar; changes appear on the next sync."
                  : ev.source === "email"
                    ? "Created from an email. It can't be edited here, so the original stays the source of truth."
                    : "Sample data. Remove all demo data from Preferences."}
              </p>
            )}

            {(ev.html_link || editable) && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                {ev.html_link && (
                  <a href={ev.html_link} target="_blank" rel="noopener noreferrer" className="mr-auto inline-flex items-center gap-1.5 text-[12.5px] text-accent-text hover:underline">
                    Open in Google Calendar <ExternalLink className="size-3.5" />
                  </a>
                )}
                {editable &&
                  (confirmDelete ? (
                    <>
                      <span className="text-[12.5px] text-muted">Delete this event?</span>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                        Keep
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const res = await deleteEvent(ev.id);
                            if (!res.ok) return void toast.error(res.error ?? "Could not delete");
                            toast.success("Event deleted");
                            close();
                            router.refresh();
                          })
                        }
                      >
                        <Trash2 /> Delete
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                        <Trash2 /> Delete
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                        <Pencil /> Edit
                      </Button>
                    </>
                  ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {editable && data.form && (
        <EventFormDialog
          open={editing}
          onOpenChange={(o) => {
            setEditing(o);
            if (!o) router.refresh();
          }}
          initial={data.form}
        />
      )}
    </>
  );
}
