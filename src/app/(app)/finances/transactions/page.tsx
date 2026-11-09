import Link from "next/link";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Download, ReceiptText } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCategories, getProfile } from "@/lib/data/core";
import { listAccounts, listTransactions, transactionTotals, type TransactionFilters as Filters } from "@/lib/data/finance";
import { resolvePeriod, str } from "@/lib/finance/periods";
import { formatMoney, formatNumber } from "@/lib/format";
import type { TransactionKind } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { TransactionFilters } from "@/components/finance/transaction-filters";
import { TransactionsTable } from "@/components/finance/transactions-table";
import { AddTransactionButton } from "@/components/finance/add-transaction";
import { CsvImportButton } from "@/components/finance/csv-import";

export const metadata = { title: "Transactions" };

const PAGE_SIZE = 50;
const KINDS = new Set(["spending", "income", "refund", "transfer", "withdrawal", "expense", "fee"]);

export default async function TransactionsPage({ searchParams }: PageProps<"/finances/transactions">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const period = resolvePeriod({ period: str(sp.period), from: str(sp.from), to: str(sp.to) }, str(sp.category) || str(sp.q) ? "12m" : "3m");
  const page = Math.max(1, Number(str(sp.page) ?? 1) || 1);
  const kind = str(sp.kind);
  const filters: Filters = {
    from: period.from,
    to: period.to,
    q: str(sp.q)?.slice(0, 100),
    categoryId: str(sp.category),
    accountId: str(sp.account),
    kind: kind && KINDS.has(kind) ? (kind as TransactionKind | "spending") : undefined,
  };

  const [profile, categories, accounts, list, totals] = await Promise.all([
    getProfile(),
    getCategories(),
    listAccounts(supabase),
    listTransactions(supabase, { ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    transactionTotals(supabase, filters),
  ]);
  const currency = profile?.base_currency ?? "EUR";
  const accountNames = Object.fromEntries(accounts.map((a) => [a.id, `${a.name}${a.institution ? ` · ${a.institution}` : ""}`]));
  const pages = Math.max(1, Math.ceil(list.count / PAGE_SIZE));
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") p.set(k, v);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `?${p}`;
  };
  const exportQs = new URLSearchParams({ ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) });

  return (
    <div>
      <PageHeader
        title="Transactions"
        description="Every payment, purchase, transfer and refund. Transfers between your own accounts never count as income or spending."
        actions={
          <>
            <ButtonLink href={`/api/reports/transactions?${exportQs}`} variant="ghost" prefetch={false} aria-label="Export CSV">
              <Download /> <span className="hidden sm:inline">Export</span>
            </ButtonLink>
            <CsvImportButton />
            <AddTransactionButton categories={categories} />
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-border p-3 sm:p-4">
          <TransactionFilters
            categories={categories.map((c) => ({ value: c.id, label: c.name }))}
            accounts={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted sm:gap-x-6">
            <span>
              <span className="font-medium text-fg tabular">{formatNumber(totals.count)}</span> transactions · {period.label}
            </span>
            <span>
              Money out <span className="font-medium text-fg tabular">{formatMoney(totals.moneyOut, currency)}</span>
            </span>
            <span>
              Money in <span className="font-medium text-positive tabular">{formatMoney(totals.moneyIn, currency)}</span>
            </span>
            {totals.transfers > 0 && (
              <span className="flex items-center gap-1">
                <ArrowLeftRight className="size-3" /> {formatMoney(totals.transfers, currency)} moved between own accounts (excluded)
              </span>
            )}
          </div>
        </div>

        {list.rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title={Object.values(filters).some(Boolean) ? "No transactions match these filters" : "No transactions yet"}
            description="Connect your bank, import a CSV export, or add a transaction manually."
            action={
              <ButtonLink href="/settings/accounts" variant="secondary">
                Connect a bank
              </ButtonLink>
            }
          />
        ) : (
          <TransactionsTable rows={list.rows} categories={categories} accounts={accountNames} />
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[12.5px] text-muted">
            <span>
              Page {page} of {pages}
            </span>
            <div className="flex gap-1.5">
              {page > 1 ? (
                <Link href={qs({ page: String(page - 1) })} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-2 hover:text-fg" scroll={false}>
                  <ChevronLeft className="size-3.5" /> Previous
                </Link>
              ) : null}
              {page < pages ? (
                <Link href={qs({ page: String(page + 1) })} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-2 hover:text-fg" scroll={false}>
                  Next <ChevronRight className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
