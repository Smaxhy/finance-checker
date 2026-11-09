import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { integrationStatus } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { buildGoogleAuthUrl, createPkce, type GoogleService } from "@/lib/integrations/google/oauth";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!integrationStatus().google.configured) {
    return NextResponse.redirect(new URL("/settings/accounts?error=google_not_configured", request.url));
  }
  const requested = (request.nextUrl.searchParams.get("services") ?? "gmail,calendar").split(",");
  const services = requested.filter((s): s is GoogleService => s === "gmail" || s === "calendar");
  if (services.length === 0) return NextResponse.redirect(new URL("/settings/accounts", request.url));

  const state = randomToken(24);
  const { verifier, challenge } = createPkce();
  const response = NextResponse.redirect(buildGoogleAuthUrl({ state, challenge, services }));
  response.cookies.set("g_oauth", JSON.stringify({ state, verifier, uid: user.id }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/google",
    maxAge: 600,
  });
  return response;
}
