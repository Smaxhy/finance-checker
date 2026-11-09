"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, ExternalLink, Loader2, Repeat, StickyNote, Trash2 } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { DemoBadge, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea, Field } from "@/components/ui/input";
import { deleteTransaction, updateTransactionCategory, updateTransactionDetails } from "@/app/actions/finance";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Category, Transaction } from "@/lib/types";

const KIND_LABEL: Record<Transaction["kind"], string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Own transfer",
  refund: "Refund",
  withdrawal: "Cash",
  fee: "Fee",
};

function CategorySelect({ tx, categories, onPicked }: { tx: Transaction; categories: Category[]; onPicked: (id: string) => void }) {
  const expense = categories.filter((c) => c.kind === "expense");
  const income = categories.filter((c) => c.kind === "income");
  const transfer = categories.filter((c) => c.kind === "transfer");
  return (
    <select
      value={tx.category_id ?? "other"}
      onChange={(e) => onPicked(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      className="h-7 max-w-44 cursor-pointer truncate rounded-md border border-transparent bg-transparent px-1.5 text-[12.5px] text-secondary transition-colors hover:border-border hover:bg-surface-2 focus:border-accent focus:outline-none"
      aria-label={`Category for ${tx.merchant ?? "transaction"}`}
    >
      <optgroup label="Spending">
        {expense.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Income">
        {income.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="Other">
        {transfer.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

export function TransactionsTable({
  rows,
  categories,
  accounts,
}: {
  rows: Transaction[];
  categories: Category[];
  accounts: Record<string, string>;
}) {
  const [pendingCategory, setPendingCategory] = useState<{ tx: Transaction; categoryId: string } | null>(null);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [busy, start] = useTransition();
  const byId = new Map(categories.map((c) => [c.id, c]));

  const applyCategory = (applyToSimilar: boolean) => {
    if (!pendingCategory) return;
    const { tx, categoryId } = pendingCategory;
    start(async () => {
      const res = await updateTransactionCategory({ id: tx.id, categoryId, applyToSimilar });
      if (res.ok) {
        toast.success(
          applyToSimilar
            ? `Categorised ${tx.merchant} as ${byId.get(categoryId)?.name}${res.data?.updatedSimilar ? ` (+${res.data.updatedSimilar} similar)` : ""} - future ones too`
            : `Category updated`,
        );
      } else toast.error(res.message);
      setPendingCategory(null);
    });
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="data-table min-w-[760px]">
          <thead>
            <tr>
              <th className="w-24">Date</th>
              <th>Description</th>
              <th className="w-48">Category</th>
              <th className="w-40">Account</th>
              <th className="w-32 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const cat = byId.get(t.category_id ?? "other");
              return (
                <tr key={t.id} className="cursor-pointer" onClick={() => setDetail(t)}>
                  <td className="text-[12.5px] whitespace-nowrap text-muted tabular">{formatDate(t.booked_at, "short")}</td>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <CategoryIcon icon={cat?.icon} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                          <span className="truncate">{t.merchant ?? t.counterparty_name ?? "Transaction"}</span>
                          {t.is_demo && <DemoBadge />}
                          {t.subscription_id && <Repeat className="size-3 shrink-0 text-muted" aria-label="Recurring" />}
                          {t.notes && <StickyNote className="size-3 shrink-0 text-muted" aria-label="Has notes" />}
                          {t.status === "pending" && <Badge tone="warning">Pending</Badge>}
                        </p>
                        <p className="max-w-[420px] truncate text-[12px] text-muted">{t.description}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    {t.kind === "transfer" ? (
                      <span className="flex items-center gap-1.5 px-1.5 text-[12.5px] text-muted">
                        <ArrowLeftRight className="size-3.5" /> Own transfer
                      </span>
                    ) : (
                      <CategorySelect tx={t} categories={categories} onPicked={(id) => id !== t.category_id && setPendingCategory({ tx: t, categoryId: id })} />
                    )}
                  </td>
                  <td className="truncate text-[12.5px] text-muted">{t.account_id ? (accounts[t.account_id] ?? "—") : "—"}</td>
                  <td className={cn("text-right text-[13px] font-medium whitespace-nowrap tabular", t.kind === "transfer" ? "text-muted" : t.amount > 0 && "text-positive")}>
                    {formatMoney(t.amount, t.currency, { sign: true })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(pendingCategory)} onOpenChange={(o) => !o && setPendingCategory(null)}>
        {pendingCategory && (
          <DialogContent
            title={`Change category to ${byId.get(pendingCategory.categoryId)?.name}?`}
            description={`Apply it to this transaction only, or to every transaction from ${pendingCategory.tx.merchant} - including future ones (creates a rule you can remove in Preferences).`}
          >
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => applyCategory(false)}>
                Just this one
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => applyCategory(true)}>
                {busy && <Loader2 className="animate-spin" />} All from {pendingCategory.tx.merchant}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      <TransactionDetail tx={detail} onClose={() => setDetail(null)} categoryName={detail ? byId.get(detail.category_id ?? "other")?.name : undefined} accountName={detail?.account_id ? accounts[detail.account_id] : undefined} />
    </>
  );
}

function TransactionDetail({ tx, onClose, categoryName, accountName }: { tx: Transaction | null; onClose: () => void; categoryName?: string; accountName?: string }) {
  const [notes, setNotes] = useState("");
  const [busy, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  if (tx && openId !== tx.id) {
    setOpenId(tx.id);
    setNotes(tx.notes ?? "");
  }
  if (!tx) return null;
  const rows: [string, React.ReactNode][] = [
    ["Date", formatDate(tx.booked_at, "long")],
    ["Amount", <span key="a" className="tabular">{formatMoney(tx.amount, tx.currency, { sign: true })}</span>],
    ["Type", KIND_LABEL[tx.kind]],
    ["Category", tx.kind === "transfer" ? "Transfer between your own accounts (excluded from spending and income)" : (categoryName ?? "—")],
    ["Account", accountName ?? "—"],
    ["Counterparty", [tx.counterparty_name, tx.counterparty_iban_masked].filter(Boolean).join(" · ") || "—"],
    ["Description", tx.description ?? "—"],
    ["Source", `${tx.source === "bank" ? "Bank (PSD2)" : tx.source === "csv" ? "CSV import" : tx.source === "manual" ? "Added manually" : "Demo data"}${tx.category_source === "user" ? " · category set by you" : tx.category_source === "rule" ? " · category from your rule" : ""}`],
  ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={tx.merchant ?? "Transaction"} description={tx.is_demo ? "Sample data" : undefined} wide>
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0 break-words">{v}</dd>
            </div>
          ))}
        </dl>
        {tx.subscription_id && (
          <Link href={`/subscriptions/${tx.subscription_id}`} className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] text-accent-text hover:underline">
            <Repeat className="size-3.5" /> Part of a recurring payment <ExternalLink className="size-3" />
          </Link>
        )}
        <Field label="Notes" className="mt-5">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note…" maxLength={1000} />
        </Field>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const res = await updateTransactionDetails({ id: tx.id, isTransfer: tx.kind !== "transfer" });
                  if (res.ok) {
                    toast.success(tx.kind === "transfer" ? "Now counted as income/spending" : "Marked as a transfer between your own accounts");
                    onClose();
                  } else toast.error(res.message);
                })
              }
            >
              <ArrowLeftRight /> {tx.kind === "transfer" ? "Not an own-account transfer" : "Mark as own-account transfer"}
            </Button>
            {(tx.source === "manual" || tx.source === "csv") && (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    if (!window.confirm("Delete this transaction?")) return;
                    const res = await deleteTransaction(tx.id);
                    if (res.ok) {
                      toast.success("Transaction deleted");
                      onClose();
                    } else toast.error(res.message);
                  })
                }
              >
                <Trash2 /> Delete
              </Button>
            )}
          </div>
          <Button
            variant="primary"
            disabled={busy || notes === (tx.notes ?? "")}
            onClick={() =>
              start(async () => {
                const res = await updateTransactionDetails({ id: tx.id, notes });
                if (res.ok) {
                  toast.success("Notes saved");
                  onClose();
                } else toast.error(res.message);
              })
            }
          >
            Save notes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
