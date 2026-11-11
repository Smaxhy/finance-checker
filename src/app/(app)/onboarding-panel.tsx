import Link from "next/link";
import { ArrowRight, CalendarDays, FileUp, FlaskConical, Landmark, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { integrationStatus } from "@/lib/env";
import { LoadDemoButton } from "@/components/demo-controls";
import { IS_LOCAL } from "@/lib/local/mode";

export function OnboardingPanel() {
  const status = integrationStatus();
  const all = [
    {
      icon: Mail,
      title: "Connect your email accounts",
      text: "Read-only, as many Gmail accounts as you have. Finds receipts, subscriptions, trials, bills and bookings.",
      href: "/settings/accounts",
      ready: status.google.configured,
    },
    {
      bank: true,
      icon: Landmark,
      title: "Connect your bank",
      text: "PSD2 read-only access via Enable Banking - KBC, Belfius, ING, BNP Paribas Fortis, Argenta…",
      href: "/settings/accounts",
      ready: status.enableBanking.configured,
    },
    {
      icon: FileUp,
      title: "Import a bank CSV",
      text: "Works today with any Belgian bank export - no API keys needed.",
      href: "/finances/transactions?import=1",
      ready: true,
    },
    {
      icon: CalendarDays,
      title: "Connect Google Calendar",
      text: "Read-only. Combines your agenda with renewals, bills and bookings.",
      href: "/settings/accounts",
      ready: status.google.configured,
    },
    {
      localOnly: true,
      icon: Sparkles,
      title: "Ask the assistant",
      text: "Works straight away, no setup: ask about your money or run a full check-up.",
      href: "/insights/assistant",
      ready: true,
    },
  ];
  // Live bank connections need a server; the browser-only edition offers the assistant tile instead.
  const sources = all.filter((s) => (IS_LOCAL ? !("bank" in s) : !("localOnly" in s)));
  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="card p-6">
        <h2 className="text-[15px] font-semibold">Bring your data in</h2>
        <p className="mt-1 text-[13px] text-muted">
          Nothing is shown until you connect a source - no invented numbers. Every connection is read-only and can be removed (with its data) at any time.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {sources.map((s) => (
            <Link key={s.title} href={s.href} className="group rounded-xl border border-border bg-surface-2/50 p-4 transition-all hover:-translate-y-px hover:border-border-strong hover:bg-surface-2">
              <div className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                  <s.icon className="size-4" />
                </span>
                {!s.ready && <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted">Needs setup</span>}
              </div>
              <p className="mt-3 flex items-center gap-1 text-[13.5px] font-medium">
                {s.title} <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
              <p className="mt-1 text-[12.5px] text-muted">{s.text}</p>
            </Link>
          ))}
        </div>
      </div>
      <div className="card flex flex-col p-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-warning-soft text-warning">
          <FlaskConical className="size-4" />
        </span>
        <h2 className="mt-3 text-[15px] font-semibold">Explore with demo data</h2>
        <p className="mt-1 flex-1 text-[13px] text-muted">
          Loads six months of realistic Belgian sample data - transactions, subscriptions, emails and events - so you can try every feature. Everything is clearly marked
          <span className="mx-1 rounded px-1 text-[10px] font-semibold text-warning ring-1 ring-warning/40">DEMO</span>
          and can be removed in one click.
        </p>
        <div className="mt-4">
          <LoadDemoButton />
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-[12px] text-muted">
          <ShieldCheck className="size-3.5" /> Demo data never mixes with synced data.
        </p>
      </div>
    </div>
  );
}
