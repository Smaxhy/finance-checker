"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BadgeCheck, Ban, Eye, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Subscription } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { confirmDetection, deleteSubscription, dismissSubscription, markReviewed, restoreSubscription, type ActionResult } from "@/app/actions/subscriptions";
import { SubscriptionForm, type CategoryOption } from "./subscription-form";

export function DetailActions({ subscription: s, categories }: { subscription: Subscription; categories: CategoryOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        after?.();
        router.refresh();
      } else toast.error(res.message);
    });

  return (
    <div className="flex flex-wrap gap-2">
      {!s.user_confirmed && !s.dismissed && s.detection_source !== "manual" && (
        <Button variant="primary" disabled={pending} onClick={() => run(() => confirmDetection(s.id))}>
          <BadgeCheck /> Yes, this is recurring
        </Button>
      )}
      {s.dismissed ? (
        <Button variant="secondary" disabled={pending} onClick={() => run(() => restoreSubscription(s.id))}>
          <RotateCcw /> Restore
        </Button>
      ) : (
        s.detection_source !== "manual" && (
          <Button variant="ghost" disabled={pending} onClick={() => run(() => dismissSubscription(s.id))} title="Not a subscription - stop counting it">
            <Ban /> Not a subscription
          </Button>
        )
      )}
      {(s.status === "active" || s.status === "trial") && s.user_confirmed && !s.dismissed && (
        <Button variant="secondary" disabled={pending} onClick={() => run(() => markReviewed(s.id))} title="You still use it - it won't be flagged as possibly forgotten for 90 days">
          {pending ? <Loader2 className="animate-spin" /> : <Eye />} Still using it
        </Button>
      )}
      <Button variant="secondary" onClick={() => setEditOpen(true)}>
        <Pencil /> Edit
      </Button>
      {s.detection_source === "manual" && (
        <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setDeleteOpen(true)}>
          <Trash2 /> Delete
        </Button>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent title={`Edit ${s.name}`} wide>
          <SubscriptionForm
            mode="edit"
            subscription={s}
            categories={categories}
            onDone={() => {
              setEditOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent title={`Delete ${s.name}?`} description="This removes it from the tracker. It doesn't cancel anything with the provider, and linked transactions are kept.">
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Keep it</Button>
            </DialogClose>
            <Button variant="danger" disabled={pending} onClick={() => run(() => deleteSubscription(s.id), () => router.push("/subscriptions"))}>
              {pending && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
