import Link from "next/link";
import { ArrowRight, Bot, FileBarChart, FlaskConical, Lightbulb } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/core";
import { loadInsights } from "@/lib/engines/insights-loader";
import { integrationStatus } from "@/lib/env";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { InsightList } from "@/components/insights/insight-list";
import { AskBox } from "./ask-box";

export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  const { supabase, user } = await requireUser();
  const [insights, profile] = await Promise.all([loadInsights(supabase, user.id), getProfile()]);
  const aiReady = integrationStatus().anthropic.configured && Boolean(profile?.ai_assistant_enabled);

  const sections = [
    { href: "/insights/assistant", icon: Bot, title: "AI Assistant", text: aiReady ? "Ask questions in plain language - answered from your own data." : "Ask questions in plain language (needs setup).", },
    { href: "/insights/patterns", icon: FlaskConical, title: "Spending Patterns", text: "Day-of-week habits, recurring vs day-to-day, category changes, top merchants." },
    { href: "/insights/reports", icon: FileBarChart, title: "Reports", text: "Monthly report and 12-month overview. Print it or export transactions as CSV." },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Insights" description="Observations computed from your data, plus an assistant for everything else." />
      <AskBox enabled={aiReady} />
      <section className="grid gap-3 md:grid-cols-3">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="card group p-4 transition-all hover:-translate-y-px hover:border-border-strong">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
              <s.icon className="size-4" />
            </span>
            <p className="mt-3 flex items-center gap-1 text-[13.5px] font-medium">
              {s.title} <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </p>
            <p className="mt-1 text-[12.5px] text-muted">{s.text}</p>
          </Link>
        ))}
      </section>
      <Card>
        <CardHeader title="This month at a glance" description="Every statement is computed from stored transactions, subscriptions and events" />
        <CardBody>
          {insights.length ? (
            <InsightList insights={insights} />
          ) : (
            <EmptyState icon={Lightbulb} title="No observations yet" description="They appear once there are a few weeks of activity." className="py-6" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
