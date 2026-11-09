import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/supabase/server";
import { env, integrationStatus } from "@/lib/env";
import { listAspsps, type Aspsp } from "@/lib/integrations/enablebanking";

let cache: { at: number; country: string; list: Aspsp[] } | null = null;

/** Banks available for the configured country (cached for an hour). */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!integrationStatus().enableBanking.configured) return NextResponse.json({ error: "setup_required" }, { status: 503 });
  const country = (request.nextUrl.searchParams.get("country") ?? env.enableBanking.country).toUpperCase().slice(0, 2);
  try {
    if (!cache || cache.country !== country || Date.now() - cache.at > 3600_000) cache = { at: Date.now(), country, list: await listAspsps(country) };
    return NextResponse.json({ banks: cache.list.map((b) => ({ name: b.name, country: b.country, logo: b.logo ?? null })) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not load banks" }, { status: 502 });
  }
}
