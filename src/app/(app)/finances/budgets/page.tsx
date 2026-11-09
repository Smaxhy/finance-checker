import Link from "next/link";
import { ChevronLeft, ChevronRight, PiggyBank } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCategories, getProfile } from "@/lib/data/core";
import { listBudgets, spendingByCategory } from "@/lib/data/finance";
import { addMonths, daysInMonth, monthKey, monthRange, parseMonthParam } from "@/lib/dates";
import { formatMoney, formatMonth } from "@/lib/format";
import { str } from "@/lib/finance/periods";
import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Meter, PageHeader, StatTile } from "@/components/ui/misc";
import { CategoryIcon } from "@/components/category-icon";
import { BudgetDialog } from "@/components/finance/budget-editor";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: PageProps<"/finances/budgets">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const today = new Date();
  const month = parseMonthParam(str(sp.month), today);
  const range = monthRange(month);
  const isCurrent = monthKey(month) === monthKey(today);
  const [profile, categories, budgets, spend] = await Promise.all([getProfile(), getCategories(), listBudgets(supabase), spendingByCategory(supabase, range.from, range.to)]);
  const currency = profile?.base_currency ?? "EUR";
  const expenseCats = categories.filter((c) => c.kind === "expense");
  const catById = new Map(categories.map((c) => [c.id, c]));
  const spentBy = new Map(spend.map((s) => [s.category_id, s.spent]));

  const rows = budgets
    .map((b) => ({ ...b, spent: spentBy.get(b.category_id) ?? 0, cat: catById.get(b.category_id) }))
    .sort((a, b) => b.spent / b.amount - a.spent / a.amount);
  const totalBudget = rows.reduce((a, r) => a + r.amount, 0);
  const totalSpentBudgeted = rows.reduce((a, r) => a + r.spent, 0);
  const unbudgeted = spend.filter((s) => !budgets.some((b) => b.category_id === s.category_id) && catById.get(s.category_id)?.kind === "expense");
  const dayFraction = isCurrent ? today.getDate() / daysInMonth(today) : 1;
  const over = rows.filter((r) => r.spent > r.amount).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets"
        description="Monthly limits per category. Spending is net of refunds and never includes transfers between your own accounts."
        actions={
          <>
            <div className="flex items-center rounded-lg border border-border bg-surface">
              <Link href={`?month=${monthKey(addMonths(month, -1))}`} className="p-1.5 text-muted hover:text-fg" aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Link>
              <span className="min-w-28 text-center text-[12.5px] font-medium">{formatMonth(month)}</span>
              <Link href={`?month=${monthKey(addMonths(month, 1))}`} className="p-1.5 text-muted hover:text-fg" aria-label="Next month">
                <ChevronRight className="size-4" />
              </Link>
            </div>
            <BudgetDialog categories={expenseCats.filter((c) => !budgets.some((b) => b.category_id === c.id)).map((c) => ({ id: c.id, name: c.name }))} />
          </>
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={PiggyBank} title="No budgets yet" description="Set a monthly limit for groceries, restaurants or anything else and track it here." />
        </Card>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile label="Budgeted" value={formatMoney(totalBudget, currency, { decimals: 0 })} hint={`${rows.length} categories`} />
            <StatTile label="Spent in budgeted categories" value={formatMoney(totalSpentBudgeted, currency)} hint={`${Math.round((totalSpentBudgeted / totalBudget) * 100)}% used`} />
            <StatTile label="Left" value={formatMoney(Math.max(0, totalBudget - totalSpentBudgeted), currency)} hint={isCurrent ? `${daysInMonth(today) - today.getDate()} days to go` : "month closed"} />
            <StatTile label="Over budget" value={String(over)} hint={over ? "categories" : "Nothing over budget"} />
          </section>

          <Card>
            <CardHeader title={`Budgets for ${formatMonth(month)}`} description={isCurrent ? `The marker shows how far through the month we are (${Math.round(dayFraction * 100)}%).` : undefined} />
            <CardBody>
              <ul className="divide-y divide-border">
                {rows.map((r) => {
                  const pct = r.spent / r.amount;
                  return (
                    <li key={r.id} className="flex items-center gap-4 py-3">
                      <CategoryIcon icon={r.cat?.icon} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <Link href={`/finances/transactions?category=${r.category_id}&from=${range.from}&to=${range.to}`} className="truncate text-[13px] font-medium hover:text-accent-text">
                            {r.cat?.name ?? r.category_id}
                          </Link>
                          <span className="text-[12.5px] text-muted tabular">
                            <span className={cn("font-medium", pct > 1 ? "text-danger" : "text-fg")}>{formatMoney(r.spent, currency)}</span> of {formatMoney(r.amount, currency, { decimals: 0 })}
                          </span>
                        </div>
                        <div className="relative mt-2">
                          <Meter value={r.spent} max={r.amount} />
                          {isCurrent && <div className="absolute -top-0.5 h-2.5 w-px bg-fg/50" style={{ left: `${dayFraction * 100}%` }} aria-hidden />}
                        </div>
                        <p className="mt-1.5 text-[12px] text-muted">
                          {pct > 1 ? `${formatMoney(r.spent - r.amount, currency)} over budget` : `${formatMoney(r.amount - r.spent, currency)} left`}
                          {isCurrent && pct <= 1 && pct > dayFraction + 0.1 ? " · ahead of pace" : ""}
                        </p>
                      </div>
                      <BudgetDialog trigger="edit" categories={[{ id: r.category_id, name: r.cat?.name ?? r.category_id }]} initial={{ id: r.id, categoryId: r.category_id, amount: r.amount }} />
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        </>
      )}

      {unbudgeted.length > 0 && (
        <Card>
          <CardHeader title="Spending without a budget" description={formatMonth(month)} />
          <CardBody>
            <ul className="divide-y divide-border">
              {unbudgeted.map((s) => {
                const cat = catById.get(s.category_id);
                return (
                  <li key={s.category_id} className="flex items-center gap-3 py-2">
                    <CategoryIcon icon={cat?.icon} />
                    <span className="flex-1 text-[13px]">{cat?.name ?? s.category_id}</span>
                    <span className="text-[13px] font-medium tabular">{formatMoney(s.spent, currency)}</span>
                    <BudgetDialog trigger="quick" categories={[{ id: s.category_id, name: cat?.name ?? s.category_id }]} />
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
