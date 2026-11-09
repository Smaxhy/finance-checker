import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

/**
 * Anthropic client, or null when ANTHROPIC_API_KEY is not configured.
 * Callers must also check the user's explicit AI consent flags on their
 * profile (ai_assistant_enabled / ai_email_extraction_enabled) before sending
 * any personal data.
 */
export function getAnthropic(): Anthropic | null {
  if (!env.anthropic.apiKey) return null;
  return new Anthropic({ apiKey: env.anthropic.apiKey });
}

/** Server-side refusal fallback: the API re-runs a declined request on a suitable model. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

export const AI_MODEL = env.anthropic.model;
export const AI_EXTRACTION_MODEL = env.anthropic.extractionModel;
