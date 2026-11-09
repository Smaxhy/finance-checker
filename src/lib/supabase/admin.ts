import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS, so it is only used in narrowly scoped
 * server modules (token storage, background sync, account deletion) and every
 * call site must filter by an already-authenticated user id.
 */
export function createAdminClient() {
  if (!env.supabaseUrl || !env.supabaseServiceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this operation.");
  }
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
