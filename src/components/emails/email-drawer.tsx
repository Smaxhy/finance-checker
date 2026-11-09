"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowUpRight, CalendarDays, Landmark, Loader2, Lock, Repeat, Star, Trash2, X } from "lucide-react";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EMAIL_CATEGORY_ICON, EMAIL_CATEGORY_LABEL } from "@/components/lists/lists";
import { removeEmailRecord, setEmailImportant, updateEmailCategory } from "@/app/actions/emails";
import { formatDate, formatDateTime, formatMoney, formatTime } from "@/lib/format";
import type { EmailCategory } from "@/lib/types";
import type { EmailDetail } from "@/lib/email/queries";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS = Object.entries(EMAIL_CATEGORY_LABEL) as [EmailCategory, string][];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] text-fg">{children}</dd>
    </div>
  );
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

export function EmailDrawer({ detail }: { detail: EmailDetail }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(true);
  const [pending, start] = useTransition();
  const { email, matchedTransaction, events, subscription } = detail;
  const x = (email.extracted ?? {}) as Record<string, unknown>;
  const Icon = EMAIL_CATEGORY_ICON[email.category];

  const close = () => {
    setOpen(false);
    const next = new URLSearchParams(params.toString());
    next.delete("id");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(r.message ?? "Something went wrong");
    });

  const fields: [string, ReactNode][] = [];
  if (email.merchant) fields.push(["Merchant", email.merchant]);
  if (email.amount !== null) fields.push([x.refund ? "Refund" : "Amount", formatMoney(Number(email.amount), email.currency ?? "EUR")]);
  if (email.order_number) fields.push([email.category === "bill" ? "Invoice no." : "Order / booking no.", <span key="o" className="font-mono text-[12.5px]">{email.order_number}</span>]);
  if (email.due_date) fields.push(["Due date", formatDate(email.due_date, "long")]);
  if (isDate(x.trial_end_date)) fields.push(["Trial ends", formatDate(x.trial_end_date, "long")]);
  if (isDate(x.renewal_date)) fields.push(["Renews on", formatDate(x.renewal_date, "long")]);
  if (typeof x.billing_cycle === "string") fields.push(["Billing", x.billing_cycle]);
  if (typeof x.old_price === "number" && typeof x.new_price === "number")
    fields.push(["Price change", `${formatMoney(x.old_price, email.currency ?? "EUR")} → ${formatMoney(x.new_price, email.currency ?? "EUR")}`]);
  if (email.event_start) fields.push([email.category === "travel" ? "Departure" : "Starts", x.all_day ? formatDate(email.event_start, "long") : formatDateTime(email.event_start)]);
  if (email.event_end) fields.push(["Ends", formatDateTime(email.event_end)]);
  if (typeof x.flight === "string" && x.flight) fields.push(["Flight", `${x.flight}${x.from && x.to ? ` · ${x.from} → ${x.to}` : ""}`]);
  if (email.location) fields.push(["Location", email.location]);
  if (isDate(x.delivery_date)) fields.push(["Delivery", formatDate(x.delivery_date, "long")]);
  if (typeof x.carrier === "string") fields.push(["Carrier", x.carrier]);
  if (typeof x.tracking_number === "string") fields.push(["Tracking", <span key="t" className="font-mono text-[12.5px]">{x.tracking_number}</span>]);
  if (x.pay_at_property && typeof x.amount_due === "number") fields.push(["Still to pay", `${formatMoney(x.amount_due, email.currency ?? "EUR")} at the property`]);
  if (typeof x.payment_method === "string") fields.push(["Paid with", x.payment_method]);
  if (Array.isArray(x.items) && x.items.length) fields.push(["Items", (x.items as string[]).join(", ")]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-border bg-surface shadow-2xl outline-none data-[state=open]:animate-slide-up">
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-secondary">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[14.5px] leading-snug font-semibold">{email.subject ?? "(no subject)"}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 truncate text-[12.5px] text-muted">
                {email.from_name ?? email.from_email}
                {email.from_name && email.from_email ? ` <${email.from_email}>` : ""} · {formatDate(email.received_at, "medium")} {formatTime(email.received_at)}
              </DialogPrimitive.Description>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone="accent">{EMAIL_CATEGORY_LABEL[email.category]}</Badge>
                {email.is_important && <Badge tone="warning">Important</Badge>}
                {x.cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
                {email.is_demo && <DemoBadge />}
                <Badge tone="outline">{email.extraction_method === "ai" ? "Extracted by AI" : email.extraction_method === "demo" ? "Sample data" : "Extracted by rules"}</Badge>
              </div>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {fields.length > 0 ? (
              <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 rounded-xl border border-border bg-surface-2/40 p-4">
                {fields.map(([label, value]) => (
                  <Field key={label} label={label}>
                    {value}
                  </Field>
                ))}
              </dl>
            ) : (
              <p className="text-[12.5px] text-muted">No structured fields were found in this email.</p>
            )}

            {email.snippet && (
              <div>
                <p className="mb-1.5 text-[11.5px] text-muted">Preview from Gmail</p>
                <blockquote className="rounded-lg border-l-2 border-border-strong bg-surface-2/40 px-3 py-2 text-[12.5px] leading-relaxed text-secondary">{email.snippet}</blockquote>
              </div>
            )}

            {(matchedTransaction || events.length > 0 || subscription) && (
              <div className="space-y-1.5">
                <p className="text-[11.5px] text-muted">Linked in Command Centre</p>
                {matchedTransaction && (
                  <Link href={`/finances/transactions?q=${encodeURIComponent(matchedTransaction.merchant ?? email.merchant ?? "")}`} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-[12.5px] transition-colors hover:bg-surface-2">
                    <Landmark className="size-3.5 text-muted" />
                    <span className="flex-1">
                      Matched bank transaction · {formatDate(matchedTransaction.booked_at, "medium")}
                    </span>
                    <span className="tabular font-medium">{formatMoney(Number(matchedTransaction.amount), matchedTransaction.currency, { sign: true })}</span>
                  </Link>
                )}
                {events.map((ev) => (
                  <Link key={ev.id} href={`/calendar/events?id=${ev.id}`} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-[12.5px] transition-colors hover:bg-surface-2">
                    <CalendarDays className="size-3.5 text-muted" />
                    <span className="flex-1 truncate">{ev.title}</span>
                    <span className="text-muted">{formatDate(ev.starts_at, "short")}</span>
                  </Link>
                ))}
                {subscription && (
                  <Link href={`/subscriptions/${subscription.id}`} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-[12.5px] transition-colors hover:bg-surface-2">
                    <Repeat className="size-3.5 text-muted" />
                    <span className="flex-1 truncate">
                      {subscription.name} · {subscription.status.replace("_", " ")}
                    </span>
                    {subscription.amount !== null && (
                      <span className="tabular text-muted">
                        {formatMoney(Number(subscription.amount), subscription.currency)} / {subscription.billing_cycle.replace("ly", "")}
                      </span>
                    )}
                  </Link>
                )}
              </div>
            )}

            <div className="space-y-2 rounded-xl border border-border p-4">
              <p className="text-[12.5px] font-medium">Correct this record</p>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  className="w-48"
                  defaultValue={email.category}
                  disabled={pending}
                  aria-label="Category"
                  onChange={(e) => act(() => updateEmailCategory(email.id, e.target.value), "Category updated")}
                >
                  {CATEGORY_OPTIONS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" disabled={pending} onClick={() => act(() => setEmailImportant(email.id, !email.is_important), email.is_important ? "Removed from Important" : "Marked as important")}>
                  <Star className={cn(email.is_important && "fill-current text-warning")} /> {email.is_important ? "Important" : "Mark important"}
                </Button>
              </div>
              <p className="text-[11.5px] text-muted">Changes only affect Command Centre - your mailbox is never modified.</p>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-5 py-3">
            {email.web_link && email.provider === "gmail" ? (
              <a href={email.web_link} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md")}>
                Open in Gmail <ArrowUpRight />
              </a>
            ) : (
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <Lock className="size-3.5" /> {email.is_demo ? "Sample email - not in a real mailbox" : "Not linked to a mailbox"}
              </span>
            )}
            <Button
              variant="ghost"
              className="ml-auto text-muted hover:text-danger"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Remove this record from Command Centre? The email in your mailbox is not touched.")) {
                  act(() => removeEmailRecord(email.id), "Record removed", close);
                }
              }}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove record
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
