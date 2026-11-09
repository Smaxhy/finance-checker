import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, CalendarClock, CreditCard, Hourglass, Landmark, Mail, Package, Repeat, Truck } from "lucide-react";
import { DemoBadge } from "@/components/ui/badge";
import { EVENT_ICONS } from "@/components/lists/lists";
import { formatDate, formatMoney, formatTime, relativeDay } from "@/lib/format";
import type { EmailRecord, EventKind } from "@/lib/types";
import type { InboxAnswers, MerchantAnswer } from "@/lib/email/queries";
import { cn } from "@/lib/utils";

function AnswerCard({ icon: Icon, question, summary, children, empty, className }: { icon: LucideIcon; question: string; summary?: React.ReactNode; children?: React.ReactNode; empty?: string; className?: string }) {
  return (
    <div className={cn("card flex flex-col p-4", className)}>
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <Icon className="size-3.5" />
        {question}
      </div>
      {summary ? <div className="mt-1.5 text-[18px] leading-tight font-semibold tracking-[-0.01em]">{summary}</div> : null}
      <div className="mt-2 flex-1">{children ?? <p className="text-[12.5px] text-muted">{empty}</p>}</div>
    </div>
  );
}

function Row({ href, title, meta, right, demo }: { href: string; title: string; meta?: string; right?: React.ReactNode; demo?: boolean }) {
  return (
    <Link href={href} scroll={false} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-[12.5px] font-medium">
          <span className="truncate">{title}</span>
          {demo && <DemoBadge />}
        </p>
        {meta && <p className="truncate text-[11.5px] text-muted">{meta}</p>}
      </div>
      {right ? <span className="tabular shrink-0 text-[12.5px] font-medium">{right}</span> : null}
    </Link>
  );
}

const emailHref = (e: Pick<EmailRecord, "id">, base: string) => `${base}?id=${e.id}`;

export function MerchantAnswerCard({ a }: { a: MerchantAnswer }) {
  const both = a.bankSpend !== null && a.emailCount > 0;
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="text-[12.5px] text-muted">How much did I spend at {a.merchant} in {a.year}?</p>
          <p className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.02em]">
            {formatMoney(a.bankSpend ?? a.emailSpend, a.currency)}
          </p>
          <p className="mt-1 text-[12px] text-muted">
            {a.bankSpend !== null ? `From ${a.bankCount} bank transaction${a.bankCount === 1 ? "" : "s"}` : `From ${a.emailCount} email receipt${a.emailCount === 1 ? "" : "s"}`}
            {a.emailRefunds > 0 ? ` · ${formatMoney(a.emailRefunds, a.currency)} refunded per email` : ""}
          </p>
        </div>
        <Link href={`/finances/transactions?q=${encodeURIComponent(a.merchant)}`} className="flex items-center gap-1 text-[12.5px] text-accent-text hover:underline">
          View transactions <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
      <dl className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="px-5 py-3.5">
          <dt className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <Mail className="size-3" /> Email receipts &amp; orders
          </dt>
          <dd className="mt-1 text-[14px] font-medium tabular">{a.emailCount ? formatMoney(a.emailSpend, a.currency) : "None found"}</dd>
          <dd className="text-[11.5px] text-muted">{a.emailCount} purchase{a.emailCount === 1 ? "" : "s"} this year (orders counted once)</dd>
        </div>
        <div className="px-5 py-3.5">
          <dt className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <Landmark className="size-3" /> Bank transactions
          </dt>
          <dd className="mt-1 text-[14px] font-medium tabular">{a.bankSpend !== null ? formatMoney(a.bankSpend, a.currency) : "No matches"}</dd>
          <dd className="text-[11.5px] text-muted">
            {both ? "Bank data is the source of truth" : a.bankSpend !== null ? "Matched by merchant in your bank data" : "Connect or import your bank to cross-check"}
          </dd>
        </div>
        <div className="px-5 py-3.5">
          <dt className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <Package className="size-3" /> Last purchase
          </dt>
          {a.lastTransaction || a.lastEmail ? (
            <>
              <dd className="mt-1 text-[14px] font-medium">
                {formatDate([a.lastTransaction?.date, a.lastEmail?.date.slice(0, 10)].filter((d): d is string => Boolean(d)).sort().pop()!, "medium")}
              </dd>
              <dd className="truncate text-[11.5px] text-muted">
                {a.lastEmail ? (
                  <Link href={`/emails?id=${a.lastEmail.id}`} className="hover:text-fg hover:underline">
                    {a.lastEmail.subject ?? "Receipt"}
                    {a.lastEmail.amount ? ` · ${formatMoney(a.lastEmail.amount, a.lastEmail.currency ?? a.currency)}` : ""}
                  </Link>
                ) : (
                  `${formatMoney(a.lastTransaction!.amount, a.lastTransaction!.currency)} (bank)`
                )}
              </dd>
            </>
          ) : (
            <dd className="mt-1 text-[13px] text-muted">-</dd>
          )}
        </div>
      </dl>
    </div>
  );
}

export function InboxAnswerGrid({ a, base, currency, include }: { a: InboxAnswers; base: string; currency: string; include: ("payments" | "trials" | "bookings" | "signups" | "deliveries" | "merchants")[] }) {
  const cards: React.ReactNode[] = [];
  const paymentsTotal = a.upcomingPayments.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  if (include.includes("payments"))
    cards.push(
      <AnswerCard
        key="payments"
        icon={CreditCard}
        question="What payments are coming up?"
        summary={a.upcomingPayments.length ? `${a.upcomingPayments.length} bill${a.upcomingPayments.length === 1 ? "" : "s"} · ${formatMoney(paymentsTotal, currency)}` : undefined}
        empty="No unpaid bills with a due date in your inbox."
      >
        {a.upcomingPayments.length ? (
          <div>
            {a.upcomingPayments.slice(0, 4).map((e) => (
              <Row key={e.id} href={emailHref(e, base)} title={e.merchant ?? e.subject ?? "Bill"} meta={`Due ${relativeDay(e.due_date!)} · ${formatDate(e.due_date, "short")}`} right={e.amount ? formatMoney(Number(e.amount), e.currency ?? currency) : null} demo={e.is_demo} />
            ))}
          </div>
        ) : undefined}
      </AnswerCard>,
    );

  if (include.includes("trials"))
    cards.push(
      <AnswerCard key="trials" icon={Hourglass} question="Which free trials are about to expire?" summary={a.trialsEnding.length ? `${a.trialsEnding.length} active trial${a.trialsEnding.length === 1 ? "" : "s"}` : undefined} empty="No running free trials found.">
        {a.trialsEnding.length ? (
          <div>
            {a.trialsEnding.map((e) => (
              <Row
                key={e.id}
                href={emailHref(e, base)}
                title={e.merchant ?? e.subject ?? "Trial"}
                meta={`Ends ${relativeDay(e.trialEnd)} · ${formatDate(e.trialEnd, "short")}${e.amount ? `, then ${formatMoney(Number(e.amount), e.currency ?? currency)}` : ""}`}
                demo={e.is_demo}
              />
            ))}
          </div>
        ) : undefined}
      </AnswerCard>,
    );

  if (include.includes("bookings"))
    cards.push(
      <AnswerCard key="bookings" icon={CalendarClock} question="What appointments and bookings are coming up?" summary={a.upcomingBookings.length ? `${a.upcomingBookings.length} upcoming` : undefined} empty="Nothing booked yet.">
        {a.upcomingBookings.length ? (
          <div>
            {a.upcomingBookings.slice(0, 4).map((e) => {
              const Icon = EVENT_ICONS[(e.category === "travel" ? "flight" : e.category === "appointment" ? "appointment" : "hotel") as EventKind];
              return (
                <Row
                  key={e.id}
                  href={emailHref(e, base)}
                  title={e.merchant ? `${e.merchant}${e.location ? ` · ${e.location}` : ""}` : (e.subject ?? "Booking")}
                  meta={`${relativeDay(e.event_start!)} · ${formatDate(e.event_start, "short")} ${formatTime(e.event_start)}`}
                  right={<Icon className="size-3.5 text-muted" />}
                  demo={e.is_demo}
                />
              );
            })}
          </div>
        ) : undefined}
      </AnswerCard>,
    );

  if (include.includes("deliveries"))
    cards.push(
      <AnswerCard key="deliveries" icon={Truck} question="What's on its way?" summary={a.deliveries.length ? `${a.deliveries.length} deliver${a.deliveries.length === 1 ? "y" : "ies"}` : undefined} empty="No parcels expected.">
        {a.deliveries.length ? (
          <div>
            {a.deliveries.map((e) => (
              <Row key={e.id} href={emailHref(e, base)} title={e.merchant ?? e.subject ?? "Parcel"} meta={`Expected ${relativeDay(e.deliveryDate)}${(e.extracted as { carrier?: string }).carrier ? ` · ${(e.extracted as { carrier?: string }).carrier}` : ""}`} demo={e.is_demo} />
            ))}
          </div>
        ) : undefined}
      </AnswerCard>,
    );

  if (include.includes("signups"))
    cards.push(
      <AnswerCard key="signups" icon={Repeat} question="Which subscriptions did I sign up for?" summary={a.signedUp.length ? `${a.signedUp.length} in the last 12 months` : undefined} empty="No subscription sign-ups found in the last year.">
        {a.signedUp.length ? (
          <div>
            {a.signedUp.slice(0, 5).map((e) => (
              <Row
                key={e.id}
                href={emailHref(e, base)}
                title={e.merchant ?? e.subject ?? "Subscription"}
                meta={`${e.category === "trial" ? "Free trial" : "Subscription"} · ${formatDate(e.received_at, "medium")}`}
                right={e.amount ? `${formatMoney(Number(e.amount), e.currency ?? currency)}${typeof (e.extracted as { billing_cycle?: string }).billing_cycle === "string" ? `/${String((e.extracted as { billing_cycle?: string }).billing_cycle).replace("ly", "").replace("month", "mo").replace("year", "yr")}` : ""}` : null}
                demo={e.is_demo}
              />
            ))}
          </div>
        ) : undefined}
      </AnswerCard>,
    );

  if (include.includes("merchants"))
    cards.push(
      <AnswerCard key="merchants" icon={Package} question={`Where did my receipts come from this year?`} summary={a.receiptsThisYear.count ? formatMoney(a.receiptsThisYear.total, currency) : undefined} empty="No receipts with amounts yet.">
        {a.topMerchants.length ? (
          <div>
            {a.topMerchants.slice(0, 4).map((m) => (
              <Row key={m.merchantKey} href={`${base}?q=${encodeURIComponent(m.merchant)}`} title={m.merchant} meta={`${m.count} email${m.count === 1 ? "" : "s"}`} right={formatMoney(m.total, m.currency)} />
            ))}
          </div>
        ) : undefined}
      </AnswerCard>,
    );

  return <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2", cards.length >= 3 && "xl:grid-cols-3")}>{cards}</div>;
}
