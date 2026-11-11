import type { DataCard } from "@/lib/ai/cards";

export interface StreamEvent {
  type: string;
  text?: string;
  label?: string;
  name?: string;
  message?: string;
  /** "engine" events: which assistant is answering. */
  engine?: "builtin" | "claude";
  model?: string;
  /** "card" events: a chart or table drawn from the data. */
  card?: DataCard;
  /** "suggestions" events: follow-up questions. */
  items?: string[];
  /** "usage" events (Claude only). */
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number | null;
}

/**
 * Splits a growing NDJSON buffer into complete events and the unfinished
 * remainder (network chunks can end mid-line). Malformed lines are skipped.
 */
export function consumeNdjson(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  let rest = buffer;
  let nl: number;
  while ((nl = rest.indexOf("\n")) >= 0) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as StreamEvent;
      if (parsed && typeof parsed.type === "string") events.push(parsed);
    } catch {
      // ignore malformed line
    }
  }
  return { events, rest };
}
