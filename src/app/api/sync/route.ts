import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listConnections } from "@/lib/integrations/connections";
import { syncConnection } from "@/lib/sync";
import { runPipeline } from "@/lib/engines/pipeline";

export const maxDuration = 300;

const body = z.object({ connectionId: z.uuid().optional(), full: z.boolean().optional() });

/** Sync one connection, or every active connection of the signed-in user. */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const admin = createAdminClient();
  const ids = parsed.data.connectionId
    ? [parsed.data.connectionId]
    : (await listConnections(admin, user.id)).filter((c) => c.status !== "revoked").map((c) => c.id);
  const results = [];
  for (const id of ids) {
    results.push(await syncConnection(admin, user.id, id, { full: parsed.data.full, skipPipeline: true }));
  }
  const pipeline = await runPipeline(admin, user.id);
  return NextResponse.json({ results, pipeline });
}
