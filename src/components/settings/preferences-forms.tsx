"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { updateNotificationPrefs, updateProfile } from "@/app/actions/settings";
import { createCategory, createCategoryRule, deleteCategory, deleteCategoryRule } from "@/app/actions/finance";
import { useTheme } from "@/components/shell/theme";
import { CategoryIcon, CATEGORY_ICON_NAMES } from "@/components/category-icon";
import type { Category, NotificationPrefs } from "@/lib/types";

export function ProfileForm({ name, locale, currency }: { name: string; locale: string; currency: string }) {
  const [pending, start] = useTransition();
  const { theme, setTheme } = useTheme();
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      action={(fd) =>
        start(async () => {
          const res = await updateProfile({ display_name: String(fd.get("display_name") ?? ""), locale: String(fd.get("locale")) as "en-BE" });
          if (res.ok) toast.success("Profile saved");
          else toast.error(res.message);
        })
      }
    >
      <Field label="Display name">
        <Input name="display_name" defaultValue={name} maxLength={80} />
      </Field>
      <Field label="Language & region" hint="Dates use Belgian conventions; weeks start on Monday.">
        <Select name="locale" defaultValue={locale}>
          <option value="en-BE">English (Belgium)</option>
          <option value="nl-BE">Nederlands (België)</option>
          <option value="fr-BE">Français (Belgique)</option>
          <option value="de-BE">Deutsch (Belgien)</option>
          <option value="en-GB">English (UK)</option>
        </Select>
      </Field>
      <Field label="Base currency" hint="Amounts in other currencies are shown as-is, not converted.">
        <Input value={currency} disabled />
      </Field>
      <Field label="Appearance">
        <Select
          value={theme}
          onChange={(e) => {
            const t = e.target.value as "dark" | "light";
            setTheme(t);
            void updateProfile({ theme: t });
          }}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save profile
        </Button>
      </div>
    </form>
  );
}

const PREF_LABELS: { key: keyof Omit<NotificationPrefs, "days_ahead">; label: string; hint: string }[] = [
  { key: "upcoming_payment", label: "Upcoming subscription payments", hint: "Renewals and recurring charges due soon" },
  { key: "upcoming_bill", label: "Upcoming bills", hint: "Invoices with a due date found in your email" },
  { key: "trial_ending", label: "Free trials ending", hint: "Trials about to convert and cancellation deadlines" },
  { key: "new_recurring", label: "New or unexpected recurring payments", hint: "Newly detected subscriptions to review" },
  { key: "price_increase", label: "Price increases", hint: "When a subscription starts charging more" },
  { key: "large_purchase", label: "Large purchases", hint: "Single payments above your threshold" },
  { key: "unusual_spending", label: "Unusual spending", hint: "A category well above its usual monthly level" },
  { key: "event_soon", label: "Important calendar events", hint: "Bookings, appointments and events in the next 48 hours" },
  { key: "charge_after_cancel", label: "Charges after cancellation", hint: "A cancelled subscription still taking money" },
];

export function NotificationPrefsForm({ prefs, threshold }: { prefs: NotificationPrefs; threshold: number }) {
  const [state, setState] = useState(prefs);
  const [limit, setLimit] = useState(String(threshold));
  const [pending, start] = useTransition();
  return (
    <div>
      <ul className="divide-y divide-border">
        {PREF_LABELS.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-4 py-2.5">
            <span>
              <span className="block text-[13px] font-medium">{p.label}</span>
              <span className="block text-[12px] text-muted">{p.hint}</span>
            </span>
            <Switch label={p.label} checked={state[p.key]} onChange={(v) => setState({ ...state, [p.key]: v })} />
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Remind me this many days ahead">
          <Input type="number" min={1} max={30} value={state.days_ahead} onChange={(e) => setState({ ...state, days_ahead: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
        </Field>
        <Field label="Large purchase threshold (€)">
          <Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
      </div>
      <Button
        className="mt-4"
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await updateNotificationPrefs({ prefs: state, large_purchase_threshold: Number(limit.replace(",", ".")) || 150 });
            if (res.ok) toast.success("Notification preferences saved");
            else toast.error(res.message);
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />} Save preferences
      </Button>
      <p className="mt-3 text-[12px] text-muted">Notifications appear in the notification centre (bell icon). They are generated after every sync and once a day.</p>
    </div>
  );
}

export function CategoryManager({ categories, rules }: { categories: Category[]; rules: { id: string; pattern: string; category_id: string }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [icon, setIcon] = useState("tag");
  const custom = categories.filter((c) => !c.is_system);
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-secondary">Your categories</p>
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) =>
            start(async () => {
              const res = await createCategory({ name: String(fd.get("name")), kind: String(fd.get("kind")) as "expense", icon });
              if (res.ok) {
                toast.success("Category created");
                router.refresh();
              } else toast.error(res.message);
            })
          }
        >
          <Field label="Name" className="min-w-40 flex-1">
            <Input name="name" required maxLength={60} placeholder="e.g. Kids, Pets, Gifts" />
          </Field>
          <Field label="Type">
            <Select name="kind" className="w-32">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </Select>
          </Field>
          <Field label="Icon">
            <Select value={icon} onChange={(e) => setIcon(e.target.value)} className="w-36">
              {CATEGORY_ICON_NAMES.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            <Plus /> Add
          </Button>
        </form>
        <ul className="mt-3 divide-y divide-border">
          {custom.length === 0 && <li className="py-2 text-[12.5px] text-muted">No custom categories yet. The built-in ones are always available.</li>}
          {custom.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2">
              <CategoryIcon icon={c.icon} />
              <span className="flex-1 text-[13px]">{c.name}</span>
              <span className="text-[12px] text-muted">{c.kind}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${c.name}`}
                onClick={() =>
                  start(async () => {
                    if (!window.confirm(`Delete "${c.name}"? Its transactions move to Other.`)) return;
                    const res = await deleteCategory(c.id);
                    if (res.ok) router.refresh();
                    else toast.error(res.message);
                  })
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 text-[12.5px] font-medium text-secondary">Categorisation rules</p>
        <form
          className="flex flex-wrap items-end gap-2"
          action={(fd) =>
            start(async () => {
              const res = await createCategoryRule({ pattern: String(fd.get("pattern")), categoryId: String(fd.get("categoryId")), applyNow: true });
              if (res.ok) {
                toast.success(`Rule saved${res.data?.updated ? ` - ${res.data.updated} transactions updated` : ""}`);
                router.refresh();
              } else toast.error(res.message);
            })
          }
        >
          <Field label="When text contains" className="min-w-40 flex-1">
            <Input name="pattern" required minLength={2} maxLength={120} placeholder="e.g. bakkerij" />
          </Field>
          <Field label="Categorise as">
            <Select name="categoryId" className="w-48">
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            <Plus /> Add rule
          </Button>
        </form>
        <ul className="mt-3 divide-y divide-border">
          {rules.length === 0 && <li className="py-2 text-[12.5px] text-muted">Rules are also created when you choose “All from this merchant” while recategorising a transaction.</li>}
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]">
              <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px]">{r.pattern}</code>
              <span className="text-muted">→</span>
              <span className="flex-1">{names.get(r.category_id) ?? r.category_id}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete rule"
                onClick={() =>
                  start(async () => {
                    const res = await deleteCategoryRule(r.id);
                    if (res.ok) router.refresh();
                    else toast.error(res.message);
                  })
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
