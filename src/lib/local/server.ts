// Browser replacement for src/lib/supabase/server.ts in the GitHub Pages edition:
// there is exactly one user (you), and the "database" is the on-device store.
import type { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { LOCAL_USER_ID, localDb } from "./db";

export type AppSupabaseClient = ReturnType<typeof createSupabaseClient>;

export interface SessionUser {
  id: string;
  email: string | null;
}

const user: SessionUser = { id: LOCAL_USER_ID, email: null };

export async function createClient(): Promise<AppSupabaseClient> {
  return localDb as unknown as AppSupabaseClient;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return user;
}

export async function requireUser(): Promise<{ user: SessionUser; supabase: AppSupabaseClient }> {
  return { user, supabase: localDb as unknown as AppSupabaseClient };
}
