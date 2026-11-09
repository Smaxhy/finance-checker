import { describe, expect, it } from "vitest";
import { accountTypeFrom, mapEbTransaction, pickBalance, sessionAccounts } from "./enablebanking";

describe("Enable Banking mapping", () => {
  it("maps a booked card payment (debit) to a negative amount with the creditor as counterparty", () => {
    const m = mapEbTransaction(
      {
        entry_reference: "2026110812345",
        transaction_amount: { currency: "EUR", amount: "54.20" },
        creditor: { name: "COLRUYT LEUVEN" },
        credit_debit_indicator: "DBIT",
        status: "BOOK",
        booking_date: "2026-11-08",
        value_date: "2026-11-08",
        remittance_information: ["BETALING MET DEBETKAART", "COLRUYT LEUVEN 08/11"],
        merchant_category_code: "5411",
      },
      "acc-1",
    );
    expect(m).toMatchObject({ externalId: "acc-1:2026110812345", amount: -54.2, counterpartyName: "COLRUYT LEUVEN", mcc: "5411", bookedAt: "2026-11-08" });
    expect(m?.description).toContain("COLRUYT");
  });

  it("maps an incoming transfer (credit) with the debtor IBAN", () => {
    const m = mapEbTransaction(
      {
        transaction_amount: { currency: "EUR", amount: "3450.00" },
        debtor: { name: "ACME Belgium NV" },
        debtor_account: { iban: "BE12 0012 3456 7890" },
        credit_debit_indicator: "CRDT",
        status: "BOOK",
        booking_date: "2026-10-25",
        remittance_information: ["Loon oktober"],
      },
      "acc-1",
    );
    expect(m).toMatchObject({ amount: 3450, counterpartyIban: "BE12001234567890" });
    // Without a bank reference the id is a stable content hash.
    expect(m?.externalId).toMatch(/^acc-1:[0-9a-f]{32}$/);
  });

  it("skips pending transactions", () => {
    expect(mapEbTransaction({ transaction_amount: { currency: "EUR", amount: "1" }, credit_debit_indicator: "DBIT", status: "PDNG", booking_date: "2026-11-09" }, "a")).toBeNull();
  });

  it("prefers the available balance and normalises session accounts", () => {
    const b = pickBalance([
      { balance_amount: { currency: "EUR", amount: "100" }, balance_type: "CLBD" },
      { balance_amount: { currency: "EUR", amount: "90" }, balance_type: "ITAV" },
    ]);
    expect(b?.balance_amount.amount).toBe("90");
    expect(sessionAccounts({ session_id: "s", accounts: ["u1"], accounts_data: [{ uid: "u1", name: "Zicht" }] })[0].name).toBe("Zicht");
    expect(sessionAccounts({ session_id: "s", accounts: [{ uid: "u2" }] })[0].uid).toBe("u2");
    expect(accountTypeFrom({ uid: "x", cash_account_type: "SVGS" })).toBe("savings");
  });
});

describe("Enable Banking JWT", () => {
  it("signs an RS256 JWT with kid = application id that verifies with the public key", async () => {
    const { generateKeyPairSync, createVerify } = await import("node:crypto");
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.stubEnv("ENABLE_BANKING_APP_ID", "11111111-2222-3333-4444-555555555555");
    vi.stubEnv("ENABLE_BANKING_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n"));
    const { signJwt } = await import("./enablebanking");
    const [h, p, sig] = signJwt().split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: "11111111-2222-3333-4444-555555555555" });
    expect(payload).toMatchObject({ iss: "enablebanking.com", aud: "api.enablebanking.com" });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    vi.unstubAllEnvs();
  });
});
