/**
 * Settings the GitHub Pages edition keeps in this browser, outside the data
 * store: the user's own Anthropic API key and Google client ID, and a few
 * preferences. They are never part of the JSON export and never leave the
 * browser except in requests to Anthropic / Google themselves.
 */
import { DEFAULT_AI_MODEL, isAiEffort, modelInfo, type AiEffort } from "@/lib/ai/models";
import { LOCAL_CHANGE_EVENT } from "./db";

const KEYS = {
  aiKey: "cc:ai:key",
  aiModel: "cc:ai:model",
  aiEffort: "cc:ai:effort",
  googleClientId: "cc:google:clientId",
  autoCheck: "cc:google:autoCheck",
} as const;

function read(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null; // storage blocked (private mode)
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked - the setting simply won't persist
  }
  window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
}

// --- Claude (optional, the user's own key) ------------------------------------

export function getAiKey(): string | null {
  return read(KEYS.aiKey)?.trim() || null;
}
export function setAiKey(key: string | null) {
  write(KEYS.aiKey, key?.trim() || null);
}
/** "sk-ant-…a1b2" - enough to recognise the key without showing it. */
export function maskedAiKey(): string | null {
  const key = getAiKey();
  return key ? `${key.slice(0, 7)}…${key.slice(-4)}` : null;
}
export function getAiModel(): string {
  const stored = read(KEYS.aiModel);
  return modelInfo(stored) ? stored! : DEFAULT_AI_MODEL;
}
export function setAiModel(id: string) {
  write(KEYS.aiModel, modelInfo(id) ? id : DEFAULT_AI_MODEL);
}
export function getAiEffort(): AiEffort {
  const stored = read(KEYS.aiEffort);
  return isAiEffort(stored) ? stored : "medium";
}
export function setAiEffort(effort: AiEffort) {
  write(KEYS.aiEffort, effort);
}

// --- Google (read-only mail and calendar) ---------------------------------------

/** A Google OAuth client ID is a public identifier, not a secret. It can also be baked in at build time. */
export function getGoogleClientId(): string | null {
  return read(KEYS.googleClientId)?.trim() || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null;
}
export function setGoogleClientId(id: string | null) {
  write(KEYS.googleClientId, id?.trim() || null);
}
export function isValidGoogleClientId(id: string): boolean {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(id.trim());
}
/** Whether to refresh email automatically when the app is opened (off unless the user turns it on). */
export function getAutoCheck(): boolean {
  return read(KEYS.autoCheck) === "1";
}
export function setAutoCheck(on: boolean) {
  write(KEYS.autoCheck, on ? "1" : null);
}

/** Removes the stored API key (used by "Delete all data"). The Google client ID is not a secret and is kept. */
export function clearLocalSecrets() {
  try {
    window.localStorage.removeItem(KEYS.aiKey);
  } catch {
    // ignore
  }
}
