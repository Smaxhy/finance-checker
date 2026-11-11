/**
 * One assistant turn, shared by the server route (full edition) and the
 * in-browser handler (GitHub Pages edition). Uses Claude when a client is
 * available and the user has switched it on; otherwise - or when Claude can't
 * be reached - the built-in assistant answers from the same data.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { describeAssistantError, runAssistant } from "./assistant";
import { runBuiltinAssistant } from "./builtin";
import type { AssistantEvent } from "./events";
import type { AiEffort } from "./models";
import type { ToolContext } from "./tools";

export interface AssistantTurnOptions {
  ctx: ToolContext;
  history: { role: "user" | "assistant"; content: string }[];
  emit: (e: AssistantEvent) => void;
  signal?: AbortSignal;
  /** null = answer with the built-in assistant. */
  claude: { client: Anthropic; model: string; effort?: AiEffort } | null;
  /** Shown when the built-in assistant can't handle a question. */
  upgradeHint?: string;
}

/** Merge consecutive same-role turns (e.g. after a stopped answer) into one. */
export function normaliseHistory(messages: { role: "user" | "assistant"; content: string }[]) {
  const history: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const last = history[history.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else history.push({ ...m });
  }
  return history;
}

export async function runAssistantTurn({ ctx, history, emit, signal, claude, upgradeHint }: AssistantTurnOptions): Promise<void> {
  if (!claude) {
    emit({ type: "engine", engine: "builtin" });
    await runBuiltinAssistant({ ctx, history, emit, upgradeHint });
    return;
  }
  emit({ type: "engine", engine: "claude", model: claude.model });
  let started = false;
  const tracked = (e: AssistantEvent) => {
    if (e.type === "text" || e.type === "card") started = true;
    emit(e);
  };
  try {
    await runAssistant({ client: claude.client, model: claude.model, effort: claude.effort, ctx, history, emit: tracked, signal });
  } catch (err) {
    if (signal?.aborted || started) throw err;
    // Claude couldn't be reached or refused the key: still give an answer from the data.
    emit({ type: "notice", text: `${describeAssistantError(err)} This answer comes from the built-in assistant instead.` });
    emit({ type: "engine", engine: "builtin" });
    await runBuiltinAssistant({ ctx, history, emit });
  }
}
