import "server-only";
import { createHash, createSign } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Enable Banking - a licensed PSD2 account-information provider covering
 * Belgian banks (KBC/CBC, BNP Paribas Fortis, Belfius, ING, Argenta, Crelan,
 * AXA, Beobank, …). Read-only: the app only ever requests account
 * information (balances + transactions); it cannot initiate payments.
 *
 * Auth: every API call carries a short-lived RS256 JWT signed with the
 * application's private key (kid = application id).
 */

export interface Aspsp {
  name: string;
  country: string;
  logo?: string;
  psu_types?: string[];
  maximum_consent_validity?: number; // seconds
}

export interface EbAccount {
  uid: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  details?: string;
  product?: string;
  currency?: string;
  cash_account_type?: string;
}

export interface EbSession {
  session_id: string;
  accounts: (EbAccount | string)[];
  accounts_data?: EbAccount[];
  aspsp?: { name: string; country: string };
  access?: { valid_until?: string };
  status?: string;
}

export interface EbBalance {
  name?: string;
  balance_amount: { currency: string; amount: string };
  balance_type: string;
  reference_date?: string;
}

export interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  merchant_category_code?: string | null;
  transaction_amount: { currency: string; amount: string };
  creditor?: { name?: string | null } | null;
  creditor_account?: { iban?: string | null } | null;
  debtor?: { name?: string | null } | null;
  debtor_account?: { iban?: string | null } | null;
  credit_debit_indicator: "CRDT" | "DBIT";
  status?: string; // BOOK | PDNG | ...
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  note?: string | null;
}

export class EnableBankingError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function signJwt(): string {
  const { applicationId, privateKey } = env.enableBanking;
  if (!applicationId || !privateKey) throw new Error("Enable Banking is not configured");
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const header = b64({ typ: "JWT", alg: "RS256", kid: applicationId });
  const payload = b64({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 });
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function ebFetch<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const url = new URL(path, env.enableBanking.apiOrigin);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${signJwt()}`, "content-type": "application/json", accept: "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string; detail?: unknown; error?: string };
      detail = j.message ?? j.error ?? JSON.stringify(j.detail ?? j);
    } catch {
      detail = res.statusText;
    }
    throw new EnableBankingError(`Enable Banking ${res.status}: ${String(detail).slice(0, 300)}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function enableBankingRedirectUri() {
  return `${env.appUrl}/api/integrations/enablebanking/callback`;
}

export async function listAspsps(country = env.enableBanking.country): Promise<Aspsp[]> {
  const res = await ebFetch<{ aspsps: Aspsp[] }>("/aspsps", { query: { country, psu_type: "personal" } });
  return res.aspsps.filter((a) => !a.psu_types || a.psu_types.includes("personal"));
}

export async function startAuthorization(opts: { aspspName: string; country: string; state: string; validDays?: number }) {
  const validUntil = new Date(Date.now() + (opts.validDays ?? 180) * 86_400_000).toISOString();
  return ebFetch<{ url: string; authorization_id?: string }>("/auth", {
    method: "POST",
    body: {
      access: { valid_until: validUntil },
      aspsp: { name: opts.aspspName, country: opts.country },
      state: opts.state,
      redirect_url: enableBankingRedirectUri(),
      psu_type: "personal",
    },
  });
}

export async function createSession(code: string) {
  return ebFetch<EbSession>("/sessions", { method: "POST", body: { code } });
}

export async function getSession(sessionId: string) {
  return ebFetch<EbSession>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function deleteSession(sessionId: string) {
  return ebFetch<void>(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

export async function getAccountDetails(uid: string) {
  return ebFetch<EbAccount>(`/accounts/${encodeURIComponent(uid)}/details`);
}

export async function getBalances(uid: string) {
  return ebFetch<{ balances: EbBalance[] }>(`/accounts/${encodeURIComponent(uid)}/balances`);
}

export async function* iterateTransactions(uid: string, dateFrom: string, maxPages = 50): AsyncGenerator<EbTransaction[]> {
  let continuation: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await ebFetch<{ transactions: EbTransaction[]; continuation_key?: string | null }>(`/accounts/${encodeURIComponent(uid)}/transactions`, {
      query: { date_from: dateFrom, continuation_key: continuation },
    });
    yield res.transactions ?? [];
    if (!res.continuation_key) return;
    continuation = res.continuation_key;
  }
}

/** Normalises the two shapes the sessions endpoint can return for accounts. */
export function sessionAccounts(session: EbSession): EbAccount[] {
  const list = session.accounts ?? [];
  if (list.length && typeof list[0] === "string") {
    const data = session.accounts_data ?? [];
    return (list as string[]).map((uid) => data.find((a) => a.uid === uid) ?? { uid });
  }
  return list as EbAccount[];
}

const BALANCE_PREFERENCE = ["ITAV", "CLAV", "XPCD", "ITBD", "CLBD", "PRCD", "OPBD"];

export function pickBalance(balances: EbBalance[]): EbBalance | undefined {
  for (const t of BALANCE_PREFERENCE) {
    const b = balances.find((x) => x.balance_type === t);
    if (b) return b;
  }
  return balances[0];
}

export interface MappedBankTransaction {
  externalId: string;
  bookedAt: string;
  valueDate: string | null;
  amount: number;
  currency: string;
  description: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  mcc: string | null;
}

/** Maps an Enable Banking transaction; returns null for pending or unusable entries. */
export function mapEbTransaction(t: EbTransaction, accountUid: string): MappedBankTransaction | null {
  // Pending entries often get a new id once booked; importing only booked
  // transactions avoids duplicates.
  if (t.status && t.status !== "BOOK") return null;
  const bookedAt = (t.booking_date ?? t.value_date ?? t.transaction_date ?? "").slice(0, 10);
  const raw = Number(t.transaction_amount?.amount);
  if (!bookedAt || !Number.isFinite(raw)) return null;
  const amount = t.credit_debit_indicator === "DBIT" ? -Math.abs(raw) : Math.abs(raw);
  const outgoing = amount < 0;
  const counterpartyName = (outgoing ? t.creditor?.name : t.debtor?.name) ?? null;
  const counterpartyIban = (outgoing ? t.creditor_account?.iban : t.debtor_account?.iban) ?? null;
  const description = [...(t.remittance_information ?? []), t.note ?? ""].map((s) => s.trim()).filter(Boolean).join(" ") || counterpartyName || "Bank transaction";
  const stable = t.entry_reference || t.transaction_id;
  const externalId = stable
    ? `${accountUid}:${stable}`
    : `${accountUid}:${createHash("sha256").update([bookedAt, amount.toFixed(2), description, counterpartyName ?? "", counterpartyIban ?? ""].join("|")).digest("hex").slice(0, 32)}`;
  return {
    externalId,
    bookedAt,
    valueDate: t.value_date?.slice(0, 10) ?? null,
    amount,
    currency: t.transaction_amount.currency ?? "EUR",
    description: description.slice(0, 500),
    counterpartyName,
    counterpartyIban: counterpartyIban?.replace(/\s+/g, "") || null,
    mcc: t.merchant_category_code ?? null,
  };
}

export function accountTypeFrom(a: EbAccount): "checking" | "savings" | "credit_card" | "other" {
  const t = (a.cash_account_type ?? "").toUpperCase();
  if (t === "SVGS") return "savings";
  if (t === "CARD") return "credit_card";
  if (t === "CACC" || t === "TRAN" || t === "CASH") return "checking";
  return /spaar|[ée]pargne|saving/i.test(`${a.name ?? ""} ${a.product ?? ""}`) ? "savings" : "checking";
}
