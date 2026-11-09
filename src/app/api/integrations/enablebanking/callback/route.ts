import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, upsertConnection, writeSecrets } from "@/lib/integrations/connections";
import { accountTypeFrom, createSession, getAccountDetails, sessionAccounts } from "@/lib/integrations/enablebanking";
import { hashIdentifier } from "@/lib/crypto";
import { maskIban } from "@/lib/format";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(request: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/settings/accounts?${q}`, request.url));
    res.cookies.delete({ name: "eb_oauth", path: "/api/integrations/enablebanking" });
    return res;
  };
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("error=bank_denied");

  let saved: { state: string; uid: string; aspsp: string; country: string } | null = null;
  try {
    saved = JSON.parse(request.cookies.get("eb_oauth")?.value ?? "null");
  } catch {
    saved = null;
  }
  const code = params.get("code");
  if (!saved || !code || !safeEqual(saved.state, params.get("state") ?? "") || saved.uid !== user.id) return back("error=bank_state");

  try {
    const session = await createSession(code);
    const admin = createAdminClient();
    const connection = await upsertConnection(admin, {
      userId: user.id,
      provider: "enable_banking",
      label: session.aspsp?.name ?? saved.aspsp,
      scopes: ["accounts", "balances", "transactions"],
      consentExpiresAt: session.access?.valid_until ?? null,
      metadata: { country: session.aspsp?.country ?? saved.country },
    });
    await writeSecrets(admin, connection.id, user.id, { session_id: session.session_id });

    for (const acc of sessionAccounts(session)) {
      let details = acc;
      if (!acc.account_id && !acc.name) details = { ...acc, ...(await getAccountDetails(acc.uid).catch(() => ({}))) };
      const iban = details.account_id?.iban?.replace(/\s+/g, "") ?? null;
      await admin.from("accounts").upsert(
        {
          user_id: user.id,
          connection_id: connection.id,
          source: "bank",
          external_id: acc.uid,
          name: details.name || details.product || "Account",
          institution: connection.label,
          iban_masked: maskIban(iban),
          iban_hash: iban ? hashIdentifier(iban) : null,
          currency: details.currency ?? "EUR",
          type: accountTypeFrom(details),
        },
        { onConflict: "user_id,source,external_id" },
      );
    }
    await audit(admin, user.id, "connection.bank.connected", { bank: connection.label, accounts: sessionAccounts(session).length });
    return back(`connected=bank&sync=${connection.id}`);
  } catch (e) {
    console.error("Enable Banking callback failed", e instanceof Error ? e.message : e);
    return back("error=bank_session");
  }
}
