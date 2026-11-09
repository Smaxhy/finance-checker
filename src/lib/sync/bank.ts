import "server-only";
import type { SyncContext, SyncStats } from "./types";
import { readSecrets, updateConnection } from "@/lib/integrations/connections";
import { EnableBankingError, getBalances, iterateTransactions, mapEbTransaction, pickBalance } from "@/lib/integrations/enablebanking";
import { classifyTransaction, type CategoryRule } from "@/lib/finance/categorize";
import { hashIdentifier } from "@/lib/crypto";
import { maskIban } from "@/lib/format";
import { addDays, toISODate } from "@/lib/dates";

export interface BankSecrets {
  session_id: string;
}

/**
 * Pulls balances and booked transactions for every account in a PSD2
 * session. Uses the service-role client, so every query is scoped to
 * ctx.userId explicitly.
 */
export async function syncBank(ctx: SyncContext): Promise<SyncStats> {
  const { admin, userId, connection } = ctx;
  if (connection.consent_expires_at && Date.parse(connection.consent_expires_at) < Date.now()) {
    await updateConnection(admin, connection.id, userId, { status: "expired", last_error: "Bank consent expired. PSD2 requires you to re-authorise access (at most every 180 days)." });
    throw new Error("Bank consent expired - reconnect to continue syncing");
  }
  const secrets = await readSecrets<BankSecrets>(admin, connection.id, userId);
  if (!secrets?.session_id) throw new Error("No bank session stored - reconnect the bank");

  const [{ data: accounts }, { data: ruleRows }, { data: allAccounts }] = await Promise.all([
    admin.from("accounts").select("id, external_id, iban_hash").eq("user_id", userId).eq("connection_id", connection.id),
    admin.from("category_rules").select("pattern, category_id").eq("user_id", userId),
    admin.from("accounts").select("iban_hash").eq("user_id", userId),
  ]);
  const rules = (ruleRows ?? []) as CategoryRule[];
  const ownIbanHashes = new Set(((allAccounts ?? []) as { iban_hash: string | null }[]).map((a) => a.iban_hash).filter((h): h is string => Boolean(h)));
  const stats = { accounts: 0, balances: 0, fetched: 0, stored: 0, skippedPending: 0 };

  const lastSync = connection.last_synced_at ? new Date(connection.last_synced_at) : null;
  const firstSync = !lastSync || ctx.full;

  for (const account of (accounts ?? []) as { id: string; external_id: string }[]) {
    stats.accounts++;
    try {
      const { balances } = await getBalances(account.external_id);
      const b = pickBalance(balances ?? []);
      if (b) {
        await admin
          .from("accounts")
          .update({ balance: Number(b.balance_amount.amount), currency: b.balance_amount.currency, balance_updated_at: new Date().toISOString() })
          .eq("id", account.id)
          .eq("user_id", userId);
        stats.balances++;
      }
    } catch (e) {
      // Some banks limit balance calls per day (PSD2 "4 per day" rule without the user present).
      if (!(e instanceof EnableBankingError && e.status === 429)) throw e;
    }

    // Backfill up to a year on first sync (banks may only return 90 days), then overlap 10 days.
    const dateFrom = toISODate(firstSync ? addDays(new Date(), -365) : addDays(lastSync!, -10));
    const rows = [];
    for await (const page of iterateTransactions(account.external_id, dateFrom)) {
      for (const t of page) {
        stats.fetched++;
        const m = mapEbTransaction(t, account.external_id);
        if (!m) {
          stats.skippedPending++;
          continue;
        }
        const cpHash = m.counterpartyIban ? hashIdentifier(m.counterpartyIban) : null;
        const c = classifyTransaction({ amount: m.amount, description: m.description, counterpartyName: m.counterpartyName, counterpartyIbanHash: cpHash, mcc: m.mcc }, { rules, ownIbanHashes });
        rows.push({
          user_id: userId,
          account_id: account.id,
          source: "bank",
          external_id: m.externalId,
          booked_at: m.bookedAt,
          value_date: m.valueDate,
          amount: m.amount,
          currency: m.currency,
          description: m.description,
          merchant: c.merchant,
          merchant_key: c.merchantKey,
          counterparty_name: m.counterpartyName,
          counterparty_iban_masked: maskIban(m.counterpartyIban),
          counterparty_iban_hash: cpHash,
          mcc: m.mcc,
          kind: c.kind,
          category_id: c.categoryId,
          category_source: c.categorySource,
        });
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      // ignoreDuplicates: never overwrite categories/notes the user edited.
      const { data, error } = await admin.from("transactions").upsert(rows.slice(i, i + 500), { onConflict: "user_id,source,external_id", ignoreDuplicates: true }).select("id");
      if (error) throw new Error(`Saving bank transactions failed: ${error.message}`);
      stats.stored += data?.length ?? 0;
    }
  }
  return stats;
}
