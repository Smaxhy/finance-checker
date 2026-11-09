import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CreditCard, Mail, OctagonAlert, Receipt, Repeat, Wallet } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { groupCharges } from "@/lib/subscriptions/data";
import { buildTimeline, cancelSteps, CYCLE_LABEL, CYCLE_UNIT, isCharging, normalizeSubscription, priceChangeFor, SOURCE_LABEL, STATUS_LABEL, type Charge } from "@/lib/subscriptions/helpers";
import { merchantByKey, SERVICE_GROUP_LABEL } from "@/lib/finance/merchants";
import { monthlyEquivalent, yearlyEquivalent } from "@/lib/finance/recurring";
import { addDays, daysBetween, toISODate } from "@/lib/dates";
import { formatDate, formatDateTime, formatMoney, formatMonth } from "@/lib/format";
import { must } from "@/lib/data/core";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/ui/misc";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";
import { SpendBarChart } from "@/components/charts/charts";
import { StatusBadge } from "@/components/subscriptions/status-badge";
import { CancellationPanel } from "@/components/subscriptions/cancellation-panel";
import { DetailActions } from "@/components/subscriptions/detail-actions";
import { cn } from "@/lib/utils";
import { subscriptionCategoryData } from "../shared";

function daysAwayLabel(date: string) {
  const n = daysBetween(toISODate(new Date()), date);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : n > 0 ? `in ${n} days` : `${-n} days ago - not seen yet`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Subscription" };
  const { supabase } = await requireUser();
  const { data } = await supabase.from("subscriptions").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Subscription" };
}

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase } = await requireUser();
  const { data: row } = await supabase.from("subscriptions").select("*").eq("id", id).maybeSingle();
  if (!row) notFound();
  const s = normalizeSubscription(row);
  const safeKey = /^[a-z0-9._-]+$/i.test(s.merchant_key) ? s.merchant_key : null;

  const [chargeRes, emailRes, cats] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, booked_at, amount, subscription_id, merchant_key, description, currency, is_demo")
      .or(safeKey ? `subscription_id.eq.${s.id},merchant_key.eq.${safeKey}` : `subscription_id.eq.${s.id}`)
      .lt("amount", 0)
      .gte("booked_at", toISODate(addDays(new Date(), -800)))
      .order("booked_at", { ascending: false })
      .limit(60),
    safeKey
      ? supabase.from("emails").select("id, subject, category, received_at, amount, currency, is_demo").eq("merchant_key", safeKey).order("received_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [], error: null }),
    subscriptionCategoryData(),
  ]);
  type ChargeRow = Charge & { description: string | null; currency: string; is_demo: boolean };
  const allCharges = (must(chargeRes, "charges") as ChargeRow[]).map((c) => ({ ...c, amount: Number(c.amount) }));
  // A merchant can have several plans: keep charges linked to this one, or unlinked ones.
  const charges = (groupCharges([s], allCharges).get(s.id) ?? []) as ChargeRow[];
  const emails = must(emailRes, "emails") as { id: string; subject: string | null; category: string; received_at: string; amount: number | null; currency: string | null; is_demo: boolean }[];
  const evidence = emails.filter((e) => e.category === "cancellation");

  const entry = merchantByKey(s.merchant_key);
  const priceChange = priceChangeFor(s, charges);
  const timeline = buildTimeline(s, { priceChange, formatMoney: (n) => formatMoney(n, s.currency) });
  const confirmedDay = s.cancellation_confirmed_at?.slice(0, 10);
  const afterCancel = s.status === "cancelled" && confirmedDay ? charges.filter((c) => c.booked_at > confirmedDay) : [];
  const next = s.status === "trial" ? s.trial_ends_at : isCharging(s) ? s.next_payment_date : null;
  const chargesChrono = [...charges].reverse();
  const totalPaid = charges.reduce((a, c) => a - c.amount, 0);
  const categoryName = cats.options.find((c) => c.id === s.category_id)?.name ?? s.category_id ?? "—";

  return (
    <div className="space-y-6">
      <Link href="/subscriptions" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-fg">
        <ArrowLeft className="size-3.5" /> Subscriptions
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <CategoryIcon icon={cats.icons[s.category_id ?? "subscriptions"] ?? "repeat"} className="size-11 rounded-xl [&_svg]:size-5" />
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-[22px] font-semibold tracking-[-0.02em]">
              {s.name}
              <StatusBadge status={s.status} dismissed={s.dismissed} />
              {s.is_demo && <DemoBadge />}
              {!s.user_confirmed && !s.dismissed && s.detection_source !== "manual" && <Badge tone="accent">Needs review</Badge>}
            </h1>
            <p className="mt-1 text-[13px] text-muted">
              {s.provider && s.provider !== s.name ? `${s.provider} · ` : ""}
              {categoryName}
              {entry?.subscription ? ` · ${SERVICE_GROUP_LABEL[entry.subscription.group]}` : ""} · {SOURCE_LABEL[s.detection_source]}
              {s.detection_confidence && s.detection_source !== "manual" ? ` (${Math.round(s.detection_confidence * 100)}% confidence)` : ""}
            </p>
          </div>
        </div>
        <DetailActions subscription={s} categories={cats.options} />
      </div>

      {afterCancel.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger" role="alert">
          <OctagonAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              {s.name} charged you {afterCancel.length} time{afterCancel.length === 1 ? "" : "s"} after you confirmed the cancellation (
              {formatMoney(afterCancel.reduce((a, c) => a - c.amount, 0), s.currency)}).
            </p>
            <p className="mt-0.5 opacity-90">
              Contact {s.provider ?? s.name} with your cancellation reference{s.cancellation_reference ? ` (${s.cancellation_reference})` : ""}, or ask your bank to dispute the charge.
            </p>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Key figures">
        <StatTile label="Price" icon={Receipt} value={formatMoney(s.amount, s.currency)} hint={`per ${CYCLE_UNIT[s.billing_cycle]} · ${CYCLE_LABEL[s.billing_cycle].toLowerCase()}`} />
        <StatTile label="Per month" icon={Wallet} value={formatMoney(monthlyEquivalent(s.amount, s.billing_cycle), s.currency)} hint="monthly equivalent" />
        <StatTile label="Per year" icon={Repeat} value={formatMoney(yearlyEquivalent(s.amount, s.billing_cycle), s.currency, { decimals: 0 })} hint="estimated" />
        <StatTile
          label={s.status === "trial" ? "Trial ends" : "Next payment"}
          icon={CalendarClock}
          value={next ? formatDate(next, "short") : "—"}
          hint={next ? daysAwayLabel(next) : s.status === "cancelled" ? "No further payments expected" : "Not known yet"}
        />
        <StatTile
          label="Last payment"
          icon={CreditCard}
          value={s.last_payment_date ? formatDate(s.last_payment_date, "short") : "—"}
          hint={s.last_payment_amount ? formatMoney(s.last_payment_amount, s.currency) : s.payment_method ?? undefined}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card id="cancel" className="scroll-mt-20">
            <CardHeader
              title={s.status === "cancelled" ? "Cancellation" : "Cancel this subscription"}
              description="Guided, but always done by you - this app has no access to cancel anything"
            />
            <CardBody>
              <CancellationPanel subscription={s} steps={cancelSteps(s)} evidence={evidence.map((e) => ({ id: e.id, subject: e.subject, received_at: e.received_at }))} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Payment history"
              description={charges.length ? `${charges.length} charge${charges.length === 1 ? "" : "s"} found · ${formatMoney(totalPaid, s.currency)} in total` : "From your bank transactions"}
            />
            <CardBody>
              {charges.length === 0 ? (
                <p className="py-3 text-[13px] text-muted">No matching bank transactions yet. Connect a bank or import a CSV to see the history.</p>
              ) : (
                <>
                  {chargesChrono.length >= 2 && (
                    <div className="mb-4">
                      <SpendBarChart
                        data={chargesChrono.map((c) => ({ label: formatMonth(c.booked_at, "short"), tooltipLabel: formatDate(c.booked_at, "medium"), value: -c.amount }))}
                        currency={s.currency}
                        height={150}
                        name="Charged"
                      />
                    </div>
                  )}
                  <div className="-mx-4 overflow-x-auto sm:-mx-5">
                    <table className="data-table m-hide-c2 sm:min-w-[520px]">
                      <thead>
                        <tr>
                          <th className="pl-5">Date</th>
                          <th>Description</th>
                          <th className="pr-5 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {charges.slice(0, 24).map((c, i) => {
                          const prev = charges[i + 1];
                          const changed = prev && Math.abs(prev.amount - c.amount) > 0.005;
                          const late = confirmedDay && s.status === "cancelled" && c.booked_at > confirmedDay;
                          return (
                            <tr key={c.id}>
                              <td className="pl-5 text-[13px] whitespace-nowrap">{formatDate(c.booked_at, "medium")}</td>
                              <td className="max-w-80 truncate text-[12.5px] text-secondary">
                                {c.description ?? "—"} {c.is_demo && <DemoBadge className="ml-1" />}
                                {late && <Badge tone="danger" className="ml-1.5">After cancellation</Badge>}
                              </td>
                              <td className="pr-5 text-right whitespace-nowrap">
                                <span className="text-[13px] font-medium tabular">{formatMoney(-c.amount, c.currency)}</span>
                                {changed && (
                                  <span className={cn("ml-1.5 text-[11.5px] tabular", -c.amount > -prev.amount ? "text-warning" : "text-positive")}>
                                    {-c.amount > -prev.amount ? "▲" : "▼"} {formatMoney(Math.abs(c.amount - prev.amount), c.currency)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Link href={`/finances/transactions?q=${encodeURIComponent(s.name)}`} className="mt-3 inline-block text-[12.5px] text-accent-text hover:underline">
                    See all matching transactions
                  </Link>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Related emails" description="Receipts, renewals and notices from this provider (read-only)" />
            <CardBody>
              {emails.length === 0 ? (
                <p className="py-3 text-[13px] text-muted">No emails from this provider found. Connect Gmail to link receipts and renewal notices.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {emails.map((e) => (
                    <li key={e.id}>
                      <Link href={`/emails?id=${e.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-2">
                        <Mail className="size-4 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                            <span className="truncate">{e.subject ?? "(no subject)"}</span>
                            {e.is_demo && <DemoBadge />}
                          </p>
                          <p className="text-[12px] text-muted capitalize">
                            {e.category} · {formatDate(e.received_at, "medium")}
                          </p>
                        </div>
                        {e.amount ? <span className="text-[13px] tabular">{formatMoney(Number(e.amount), e.currency ?? s.currency)}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="space-y-2.5 text-[13px]">
                {[
                  ["Service / provider", s.provider ?? s.name],
                  ["Billing", `${formatMoney(s.amount, s.currency)} ${CYCLE_LABEL[s.billing_cycle].toLowerCase()}`],
                  ["Payment method", s.payment_method ?? "Unknown"],
                  ["Category", categoryName],
                  ["Started", s.started_at ? formatDate(s.started_at, "medium") : "—"],
                  ["Charges seen", String(s.charge_count || charges.length)],
                  ["Status", s.dismissed ? "Dismissed" : STATUS_LABEL[s.status]],
                  ["Cancellation deadline", s.cancellation_deadline ? formatDate(s.cancellation_deadline, "medium") : "—"],
                  ["Last reviewed", s.last_reviewed_at ? formatDate(s.last_reviewed_at, "medium") : "Never"],
                  ["Last email", s.last_email_at ? formatDate(s.last_email_at, "medium") : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              {s.notes && <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] whitespace-pre-wrap text-secondary">{s.notes}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              <ol className="relative space-y-4 border-l border-border pl-4">
                {timeline.map((t, i) => (
                  <li key={`${t.label}-${i}`} className="relative">
                    <span
                      className={cn(
                        "absolute top-1 -left-[21px] size-2.5 rounded-full ring-4 ring-[var(--surface)]",
                        t.future ? "bg-surface-3" : t.tone === "warning" ? "bg-warning" : t.tone === "positive" ? "bg-positive" : t.tone === "accent" ? "bg-accent" : "bg-border-strong",
                      )}
                    />
                    <p className={cn("text-[13px] font-medium", t.future && "text-secondary")}>
                      {t.label}
                      {t.future && <span className="ml-1.5 text-[11.5px] font-normal text-muted">upcoming</span>}
                    </p>
                    <p className="text-[12px] text-muted">
                      {t.date.length > 10 ? formatDateTime(t.date) : formatDate(t.date, "medium")}
                      {t.detail ? ` · ${t.detail}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
