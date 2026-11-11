/**
 * Central place for configuration. Integrations are optional: when their
 * variables are missing the UI shows a "requires setup" state instead of
 * pretending the feature works.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export const env = {
  appUrl: read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: read("SUPABASE_SECRET_KEY") ?? read("SUPABASE_SERVICE_ROLE_KEY"),
  tokenEncryptionKey: read("TOKEN_ENCRYPTION_KEY"),
  cronSecret: read("CRON_SECRET"),
  google: {
    clientId: read("GOOGLE_CLIENT_ID"),
    clientSecret: read("GOOGLE_CLIENT_SECRET"),
  },
  enableBanking: {
    applicationId: read("ENABLE_BANKING_APP_ID"),
    // PEM private key. Newlines may be passed as literal "\n".
    privateKey: read("ENABLE_BANKING_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
    apiOrigin: read("ENABLE_BANKING_API_ORIGIN") ?? "https://api.enablebanking.com",
    country: read("ENABLE_BANKING_COUNTRY") ?? "BE",
  },
  anthropic: {
    // The SDK also resolves ANTHROPIC_AUTH_TOKEN / profiles; we only gate on an explicit key.
    apiKey: read("ANTHROPIC_API_KEY"),
    model: read("AI_MODEL") ?? "claude-opus-5-5",
    extractionModel: read("AI_EXTRACTION_MODEL") ?? read("AI_MODEL") ?? "claude-opus-5-5",
    // low | medium | high - how much reasoning the assistant spends per answer.
    effort: read("AI_EFFORT"),
  },
};

export type IntegrationKey = "supabase" | "encryption" | "google" | "enableBanking" | "anthropic" | "cron";

export interface IntegrationStatus {
  key: IntegrationKey;
  configured: boolean;
  missing: string[];
}

export function integrationStatus(): Record<IntegrationKey, IntegrationStatus> {
  const check = (key: IntegrationKey, vars: Record<string, string | undefined>): IntegrationStatus => {
    const missing = Object.entries(vars)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    return { key, configured: missing.length === 0, missing };
  };
  return {
    supabase: check("supabase", {
      NEXT_PUBLIC_SUPABASE_URL: env.supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.supabaseAnonKey,
      SUPABASE_SERVICE_ROLE_KEY: env.supabaseServiceKey,
    }),
    encryption: check("encryption", { TOKEN_ENCRYPTION_KEY: env.tokenEncryptionKey }),
    google: check("google", {
      GOOGLE_CLIENT_ID: env.google.clientId,
      GOOGLE_CLIENT_SECRET: env.google.clientSecret,
      TOKEN_ENCRYPTION_KEY: env.tokenEncryptionKey,
    }),
    enableBanking: check("enableBanking", {
      ENABLE_BANKING_APP_ID: env.enableBanking.applicationId,
      ENABLE_BANKING_PRIVATE_KEY: env.enableBanking.privateKey,
      TOKEN_ENCRYPTION_KEY: env.tokenEncryptionKey,
    }),
    anthropic: check("anthropic", { ANTHROPIC_API_KEY: env.anthropic.apiKey }),
    cron: check("cron", { CRON_SECRET: env.cronSecret }),
  };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
