// Browser replacement for src/lib/env.ts in the GitHub Pages edition. There are no
// server environment variables: what counts as "configured" is what the user has
// set up in this browser (their own Anthropic key, their own Google client ID).
import { BASE_PATH } from "./mode";
import { getAiEffort, getAiKey, getAiModel, getGoogleClientId } from "./prefs";

export const env = {
  get appUrl() {
    return typeof window === "undefined" ? "" : `${window.location.origin}${BASE_PATH}`;
  },
  supabaseUrl: undefined as string | undefined,
  supabaseAnonKey: undefined as string | undefined,
  supabaseServiceKey: undefined as string | undefined,
  tokenEncryptionKey: undefined as string | undefined,
  cronSecret: undefined as string | undefined,
  google: {
    get clientId() {
      return getGoogleClientId() ?? undefined;
    },
    clientSecret: undefined as string | undefined,
  },
  enableBanking: {
    applicationId: undefined as string | undefined,
    privateKey: undefined as string | undefined,
    apiOrigin: "https://api.enablebanking.com",
    country: "BE",
  },
  anthropic: {
    get apiKey() {
      return getAiKey() ?? undefined;
    },
    get model() {
      return getAiModel();
    },
    get extractionModel() {
      return getAiModel();
    },
    get effort() {
      return getAiEffort() as string | undefined;
    },
  },
};

export type IntegrationKey = "supabase" | "encryption" | "google" | "enableBanking" | "anthropic" | "cron";

export interface IntegrationStatus {
  key: IntegrationKey;
  configured: boolean;
  missing: string[];
}

export function integrationStatus(): Record<IntegrationKey, IntegrationStatus> {
  const s = (key: IntegrationKey, configured: boolean): IntegrationStatus => ({ key, configured, missing: [] });
  return {
    supabase: s("supabase", false),
    encryption: s("encryption", false),
    google: s("google", Boolean(getGoogleClientId())),
    enableBanking: s("enableBanking", false),
    anthropic: s("anthropic", Boolean(getAiKey())),
    cron: s("cron", false),
  };
}

export function isSupabaseConfigured(): boolean {
  return false;
}
