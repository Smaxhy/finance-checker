import Link from "next/link";
import { ShieldCheck, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getProfile } from "@/lib/data/core";
import { env, integrationStatus } from "@/lib/env";
import { modelName } from "@/lib/ai/models";
import { IS_LOCAL } from "@/lib/local/mode";
import { PageHeader } from "@/components/ui/misc";
import { AssistantChat } from "./assistant-chat";

export const metadata = { title: "AI Assistant" };

export default async function AssistantPage({ searchParams }: PageProps<"/insights/assistant">) {
  await requireUser();
  const [profile, sp] = await Promise.all([getProfile(), searchParams]);
  const configured = integrationStatus().anthropic.configured;
  const consent = Boolean(profile?.ai_assistant_enabled);
  const claude = configured && consent;
  const initialQuestion = typeof sp.q === "string" ? sp.q.slice(0, 500) : undefined;
  const where = IS_LOCAL ? "in this browser" : "on this server";

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader title="AI Assistant" description="Ask about your spending, subscriptions, emails and plans. Answers come only from your own data." />
      <div className="mx-auto mb-2 w-full max-w-3xl" data-testid="assistant-mode" data-mode={claude ? "claude" : "builtin"}>
        {claude ? (
          <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[12.5px] text-muted">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-text" />
            <span>
              <span className="font-medium text-fg">{modelName(env.anthropic.model)} is answering.</span> Your question and the figures it looks up are sent to Anthropic to write the answer - never email
              bodies, bank logins or tokens.{" "}
              <Link href="/settings/privacy#ai" className="text-accent-text hover:underline">
                Change
              </Link>
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[12.5px] text-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />
            <span>
              <span className="font-medium text-fg">The built-in assistant is answering.</span> It works out common questions {where} and sends nothing anywhere. For free-form questions and deeper
              analysis,{" "}
              <Link href={configured ? "/settings/privacy#ai" : "/settings/accounts#ai"} className="text-accent-text hover:underline">
                {configured ? "switch on Claude" : "add Claude (optional)"}
              </Link>
              .
            </span>
          </p>
        )}
      </div>
      <AssistantChat initialQuestion={initialQuestion} />
    </div>
  );
}
