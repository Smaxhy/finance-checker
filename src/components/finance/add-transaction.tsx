"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { addManualTransaction } from "@/app/actions/finance";
import { toISODate } from "@/lib/dates";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export function AddTransactionButton({ categories }: { categories: Category[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [pending, start] = useTransition();

  const close = (o: boolean) => {
    setOpen(o);
    if (!o && params.get("new")) {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      router.replace(`${pathname}?${next}`, { scroll: false });
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus /> Add transaction
      </Button>
      <DialogContent title="Add a transaction" description="For cash payments or anything your bank feed doesn't cover.">
        <form
          className="space-y-4"
          action={(fd) =>
            start(async () => {
              const res = await addManualTransaction({
                date: String(fd.get("date")),
                amount: Number(String(fd.get("amount")).replace(",", ".")),
                direction,
                description: String(fd.get("description")),
                categoryId: String(fd.get("categoryId") || "") || undefined,
                notes: String(fd.get("notes") || "") || undefined,
              });
              if (res.ok) {
                toast.success("Transaction added");
                close(false);
              } else toast.error(res.message);
            })
          }
        >
          <div className="flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border">
            {(["out", "in"] as const).map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => setDirection(d)}
                className={cn("flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition-colors", direction === d ? "bg-surface-3 text-fg" : "text-muted")}
              >
                {d === "out" ? "Money out" : "Money in"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <Input name="date" type="date" defaultValue={toISODate(new Date())} required />
            </Field>
            <Field label="Amount (€)">
              <Input name="amount" inputMode="decimal" placeholder="0,00" required pattern="[0-9]+([.,][0-9]{1,2})?" />
            </Field>
          </div>
          <Field label="Description">
            <Input name="description" placeholder="e.g. Farmers market" required maxLength={200} />
          </Field>
          <Field label="Category" hint="Leave on automatic to categorise it like a bank transaction.">
            <Select name="categoryId" defaultValue="">
              <option value="">Automatic</option>
              {categories
                .filter((c) => (direction === "out" ? c.kind === "expense" : c.kind === "income"))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Notes">
            <Textarea name="notes" maxLength={1000} className="min-h-14" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Add
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
