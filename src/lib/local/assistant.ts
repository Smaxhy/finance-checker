/**
 * The assistant endpoint for the GitHub Pages edition, answered in the
 * browser. Returns the same newline-delimited JSON stream as the server
 * route, so the chat UI is identical in both editions.
 *
 * The built-in assistant answers by default. Claude answers only when the
 * user has saved their own Anthropic API key in this browser AND switched the
 * AI assistant on; requests then go straight from this browser to Anthropic.
 */
import type { AssistantEvent } from "@/lib/ai/events";
import type { AppSupabaseClient } from "./server";
import { LOCAL_USER_ID, localDb, ready } from "./db";
import { getAiEffort, getAiKey, getAiModel } from "./prefs";

type Turn = { role: "user" | "assistant"; content: string };

function parseMessages(body: BodyInit | null | undefined): Turn[] | null {
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body) as { messages?: unknown };
    if (!Array.isArray(parsed.messages)) return null;
    const turns = parsed.messages
      .filter((m): m is Turn => Boolean(m) && typeof m === "object" && ["user", "assistant"].includes((m as Turn).role) && typeof (m as Turn).content === "string" && (m as Turn).content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
      .slice(-20);
    while (turns.length && turns[0].role !== "user") turns.shift();
    return turns.length && turns[turns.length - 1].role === "user" ? turns : null;
  } catch {
    return null;
  }
}

/** Builds an Anthropic client for this browser, or null when Claude isn't set up. */
export async function browserAnthropic() {
  const apiKey = getAiKey();
  if (!apiKey) return null;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // The key is the user's own and is stored only in this browser, which is the
  // case the SDK's browser opt-in exists for.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
}

export function handleAssistantRequest(init?: RequestInit): Response {
  const messages = parseMessages(init?.body);
  if (!messages) return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "content-type": "application/json" } });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: AssistantEvent) => {
        if (open) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      // "Stop" in the chat aborts the request: end the stream the way a real fetch would.
      init?.signal?.addEventListener("abort", () => {
        abort.abort();
        if (open) {
          open = false;
          controller.error(new DOMException("The request was aborted", "AbortError"));
        }
      });
      try {
        await ready();
        const [{ runAssistantTurn, normaliseHistory }, { describeAssistantError }] = await Promise.all([import("@/lib/ai/run"), import("@/lib/ai/assistant")]);
        const { data: profile } = await localDb.from("profiles").select("ai_assistant_enabled, base_currency").eq("id", LOCAL_USER_ID).maybeSingle();
        const p = profile as { ai_assistant_enabled?: boolean; base_currency?: string } | null;
        const client = p?.ai_assistant_enabled ? await browserAnthropic() : null;
        try {
          await runAssistantTurn({
            claude: client ? { client, model: getAiModel(), effort: getAiEffort() } : null,
            ctx: { supabase: localDb as unknown as AppSupabaseClient, userId: LOCAL_USER_ID, currency: p?.base_currency ?? "EUR", today: new Date() },
            history: normaliseHistory(messages),
            emit,
            signal: abort.signal,
            upgradeHint: getAiKey()
              ? "For free-form questions, switch on Claude under Settings > Privacy & Security."
              : "For free-form questions you can add Claude with your own API key under Settings > Connected Accounts. It's optional.",
          });
          emit({ type: "done" });
        } catch (err) {
          if (!abort.signal.aborted) emit({ type: "error", message: describeAssistantError(err) });
        }
      } catch (err) {
        if (!abort.signal.aborted) emit({ type: "error", message: err instanceof Error ? err.message : "Something went wrong." });
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
