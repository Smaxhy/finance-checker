"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { CircleCheck, ExternalLink, Info, Loader2, MailCheck, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { Subscription } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { confirmCancellation, reactivateSubscription, requestCancellation } from "@/app/actions/subscriptions";
import { formatDate, formatDateTime, relativeDay } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CancellationEvidence {
  id: string;
  subject: string | null;
  received_at: string;
}

/**
 * Guided, user-driven cancellation. The app never cancels anything itself and
 * never infers a cancellation from a click: each status change is an explicit
 * statement by the user.
 */
export function CancellationPanel({
  subscription: s,
  steps,
  evidence,
}: {
  subscription: Subscription;
  steps: string[];
  evidence: CancellationEvidence[];
}) {
  const [pending, start] = useTransition();
  const [requestOpen, setRequestOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reference, setReference] = useState("");
  const [deadline, setDeadline] = useState(s.cancellation_deadline ?? "");
  const [openedLink, setOpenedLink] = useState(false);

  const provider = s.provider ?? s.name;
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        after?.();
      } else toast.error(res.message);
    });

  const isCancelled = s.status === "cancelled" || s.status === "expired";
  const isPending = s.status === "cancellation_pending";

  return (
    <div className="space-y-5">
      <div
        className={cn(
          "flex items-start gap-3 rounded-lg border px-3.5 py-3 text-[12.5px]",
          isCancelled ? "border-positive/25 bg-positive-soft text-positive" : isPending ? "border-warning/25 bg-warning-soft text-warning" : "border-border bg-surface-2 text-secondary",
        )}
      >
        {isCancelled ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : isPending ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
        <div>
          {isCancelled ? (
            <p>
              You confirmed this cancellation on {formatDateTime(s.cancellation_confirmed_at)}
              {s.cancellation_reference ? ` (reference: ${s.cancellation_reference})` : ""}. We&apos;ll alert you if {s.name} charges you again.
            </p>
          ) : isPending ? (
            <p>
              You requested cancellation {s.cancellation_requested_at ? relativeDay(s.cancellation_requested_at) : ""}. Until {provider} confirms it, treat it as
              still active - it may charge you again.
              {s.cancellation_deadline ? ` Deadline: ${formatDate(s.cancellation_deadline, "medium")}.` : ""}
            </p>
          ) : (
            <p>
              This app never cancels anything for you and never assumes a cancellation worked. You cancel with {provider} directly, then record what happened here.
            </p>
          )}
        </div>
      </div>

      {!isCancelled && (
        <>
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-secondary">How to cancel</p>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-secondary tabular">{i + 1}</span>
                  <span className="text-secondary">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {s.cancel_url ? (
            <div className="rounded-lg border border-border p-3.5">
              <a
                href={s.cancel_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpenedLink(true)}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-text hover:underline"
              >
                Open {provider}&apos;s official cancellation page <ExternalLink className="size-3.5" />
              </a>
              <p className="mt-1 truncate text-[11.5px] text-muted">{s.cancel_url}</p>
              <p className="mt-1.5 text-[11.5px] text-muted">
                External site. Opening it does not change anything here{openedLink ? " - when you've finished, record the result below." : "."}
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-muted">No official cancellation link is known for this provider. Add one via Edit if you have it.</p>
          )}
        </>
      )}

      {evidence.length > 0 && !isCancelled && (
        <div className="rounded-lg border border-positive/25 bg-positive-soft/50 p-3.5">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-positive">
            <MailCheck className="size-4" /> Possible confirmation found in your email
          </p>
          <ul className="mt-2 space-y-1">
            {evidence.map((e) => (
              <li key={e.id} className="text-[12.5px]">
                <Link href={`/emails?id=${e.id}`} className="text-fg hover:underline">
                  {e.subject ?? "Cancellation email"}
                </Link>{" "}
                <span className="text-muted">· {formatDate(e.received_at, "medium")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-muted">Read it before accepting - we only matched the sender and wording.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(s.status === "active" || s.status === "trial" || s.status === "paused") && (
          <Button variant="secondary" onClick={() => setRequestOpen(true)} disabled={pending}>
            I&apos;ve requested cancellation
          </Button>
        )}
        {!isCancelled && (
          <Button variant={isPending ? "primary" : "secondary"} onClick={() => setConfirmOpen(true)} disabled={pending}>
            <CircleCheck /> Mark cancellation as confirmed
          </Button>
        )}
        {(isPending || isCancelled) && (
          <Button variant="ghost" onClick={() => run(() => reactivateSubscription(s.id))} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : isCancelled ? <RotateCcw /> : <Undo2 />}
            {isCancelled ? "Reactivate" : "Undo request"}
          </Button>
        )}
      </div>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent title={`Did you ask ${provider} to cancel?`} description="This only records that you started the cancellation. The subscription stays counted as active until you confirm it ended.">
          <div className="space-y-4">
            <Field label="Cancellation deadline (optional)" hint="If there's a notice period, the last day it must be processed by.">
              <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Not yet</Button>
              </DialogClose>
              <Button variant="primary" disabled={pending} onClick={() => run(() => requestCancellation(s.id, deadline || null), () => setRequestOpen(false))}>
                {pending && <Loader2 className="animate-spin" />}
                Yes, I requested it
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          setConfirmOpen(o);
          if (!o) setAcknowledged(false);
        }}
      >
        <DialogContent title={`Confirm ${s.name} is cancelled`} description="Only do this once the provider has confirmed it - a confirmation email, a reference number or a final screen. Clicking a cancel link is not enough.">
          <div className="space-y-4">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-[13px] transition-colors hover:bg-surface-2">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent-strong)]" />
              <span>I received a confirmation from {provider} that this subscription is cancelled.</span>
            </label>
            <Field label="Confirmation reference (optional)" hint="Confirmation number, the email's subject, or who you spoke to.">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} placeholder="e.g. Confirmation email of 9 Nov, ref. 8KQ2-77" />
            </Field>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                variant="primary"
                disabled={!acknowledged || pending}
                onClick={() =>
                  run(
                    () => confirmCancellation(s.id, { acknowledged, reference: reference || null }),
                    () => {
                      setConfirmOpen(false);
                      setAcknowledged(false);
                    },
                  )
                }
              >
                {pending && <Loader2 className="animate-spin" />}
                Mark as cancelled
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
