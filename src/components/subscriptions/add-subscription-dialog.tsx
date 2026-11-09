"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { SubscriptionForm, type CategoryOption } from "./subscription-form";

export function AddSubscriptionDialog({ categories, initialOpen = false }: { categories: CategoryOption[]; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const router = useRouter();
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    // Drop ?new=1 (from the command palette) so a refresh doesn't reopen the dialog.
    if (!o && initialOpen) router.replace(window.location.pathname, { scroll: false });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus /> Add subscription
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a subscription" description="Track something that wasn't detected automatically - a gym, insurance, a family plan…" wide>
        <SubscriptionForm
          mode="create"
          categories={categories}
          onDone={(id) => {
            onOpenChange(false);
            if (id) router.push(`/subscriptions/${id}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
