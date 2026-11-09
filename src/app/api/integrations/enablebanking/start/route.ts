import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { env, integrationStatus } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { startAuthorization } from "@/lib/integrations/enablebanking";

const query = z.object({ aspsp: z.string().min(1).max(120), country: z.string().regex(/^[A-Z]{2}$/).optional() });

/** Starts the PSD2 consent flow: the user is redirected to their bank to authorise read-only access. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (!integrationStatus().enableBanking.configured) return NextResponse.redirect(new URL("/settings/accounts?error=bank_not_configured", request.url));
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.redirect(new URL("/settings/accounts?error=bank_invalid", request.url));

  const country = parsed.data.country ?? env.enableBanking.country;
  const state = randomToken(24);
  try {
    const { url } = await startAuthorization({ aspspName: parsed.data.aspsp, country, state });
    const response = NextResponse.redirect(url);
    response.cookies.set("eb_oauth", JSON.stringify({ state, uid: user.id, aspsp: parsed.data.aspsp, country }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/enablebanking",
      maxAge: 900,
    });
    return response;
  } catch (e) {
    console.error("Enable Banking auth start failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/settings/accounts?error=bank_start", request.url));
  }
}
