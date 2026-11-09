"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, Bot, Eraser, Loader2, Lock, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MiniMarkdown } from "@/components/insights/mini-markdown";
import { consumeNdjson } from "@/components/insights/ndjson";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "How much money did I spend this month?",
  "What did I spend the most money on?",
  "How much did I spend on subscriptions this year?",
  "What subscriptions am I currently paying for?",
  "What payments are coming up?",
  "How much do I spend on food every month?",
  "What are my biggest recurring expenses?",
  "Which subscriptions haven't I used or interacted with recently?",
  "How much did I spend last month compared to this month?",
  "What important events do I have next week?",
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  activity: string[];
  status: "streaming" | "done" | "error" | "stopped";
  notice?: string;
}

const ERRORS: Record<string, string> = {
  setup_required: "The assistant isn't configured on this server (ANTHROPIC_API_KEY is missing).",
  consent_required: "The AI assistant is switched off. Enable it in Privacy & Security to ask questions.",
  rate_limited: "You've asked a lot of questions in a short time. Please wait a few minutes.",
  unauthenticated: "Your session has expired. Sign in again.",
  invalid_request: "That message couldn't be sent.",
};

let counter = 0;
const newId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

export function AssistantChat({ enabled, initialQuestion }: { enabled: boolean; initialQuestion?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoSent = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const update = (id: string, fn: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy || !enabled) return;
      const userMsg: ChatMessage = { id: newId(), role: "user", content: question, activity: [], status: "done" };
      const reply: ChatMessage = { id: newId(), role: "assistant", content: "", activity: [], status: "streaming" };
      // History = completed turns with content, oldest first; capped to the last 20 turns.
      const history = [...messages, userMsg]
        .filter((m) => m.content.trim().length > 0 && (m.role === "user" || m.status !== "error"))
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
        .slice(-20);
      while (history.length && history[0].role !== "user") history.shift();
      setMessages((all) => [...all, userMsg, reply]);
      setInput("");
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          update(reply.id, (m) => ({ ...m, status: "error", content: "", notice: ERRORS[body.error ?? ""] ?? "The assistant couldn't answer right now." }));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = consumeNdjson(buffer);
          buffer = rest;
          for (const event of events) {
            if (event.type === "text" && event.text) update(reply.id, (m) => ({ ...m, content: m.content + event.text }));
            else if (event.type === "tool" && event.label) update(reply.id, (m) => (m.activity.includes(event.label!) ? m : { ...m, activity: [...m.activity, event.label!] }));
            else if (event.type === "notice" && event.text) update(reply.id, (m) => ({ ...m, notice: event.text }));
            else if (event.type === "error") update(reply.id, (m) => ({ ...m, status: "error", notice: event.message ?? "Something went wrong." }));
          }
        }
        update(reply.id, (m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
      } catch (e) {
        if (controller.signal.aborted) update(reply.id, (m) => ({ ...m, status: "stopped" }));
        else update(reply.id, (m) => ({ ...m, status: "error", notice: e instanceof Error ? e.message : "Network error" }));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, enabled, messages],
  );

  // ?q= from the command palette: ask once, then drop it from the URL.
  useEffect(() => {
    if (initialQuestion && enabled && !autoSent.current) {
      autoSent.current = true;
      router.replace(pathname, { scroll: false });
      void send(initialQuestion);
    } else if (initialQuestion && !enabled && !autoSent.current) {
      autoSent.current = true;
      setInput(initialQuestion);
    }
  }, [initialQuestion, enabled, send, router, pathname]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-3xl py-6">
            <div className="flex flex-col items-center text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text ring-1 ring-accent/20">
                <Sparkles className="size-4.5" />
              </span>
              <p className="mt-3 text-[15px] font-medium">What would you like to know?</p>
              <p className="mt-1 max-w-md text-[13px] text-muted">Every answer is computed from your transactions, subscriptions, emails and calendar - never estimated.</p>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  disabled={!enabled}
                  onClick={() => void send(s)}
                  className="group rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left text-[13px] text-secondary transition-all hover:-translate-y-px hover:border-border-strong hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-5 pb-4" aria-live="polite">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-3 px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-fg">{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text ring-1 ring-accent/20">
                    <Bot className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1 text-[13.5px] text-secondary">
                    {m.activity.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {m.activity.map((a, i) => (
                          <span key={a} className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[11.5px] text-muted ring-1 ring-border">
                            {m.status === "streaming" && i === m.activity.length - 1 && !m.content ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-accent" />}
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content ? (
                      <MiniMarkdown text={m.content} />
                    ) : m.status === "streaming" && m.activity.length === 0 ? (
                      <span className="inline-flex items-center gap-2 text-muted">
                        <Loader2 className="size-3.5 animate-spin" /> Thinking…
                      </span>
                    ) : null}
                    {m.status === "streaming" && m.content && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />}
                    {m.status === "stopped" && <p className="mt-1.5 text-[12px] text-muted">Stopped.</p>}
                    {m.notice && <p className={cn("mt-2 rounded-lg px-3 py-2 text-[12.5px]", m.status === "error" ? "bg-danger-soft text-danger" : "bg-surface-2 text-muted")}>{m.notice}</p>}
                  </div>
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="sticky bottom-[calc(60px+env(safe-area-inset-bottom))] mx-auto mt-4 w-full max-w-3xl lg:bottom-0 bg-gradient-to-t from-bg via-bg to-transparent pt-4 pb-2">
        <div className={cn("card flex items-end gap-2 p-2 transition-colors focus-within:border-accent/60", !enabled && "opacity-60")}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={4000}
            disabled={!enabled}
            placeholder={enabled ? "Ask about your money, subscriptions, emails or plans…" : "The assistant is unavailable until it is set up"}
            aria-label="Your question"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[13.5px] text-fg outline-none placeholder:text-muted [field-sizing:content]"
          />
          {messages.length > 0 && !busy && (
            <Button variant="ghost" size="icon" onClick={() => setMessages([])} aria-label="Clear conversation" title="Clear conversation">
              <Eraser />
            </Button>
          )}
          {busy ? (
            <Button variant="secondary" size="icon" onClick={() => abortRef.current?.abort()} aria-label="Stop">
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button variant="primary" size="icon" disabled={!enabled || !input.trim()} onClick={() => void send(input)} aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-muted">
          <Lock className="size-3" /> Read-only: the assistant can&apos;t send emails, make payments or cancel anything. Conversations aren&apos;t saved.
        </p>
      </div>
    </div>
  );
}
