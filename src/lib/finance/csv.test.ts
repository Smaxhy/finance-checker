import { describe, expect, it } from "vitest";
import { analyseCsv, parseAmount, parseDate } from "./csv";

describe("parseAmount", () => {
  it("handles European and English formats", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("-12,50")).toBe(-12.5);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("€ 12,00")).toBe(12);
    expect(parseAmount("12.00-")).toBe(-12);
    expect(parseAmount("(45,10)")).toBe(-45.1);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses day-first European dates and ISO", () => {
    expect(parseDate("09/11/2026")).toBe("2026-11-09");
    expect(parseDate("9-11-26")).toBe("2026-11-09");
    expect(parseDate("09.11.2026")).toBe("2026-11-09");
    expect(parseDate("2026-11-09")).toBe("2026-11-09");
    expect(parseDate("31/02/2026")).toBeNull();
  });
});

describe("analyseCsv", () => {
  it("reads a Dutch semicolon export with a single signed amount column", () => {
    const csv = [
      "Rekeningnummer;Rubrieknaam;Naam;Munt;Afschriftnummer;Datum;Omschrijving;Valuta;Bedrag;Saldo;credit;debet;rekening tegenpartij;BIC tegenpartij;Naam tegenpartij;Adres tegenpartij;gestructureerde mededeling;Vrije mededeling",
      "BE68539007547034;;Alex;EUR;2026011;08/11/2026;BETALING MET DEBETKAART COLRUYT LEUVEN;08/11/2026;-54,20;2846,37;;54,20;;;;;;",
      "BE68539007547034;;Alex;EUR;2026011;25/10/2026;Loon oktober;25/10/2026;3.450,00;2900,57;3450,00;;BE12001234567890;GEBABEBB;ACME Belgium NV;;;Loon oktober",
    ].join("\n");
    const a = analyseCsv(csv);
    expect(a.delimiter).toBe(";");
    expect(a.rows).toHaveLength(2);
    expect(a.rows[0]).toMatchObject({ date: "2026-11-08", amount: -54.2, currency: "EUR" });
    expect(a.rows[1]).toMatchObject({ amount: 3450, counterparty: "ACME Belgium NV", counterpartyAccount: "BE12001234567890" });
  });

  it("reads a French export with separate debit/credit columns and preamble lines", () => {
    const csv = [
      "Compte;BE71 0961 2345 6769",
      "Période;01/10/2026 - 31/10/2026",
      "",
      "Date d'exécution;Date valeur;Débit;Crédit;Devise;Contrepartie;Nom de la contrepartie;Communication",
      "02/10/2026;02/10/2026;11,99;;EUR;;SPOTIFY;Spotify P2A9C1",
      "05/10/2026;05/10/2026;;45,60;EUR;BE45063987654321;Mutualité Chrétienne;Remboursement soins",
    ].join("\n");
    const a = analyseCsv(csv);
    expect(a.rows).toHaveLength(2);
    expect(a.rows[0]).toMatchObject({ date: "2026-10-02", amount: -11.99, counterparty: "SPOTIFY" });
    expect(a.rows[1]).toMatchObject({ amount: 45.6, description: "Remboursement soins" });
  });

  it("reads an English comma export and produces stable ids for duplicates", () => {
    const csv = ["Date,Description,Amount,Currency", "2026-11-01,Coffee,-3.50,EUR", "2026-11-01,Coffee,-3.50,EUR", "bad-date,Broken,-1,EUR"].join("\n");
    const a = analyseCsv(csv);
    expect(a.rows).toHaveLength(2);
    expect(a.rows[0].externalId).not.toBe(a.rows[1].externalId);
    expect(analyseCsv(csv).rows[0].externalId).toBe(a.rows[0].externalId);
    expect(a.errors).toHaveLength(1);
  });
});
