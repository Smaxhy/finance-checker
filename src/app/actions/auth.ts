"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export interface AuthState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(10, "Use at least 10 characters").max(128),
});

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  // Only allow same-site relative paths to avoid open redirects.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : env.appUrl;
}

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Incorrect email or password." };
  await supabase.rpc("log_audit", { p_action: "auth.sign_in", p_details: {} });
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { data: { display_name: name || undefined }, emailRedirectTo: `${await origin()}/auth/callback` },
  });
  if (error) return { error: error.message };
  if (!data.session) return { message: "Check your inbox to confirm your email address, then sign in." };
  await supabase.rpc("log_audit", { p_action: "auth.sign_up", p_details: {} });
  redirect("/?welcome=1");
}

export async function sendMagicLink(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = z.email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address" };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${await origin()}/auth/callback` },
  });
  if (error) return { error: "Could not send a sign-in link. Check the address or use your password." };
  return { message: "If an account exists for that address, a sign-in link is on its way." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.rpc("log_audit", { p_action: "auth.sign_out", p_details: {} });
  await supabase.auth.signOut();
  redirect("/login");
}
