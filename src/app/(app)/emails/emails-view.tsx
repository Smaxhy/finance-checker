import Link from "next/link";
import { ArrowLeft, ArrowRight, Inbox, Lock, Mail, Settings } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/core";
import { integrationStatus } from "@/lib/env";
import { EMAIL_TABS, getEmailDetail, gmailConnected, inboxAnswers, listEmails, merchantAnswer, tabCounts, type EmailTab } from "@/lib/email/queries";
import type { EmailCategory, EmailRecord } from "@/lib/types";
import { formatDate, formatMoney, formatTime, relativeDay, relativeTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader, SetupRequired, StatTile, Tabs } from "@/components/ui/misc";
import { EMAIL_CATEGORY_ICON, EMAIL_CATEGORY_LABEL } from "@/components/lists/lists";
import { EmailFilters } from "@/components/emails/email-filters";
import { EmailDrawer } from "@/components/emails/email-drawer";
import { GmailSyncButton } from "@/components/emails/sync-button";
import { InboxAnswerGrid, MerchantAnswerCard } from "@/components/emails/answers";
import { cn } from "@/lib/utils";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

const TAB_COPY: Record<EmailTab, { title: string; description: string }> = {
  all: { title: "Emails", description: "Receipts, bills, bookings and subscriptions extracted from your inbox - searchable and structured." },
  important: { title: "Important emails", description: "Bills, deadlines, appointments, travel, trials and official mail that need your attention." },
  receipts: { title: "Receipts", description: "Proof of payment from shops and services, with amounts extracted." },
  purchases: { title: "Purchases", description: "Orders, deliveries, returns and refunds." },
  bookings: { title: "Bookings", description: "Flights, hotels, restaurants, tickets and appointments." },
};

/** The key date shown for a row, depending on what kind of email it is. */
function keyDate(e: EmailRecord): string | null {
  const x = (e.extracted ?? {}) as Record<string, unknown>;
  if (e.due_date) return `Due ${relativeDay(e.due_date)}`;
  if (typeof x.trial_end_date === "string") return `Trial ends ${formatDate(x.trial_end_date, "short")}`;
  if (typeof x.renewal_date === "string") return `Renews ${formatDate(x.renewal_date, "short")}`;
  if (e.event_start) return `${formatDate(e.event_start, "short")}${x.all_day ? "" : ` ${formatTime(e.event_start)}`}`;
  if (typeof x.delivery_date === "string") return `Arrives ${relativeDay(x.delivery_date)}`;
  return null;
}

export async function EmailsView({ tab, searchParams }: { tab: EmailTab; searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const profile = await getProfile();
  const currency = profile?.base_currency ?? "EUR";
  const base = EMAIL_TABS.find((t) => t.key === tab)!.href;

  const q = one(sp.q)?.trim() || undefined;
  const category = one(sp.category) as EmailCategory | undefined;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const id = one(sp.id);
  const filters = {
    tab,
    q,
    category: category && category in EMAIL_CATEGORY_LABEL ? category : undefined,
    from: isDate(one(sp.from)),
    to: isDate(one(sp.to)),
    page,
  };

  const [list, counts, connection, answers, merchant, detail] = await Promise.all([
    listEmails(supabase, filters),
    tabCounts(supabase),
    gmailConnected(supabase),
    inboxAnswers(supabase),
    q ? merchantAnswer(supabase, q) : Promise.resolve(null),
    id ? getEmailDetail(supabase, id) : Promise.resolve(null),
  ]);
  const google = integrationStatus().google;
  const copy = TAB_COPY[tab];
  const totalPages = Math.max(1, Math.ceil(list.count / list.pageSize));
  const pageHref = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "page" && k !== "id") next.set(k, v);
    if (p > 1) next.set("page", String(p));
    return `${base}${next.size ? `?${next}` : ""}`;
  };
  const rowHref = (e: EmailRecord) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "id") next.set(k, v);
    next.set("id", e.id);
    return `${base}?${next}`;
  };
  const suggestions = [...new Set(answers.topMerchants.map((m) => m.merchant))].slice(0, 4);
  const autoSync = Boolean(connection && !connection.last_synced_at);

  return (
    <div className="space-y-5">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          connection ? (
            <>
              <span className="hidden text-[12px] text-muted md:inline">
                {connection.label} · synced {relativeTime(connection.last_synced_at)}
              </span>
              <GmailSyncButton connectionId={connection.id} autoStart={autoSync} />
              <ButtonLink href="/settings/accounts" variant="ghost" size="icon" aria-label="Email connection settings">
                <Settings />
              </ButtonLink>
            </>
          ) : null
        }
      />

      <p className="-mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <Lock className="size-3.5 shrink-0" /> Read-only Gmail access · nothing is ever sent, deleted or modified · only extracted details and Gmail&apos;s short preview are stored, never full emails
      </p>

      {connection?.status === "expired" || connection?.status === "error" ? (
        <SetupRequired
          title={connection.status === "expired" ? "Gmail access expired" : "The last Gmail sync failed"}
          description={connection.last_error ?? "Reconnect Gmail to resume syncing."}
          action={
            <ButtonLink href="/api/integrations/google/start?services=gmail" variant="primary" prefetch={false}>
              Reconnect Gmail
            </ButtonLink>
          }
        />
      ) : null}

      {!connection && (
        <SetupRequired
          title="Connect Gmail to analyse your inbox"
          description={
            google.configured
              ? "Command Centre asks Google for read-only access (gmail.readonly). It finds receipts, subscriptions, trials, bills, bookings and appointments, and stores only the extracted details."
              : "Gmail needs a Google OAuth client. Add these server environment variables and restart the app - see the README for the Google Cloud setup."
          }
          missing={google.configured ? undefined : google.missing}
          action={
            google.configured ? (
              <ButtonLink href="/api/integrations/google/start?services=gmail" variant="primary" prefetch={false}>
                <Mail /> Connect Gmail (read-only)
              </ButtonLink>
            ) : (
              <ButtonLink href="/settings/accounts" variant="secondary">
                Connected accounts
              </ButtonLink>
            )
          }
        />
      )}

      <EmailFilters suggestions={suggestions} />

      {merchant && <MerchantAnswerCard a={merchant} />}

      {!q && tab === "all" && <InboxAnswerGrid a={answers} base={base} currency={currency} include={["payments", "trials", "bookings", "deliveries", "signups", "merchants"]} />}
      {!q && tab === "important" && <InboxAnswerGrid a={answers} base={base} currency={currency} include={["payments", "trials", "bookings"]} />}
      {!q && tab === "bookings" && <InboxAnswerGrid a={answers} base={base} currency={currency} include={["bookings"]} />}
      {!q && tab === "purchases" && <InboxAnswerGrid a={answers} base={base} currency={currency} include={["deliveries", "merchants"]} />}
      {!q && tab === "receipts" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="Receipts this month" value={formatMoney(answers.receiptsThisMonth.total, currency)} hint={`${answers.receiptsThisMonth.count} receipts & orders`} />
          <StatTile label={`Receipts in ${new Date().getFullYear()}`} value={formatMoney(answers.receiptsThisYear.total, currency)} hint={`${answers.receiptsThisYear.count} receipts & orders, net of refunds`} />
          <StatTile
            label="Top merchant this year"
            value={answers.topMerchants[0]?.merchant ?? "-"}
            hint={answers.topMerchants[0] ? `${formatMoney(answers.topMerchants[0].total, answers.topMerchants[0].currency)} across ${answers.topMerchants[0].count} emails` : "No receipts yet"}
          />
        </div>
      )}

      <Tabs active={base} items={EMAIL_TABS.map((t) => ({ href: t.href, label: t.label, count: counts[t.key] }))} />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3 text-[12.5px] text-muted">
          <span>
            {list.count === 0 ? "No emails" : `${list.count} email${list.count === 1 ? "" : "s"}`}
            {q ? ` matching “${q}”` : ""}
          </span>
          {totalPages > 1 && (
            <span>
              Page {list.page} of {totalPages}
            </span>
          )}
        </div>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={q || filters.category || filters.from || filters.to ? "Nothing matches these filters" : "No emails here yet"}
            description={
              connection
                ? "New receipts, bills and bookings appear after the next sync."
                : "Connect Gmail - or load demo data from the Overview - to see structured email intelligence here."
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {list.rows.map((e) => {
              const Icon = EMAIL_CATEGORY_ICON[e.category];
              const date = keyDate(e);
              const refund = Boolean((e.extracted as { refund?: boolean })?.refund);
              return (
                <li key={e.id}>
                  <Link href={rowHref(e)} scroll={false} className={cn("group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2", id === e.id && "bg-surface-2")}>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-secondary">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                        <span className="truncate">{e.subject ?? "(no subject)"}</span>
                        {e.is_important && <span className="size-1.5 shrink-0 rounded-full bg-warning" title="Important" />}
                        {e.is_demo && <DemoBadge />}
                      </p>
                      <p className="truncate text-[12px] text-muted">
                        {e.merchant ?? e.from_name ?? e.from_email}
                        {e.merchant && e.from_name && e.from_name !== e.merchant ? ` · via ${e.from_name}` : ""}
                        {e.order_number ? ` · #${e.order_number}` : ""}
                      </p>
                    </div>
                    <div className="hidden w-40 shrink-0 text-[12px] text-secondary md:block">{date ?? ""}</div>
                    <div className="hidden w-24 shrink-0 sm:block">
                      <Badge tone={e.category === "bill" || e.category === "trial" ? "warning" : e.category === "cancellation" ? "positive" : "neutral"}>{EMAIL_CATEGORY_LABEL[e.category]}</Badge>
                    </div>
                    <span className={cn("w-24 shrink-0 text-right text-[13px] font-medium tabular", refund && "text-positive")}>
                      {e.amount !== null ? `${refund ? "+" : ""}${formatMoney(Number(e.amount), e.currency ?? currency)}` : ""}
                    </span>
                    <span className="hidden w-20 shrink-0 text-right text-[12px] text-muted lg:block">{relativeTime(e.received_at)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            {list.page > 1 ? (
              <ButtonLink href={pageHref(list.page - 1)} variant="ghost" size="sm">
                <ArrowLeft /> Newer
              </ButtonLink>
            ) : (
              <span />
            )}
            {list.page < totalPages && (
              <ButtonLink href={pageHref(list.page + 1)} variant="ghost" size="sm">
                Older <ArrowRight />
              </ButtonLink>
            )}
          </div>
        )}
      </Card>

      {detail && <EmailDrawer key={detail.email.id} detail={detail} />}
    </div>
  );
}
