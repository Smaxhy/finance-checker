import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getAnthropic } from "@/lib/ai/client";
import { describeAssistantError, runAssistant, type AssistantEvent } from "@/lib/ai/assistant";
import { assistantRateLimit } from "@/lib/ai/rate-limit";

export const maxDuration = 120;

const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(20)
    .refine((m) => m.length > 0 && m[m.length - 1].role === "user", "The last message must be from the user")
    .refine((m) => m.length > 0 && m[0].role === "user", "The first message must be from the user"),
});

/**
 * Streams the assistant's answer as newline-delimited JSON events:
 * {"type":"tool","label":...} while it reads data, {"type":"text","text":...}
 * for answer deltas, then {"type":"done"}. Nothing is persisted server-side.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", detail: parsed.error.issues[0]?.message }, { status: 400 });

  const client = getAnthropic();
  if (!client) return NextResponse.json({ error: "setup_required", missing: ["ANTHROPIC_API_KEY"] }, { status: 503 });

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("ai_assistant_enabled, base_currency").eq("id", user.id).maybeSingle();
  if (!profile?.ai_assistant_enabled) return NextResponse.json({ error: "consent_required" }, { status: 403 });

  const limit = assistantRateLimit.check(user.id);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited", retry_after_seconds: Math.ceil(limit.retryAfterMs / 1000) }, { status: 429, headers: { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) } });
  }

  // Merge consecutive same-role turns (e.g. after a stopped answer) into one.
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of parsed.data.messages) {
    const last = history[history.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else history.push({ ...m });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AssistantEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // client went away
        }
      };
      try {
        await runAssistant({
          client,
          ctx: { supabase, userId: user.id, currency: profile.base_currency ?? "EUR", today: new Date() },
          history,
          emit,
          signal: abort.signal,
        });
        emit({ type: "done" });
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("assistant error", err instanceof Error ? err.message : err);
          emit({ type: "error", message: describeAssistantError(err) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
