import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/lib/env";

/**
 * Supabase client bound to the signed-in user's session cookie.
 * Every query made with it is subject to row-level security.
 */
export async function createClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are refreshed by the proxy instead.
        }
      },
    },
  });
}

export type AppSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Verified current user (validated with the auth server), or null. Cached per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
});

/** Use in pages, actions and route handlers that require a signed-in user. */
export async function requireUser(): Promise<{ user: SessionUser; supabase: AppSupabaseClient }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  return { user, supabase };
}
