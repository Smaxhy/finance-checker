/**
 * Claude models the assistant can use, their list prices and request options.
 * Prices are Anthropic's first-party API rates in USD per million tokens as of
 * November 2026; they are only used to show an approximate cost per answer.
 */
export type AiEffort = "low" | "medium" | "high";

export interface AiModelInfo {
  id: string;
  name: string;
  blurb: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

export const AI_MODELS: AiModelInfo[] = [
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", blurb: "Recommended. Strong analysis at a moderate price.", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
  { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", blurb: "Faster and about half the price.", inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1 },
  { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", blurb: "Fastest and cheapest; fine for simple questions.", inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01 },
  { id: "claude-fable-5-2", name: "Claude Fable 5.2", blurb: "Most capable and most expensive; slower.", inputPerMTok: 8, outputPerMTok: 40, cacheReadPerMTok: 0.2 },
];

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export const AI_EFFORTS: { id: AiEffort; name: string; blurb: string }[] = [
  { id: "low", name: "Quick", blurb: "Short answers, lowest cost." },
  { id: "medium", name: "Balanced", blurb: "Good detail at a sensible cost." },
  { id: "high", name: "Thorough", blurb: "Digs deeper; slower and costs more." },
];

export function isAiEffort(v: unknown): v is AiEffort {
  return v === "low" || v === "medium" || v === "high";
}

export function modelInfo(id: string | null | undefined): AiModelInfo | null {
  return AI_MODELS.find((m) => m.id === id) ?? null;
}

export function modelName(id: string | null | undefined): string {
  return modelInfo(id)?.name ?? id ?? "Claude";
}

/** Server-side refusal fallback: the API re-runs a declined request on a suitable model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

/** Claude Haiku has no server-side fallback; the parameter must be left out for it. */
export function supportsServerFallback(model: string): boolean {
  return !model.startsWith("claude-haiku");
}

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Approximate cost of one API response, or null for a model without a known price. */
export function estimateCostUsd(model: string, usage: UsageLike): number | null {
  const info = modelInfo(model);
  if (!info) return null;
  const input = usage.input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  return (input * info.inputPerMTok + written * info.inputPerMTok * 1.25 + read * info.cacheReadPerMTok + output * info.outputPerMTok) / 1_000_000;
}
