import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "@/lib/types";

// ---- Gmail API fixtures --------------------------------------------------------
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const hdrs = (from: string, subject: string) => [
  { name: "From", value: from },
  { name: "Subject", value: subject },
  { name: "Date", value: "Mon, 9 Nov 2026 08:00:00 +0100" },
];
const MESSAGES: Record<string, { labelIds: string[]; snippet: string; from: string; subject: string; html?: string; text?: string }> = {
  m1: {
    labelIds: ["INBOX", "CATEGORY_UPDATES"],
    snippet: "Charleroi (CRL) &rarr; Lisbon (LIS) &middot; 2 passengers",
    from: "Ryanair <itinerary@ryanair.com>",
    subject: "Your Ryanair booking confirmation FR8KQ2",
    html: "<p>Reservation number: FR8KQ2</p><p>Flight FR 8341</p><p>Brussels South Charleroi (CRL) → Lisbon (LIS)</p><p>Departure: 27 November 2026 at 07:05</p><p>Total paid: &euro;129.98</p>",
  },
  m2: { labelIds: ["INBOX"], snippet: "Limited time offer", from: "Spotify <no-reply@spotify.com>", subject: "Start your free trial of Premium - 50% off" },
  m3: {
    labelIds: ["INBOX", "CATEGORY_UPDATES"],
    snippet: "Je bestelling wordt morgen geleverd.",
    from: "bol.com <klantenservice@bol.com>",
    subject: "Bedankt voor je bestelling 4012-338-912",
    text: "Bedankt voor je bestelling!\nUSB-C hub € 29,99\nNotitieboek A5 € 12,99\nTotaal € 42,98\nBetaald met Bancontact.\n".repeat(2),
  },
  m4: { labelIds: ["INBOX", "CATEGORY_PERSONAL"], snippet: "Zin om iets te drinken?", from: "Lotte <lotte@example.com>", subject: "Drinks zaterdag?" },
};

const requested: string[] = [];
vi.mock("@/lib/integrations/google/oauth", () => ({ getGoogleAccessToken: vi.fn(async () => "access-token") }));
vi.mock("@/lib/integrations/google/http", () => ({
  GoogleAuthError: class GoogleAuthError extends Error {},
  googleFetch: vi.fn(async (_token: string, url: string) => {
    requested.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) {
      return { messages: ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ id, threadId: `t-${id}` })), resultSizeEstimate: 5 };
    }
    const id = decodeURIComponent(u.pathname.split("/").pop()!);
    const m = MESSAGES[id];
    if (!m) throw new Error(`unexpected message ${id}`);
    const base = { id, threadId: `t-${id}`, labelIds: m.labelIds, snippet: m.snippet, internalDate: String(Date.parse("2026-11-09T07:00:00Z")) };
    if (u.searchParams.get("format") === "metadata") return { ...base, payload: { headers: hdrs(m.from, m.subject) } };
    return {
      ...base,
      payload: {
        mimeType: "multipart/alternative",
        headers: hdrs(m.from, m.subject),
        parts: [
          ...(m.text ? [{ mimeType: "text/plain", body: { data: b64(m.text) } }] : []),
          ...(m.html ? [{ mimeType: "text/html", body: { data: b64(m.html) } }] : []),
        ],
      },
    };
  }),
}));
vi.mock("@/lib/ai/client", () => ({ getAnthropic: () => null, FALLBACK_BETA: "server-side-fallback-2026-07-01", AI_EXTRACTION_MODEL: "claude-opus-5-5", AI_MODEL: "claude-opus-5-5" }));

// ---- Recording fake of the service-role Supabase client ---------------------------
interface Call {
  table: string;
  op: "select" | "upsert" | "update";
  payload?: unknown;
  opts?: unknown;
  filters: [string, string, unknown][];
}
const calls: Call[] = [];
function fakeAdmin() {
  return {
    from(table: string) {
      const q: Call = { table, op: "select", filters: [] };
      const result = () => {
        if (table === "emails" && q.op === "select") return { data: [{ external_id: "m5" }], error: null };
        if (table === "emails" && q.op === "upsert") return { data: (q.payload as { external_id: string }[]).map((r, i) => ({ id: `email-${i}`, external_id: r.external_id })), error: null };
        if (table === "profiles") return { data: { ai_email_extraction_enabled: false }, error: null };
        if (table === "connections" && q.op === "select") return { data: { sync_state: { calendar: { syncToken: "keep-me" } } }, error: null };
        return { data: null, error: null };
      };
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => (q.filters.push(["eq", k, v]), b),
        in: (k: string, v: unknown) => (q.filters.push(["in", k, v]), b),
        maybeSingle: () => b,
        upsert: (rows: unknown, opts: unknown) => ((q.op = "upsert"), (q.payload = rows), (q.opts = opts), b),
        update: (patch: unknown) => ((q.op = "update"), (q.payload = patch), b),
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          calls.push(q);
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return b;
    },
  };
}

const connection: Connection = {
  id: "conn-1",
  user_id: "user-1",
  provider: "google",
  label: "alex@example.com",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  status: "active",
  consent_expires_at: null,
  last_synced_at: null,
  last_error: null,
  sync_state: { calendar: { syncToken: "keep-me" } },
  metadata: {},
  created_at: new Date().toISOString(),
};

describe("syncGmail", () => {
  beforeEach(() => {
    calls.length = 0;
    requested.length = 0;
  });

  it("prefilters, extracts and stores only structured metadata", async () => {
    const { syncGmail } = await import("@/lib/sync/gmail");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats = await syncGmail({ admin: fakeAdmin() as any, userId: "user-1", connection: { ...connection } });

    expect(stats).toMatchObject({ scanned: 5, alreadyKnown: 1, fetched: 2, stored: 2, events: 1, aiExtracted: 0, complete: true });

    // Read-only: only GETs against the messages collection, full bodies only for relevant mail.
    expect(requested.every((u) => u.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages"))).toBe(true);
    const full = requested.filter((u) => u.includes("format=full")).map((u) => new URL(u).pathname.split("/").pop());
    expect(full.sort()).toEqual(["m1", "m3"]);
    expect(requested.some((u) => u.includes("/m5"))).toBe(false); // already stored → not refetched

    const emailUpsert = calls.find((c) => c.table === "emails" && c.op === "upsert")!;
    expect(emailUpsert.opts).toEqual({ onConflict: "user_id,provider,external_id" });
    const rows = emailUpsert.payload as Record<string, unknown>[];
    const ryanair = rows.find((r) => r.external_id === "m1")!;
    expect(ryanair).toMatchObject({
      user_id: "user-1",
      provider: "gmail",
      category: "travel",
      merchant_key: "ryanair",
      amount: 129.98,
      order_number: "FR8KQ2",
      snippet: "Charleroi (CRL) → Lisbon (LIS) · 2 passengers",
      connection_id: "conn-1",
      // Opens in the right Google account when several are signed in.
      web_link: "https://mail.google.com/mail/?authuser=alex%40example.com#all/m1",
      extraction_method: "rules",
    });
    for (const r of rows) {
      expect(Object.keys(r)).not.toContain("body");
      expect(JSON.stringify(r)).not.toContain("USB-C hub € 29,99\nNotitieboek"); // no raw body text stored
    }
    expect(rows.find((r) => r.external_id === "m3")).toMatchObject({ category: "order", merchant_key: "bol", amount: 42.98 });

    const eventUpsert = calls.find((c) => c.table === "events" && c.op === "upsert")!;
    expect((eventUpsert.payload as Record<string, unknown>[])[0]).toMatchObject({
      user_id: "user-1",
      source: "email",
      external_id: "m1",
      email_id: "email-0",
      kind: "flight",
      starts_at: "2026-11-27T06:05:00.000Z",
      title: "Flight FR 8341 CRL → LIS",
    });

    // Every query is scoped to the user.
    for (const c of calls.filter((c) => c.op !== "upsert" && c.table !== "profiles")) {
      expect(c.filters.some(([, k, v]) => k === "user_id" && v === "user-1")).toBe(true);
    }

    // Cursor saved under sync_state.gmail without clobbering other services.
    const conn = calls.find((c) => c.table === "connections" && c.op === "update")!;
    const state = (conn.payload as { sync_state: Record<string, unknown> }).sync_state;
    expect(state.calendar).toEqual({ syncToken: "keep-me" });
    expect(state.gmail).toMatchObject({ backfillDone: true, lastInternalDate: Date.parse("2026-11-09T07:00:00Z") });
  });
});
