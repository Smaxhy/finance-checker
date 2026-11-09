import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, readSecrets, upsertConnection, writeSecrets } from "@/lib/integrations/connections";
import { exchangeGoogleCode, fetchGoogleEmail, type GoogleSecrets } from "@/lib/integrations/google/oauth";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(request: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings/accounts?${q}`, request.url));
    res.cookies.delete({ name: "g_oauth", path: "/api/integrations/google" });
    return res;
  };
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("error=google_denied");
  const raw = request.cookies.get("g_oauth")?.value;
  let saved: { state: string; verifier: string; uid: string } | null = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const state = params.get("state") ?? "";
  const code = params.get("code");
  if (!saved || !code || !safeEqual(saved.state, state) || saved.uid !== user.id) return back("error=google_state");

  try {
    const tokens = await exchangeGoogleCode(code, saved.verifier);
    const email = await fetchGoogleEmail(tokens.access_token);
    const granted = (tokens.scope ?? "").split(" ").filter((s) => s.startsWith("https://www.googleapis.com/auth/"));
    const admin = createAdminClient();
    const connection = await upsertConnection(admin, { userId: user.id, provider: "google", label: email, scopes: granted, metadata: { email } });
    const previous = await readSecrets<GoogleSecrets>(admin, connection.id, user.id).catch(() => null);
    const refresh = tokens.refresh_token ?? previous?.refresh_token;
    if (!refresh) return back("error=google_no_refresh");
    await writeSecrets(admin, connection.id, user.id, {
      refresh_token: refresh,
      access_token: tokens.access_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    } satisfies GoogleSecrets);
    await audit(admin, user.id, "connection.google.connected", { email, scopes: granted });
    return back(`connected=google&sync=${connection.id}`);
  } catch (e) {
    console.error("Google OAuth callback failed", e instanceof Error ? e.message : e);
    return back("error=google_exchange");
  }
}
