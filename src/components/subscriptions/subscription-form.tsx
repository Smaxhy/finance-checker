"use client";
import { useState, useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { BillingCycle, Subscription } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { createSubscription, updateSubscription } from "@/app/actions/subscriptions";
import { CYCLE_LABEL } from "@/lib/subscriptions/helpers";

export interface CategoryOption {
  id: string;
  name: string;
}

const CYCLES: BillingCycle[] = ["weekly", "monthly", "quarterly", "semiannual", "yearly"];

/** Shared add / edit form. Opening a cancellation link is never part of this form. */
export function SubscriptionForm({
  mode,
  subscription,
  categories,
  onDone,
}: {
  mode: "create" | "edit";
  subscription?: Subscription;
  categories: CategoryOption[];
  onDone: (id?: string) => void;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<"active" | "trial">("active");

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "");
    const amountRaw = text("amount").replace(",", ".");
    const common = {
      name: text("name"),
      amount: amountRaw === "" ? null : Number(amountRaw),
      currency: text("currency") || "EUR",
      billing_cycle: text("billing_cycle") as BillingCycle,
      next_payment_date: text("next_payment_date") || null,
      payment_method: text("payment_method") || null,
      category_id: text("category_id") || "subscriptions",
      notes: text("notes") || null,
      cancellation_deadline: text("cancellation_deadline") || null,
      cancel_url: text("cancel_url") || null,
    };
    start(async () => {
      const res =
        mode === "create"
          ? await createSubscription({ ...common, status, trial_ends_at: text("trial_ends_at") || null })
          : await updateSubscription(subscription!.id, common);
      if (res.ok) {
        toast.success(res.message);
        onDone(res.id);
      } else toast.error(res.message);
    });
  };

  const s = subscription;
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" className="col-span-2">
          <Input name="name" required maxLength={80} defaultValue={s?.name} placeholder="e.g. Netflix, gym, car insurance" autoFocus={mode === "create"} />
        </Field>
        {mode === "create" && (
          <Field label="Type" className="col-span-2">
            <div className="flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border" role="radiogroup">
              {(["active", "trial"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={status === v}
                  onClick={() => setStatus(v)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-all ${status === v ? "bg-surface-3 text-fg shadow-sm" : "text-muted hover:text-secondary"}`}
                >
                  {v === "active" ? "Paid subscription" : "Free trial"}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label={status === "trial" && mode === "create" ? "Price after trial" : "Price"}>
          <Input name="amount" inputMode="decimal" defaultValue={s?.amount ?? ""} placeholder="0.00" pattern="^\d+([.,]\d{1,2})?$" />
        </Field>
        <Field label="Billing cycle">
          <Select name="billing_cycle" defaultValue={s?.billing_cycle === "unknown" ? "monthly" : (s?.billing_cycle ?? "monthly")}>
            {CYCLES.map((c) => (
              <option key={c} value={c}>
                {CYCLE_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        {mode === "create" && status === "trial" ? (
          <Field label="Trial ends on">
            <Input name="trial_ends_at" type="date" required />
          </Field>
        ) : (
          <Field label="Next payment">
            <Input name="next_payment_date" type="date" defaultValue={s?.next_payment_date ?? ""} />
          </Field>
        )}
        <Field label="Currency">
          <Select name="currency" defaultValue={s?.currency ?? "EUR"}>
            {["EUR", "USD", "GBP", "CHF"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Select name="category_id" defaultValue={s?.category_id ?? "subscriptions"}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Payment method">
          <Input name="payment_method" maxLength={80} defaultValue={s?.payment_method ?? ""} placeholder="e.g. Visa •• 7034" />
        </Field>
        <Field label="Cancellation deadline" hint="Last day to cancel before the next term">
          <Input name="cancellation_deadline" type="date" defaultValue={s?.cancellation_deadline ?? ""} />
        </Field>
        <Field label="Cancellation page" hint="Optional - official https link">
          <Input name="cancel_url" type="url" defaultValue={s?.cancel_url ?? ""} placeholder="https://…" />
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea name="notes" maxLength={1000} defaultValue={s?.notes ?? ""} placeholder="Plan, account email, contract terms…" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {mode === "create" ? "Add subscription" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
