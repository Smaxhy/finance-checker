"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { deleteBudget, saveBudget } from "@/app/actions/finance";

export function BudgetDialog({
  categories,
  initial,
  trigger = "new",
}: {
  categories: { id: string; name: string }[];
  initial?: { id: string; categoryId: string; amount: number };
  trigger?: "new" | "edit" | "quick";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "new" ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus /> New budget
        </Button>
      ) : trigger === "quick" ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Set budget
        </Button>
      ) : (
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="Edit budget">
          <Pencil />
        </Button>
      )}
      <DialogContent title={initial ? "Edit monthly budget" : "New monthly budget"} description="Budgets reset every calendar month. Refunds count against the budget.">
        <form
          className="space-y-4"
          action={(fd) =>
            start(async () => {
              const res = await saveBudget({ categoryId: String(fd.get("categoryId")), amount: Number(String(fd.get("amount")).replace(",", ".")) });
              if (res.ok) {
                toast.success("Budget saved");
                setOpen(false);
              } else toast.error(res.message);
            })
          }
        >
          <Field label="Category">
            <Select name="categoryId" defaultValue={initial?.categoryId} disabled={Boolean(initial)} required>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {initial && <input type="hidden" name="categoryId" value={initial.categoryId} />}
          </Field>
          <Field label="Monthly amount (€)">
            <Input name="amount" inputMode="decimal" defaultValue={initial?.amount} required pattern="[0-9]+([.,][0-9]{1,2})?" />
          </Field>
          <div className="flex justify-between gap-2">
            {initial ? (
              <Button
                variant="ghost"
                className="text-danger hover:text-danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await deleteBudget(initial.id);
                    if (res.ok) {
                      toast.success("Budget removed");
                      setOpen(false);
                    } else toast.error(res.message);
                  })
                }
              >
                <Trash2 /> Remove
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" variant="primary" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
