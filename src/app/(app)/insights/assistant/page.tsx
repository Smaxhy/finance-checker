import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/core";
import { integrationStatus } from "@/lib/env";
import { PageHeader, SetupRequired } from "@/components/ui/misc";
import { ButtonLink } from "@/components/ui/button";
import { AssistantChat } from "./assistant-chat";

export const metadata = { title: "AI Assistant" };

export default async function AssistantPage({ searchParams }: PageProps<"/insights/assistant">) {
  await requireUser();
  const [profile, sp] = await Promise.all([getProfile(), searchParams]);
  const status = integrationStatus().anthropic;
  const consent = Boolean(profile?.ai_assistant_enabled);
  const initialQuestion = typeof sp.q === "string" ? sp.q.slice(0, 500) : undefined;

  const gate = !status.configured ? (
    <SetupRequired
      title="The AI assistant needs an Anthropic API key"
      description={
        <>
          Add <code className="font-mono">ANTHROPIC_API_KEY</code> to the server environment and restart. Until then, every figure is still available in{" "}
          <Link href="/insights/patterns" className="text-accent-text hover:underline">
            Spending Patterns
          </Link>{" "}
          and{" "}
          <Link href="/insights/reports" className="text-accent-text hover:underline">
            Reports
          </Link>
          , which are computed without AI.
        </>
      }
      missing={status.missing}
    />
  ) : !consent ? (
    <SetupRequired
      title="Turn on the AI assistant to ask questions"
      description={
        <div className="space-y-1.5">
          <p>
            To answer a question, the assistant reads your stored data on this server and sends the relevant results - totals, matching transactions, subscription details and
            extracted email fields - together with your question to Anthropic&apos;s API. Full email bodies, bank credentials and tokens are never sent.
          </p>
          <p>Conversations are not saved by this app. You can switch the assistant off again at any time.</p>
        </div>
      }
      action={
        <ButtonLink href="/settings/privacy#ai" variant="primary" size="sm">
          Review and enable in Privacy &amp; Security
        </ButtonLink>
      }
    />
  ) : null;

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader title="AI Assistant" description="Ask about your spending, subscriptions, emails and plans. Answers come only from your own data." />
      {gate ? <div className="mb-6">{gate}</div> : null}
      <AssistantChat enabled={!gate} initialQuestion={initialQuestion} />
    </div>
  );
}
