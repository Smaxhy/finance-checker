import { describe, expect, it } from "vitest";
import { inferEventKind } from "./kind";
import { addMonthsKey, dayKeyInTz, monthGridKeys, startOfWeekKey, timeInTz, weekKeys, zonedToUtc } from "./time";
import { projectChargeDates } from "./projection";
import { mapGoogleEvent, runCalendarSync, type CalendarStore, type GoogleEventRow } from "./google-sync";
import { syncCalendarFixtures } from "./fixtures";

describe("inferEventKind", () => {
  it.each([
    ["Flight FR 8341 Charleroi → Lisbon", "flight"],
    ["Vlucht naar Barcelona", "flight"],
    ["Casa do Bairro (3 nights)", "hotel"],
    ["Check-in Hotel Ibis Gent", "hotel"],
    ["Dinner at Restaurant Zarza", "restaurant"],
    ["Dîner chez Claire", "restaurant"],
    ["Dentist - check-up", "appointment"],
    ["Afspraak huisarts", "appointment"],
    ["Rendez-vous coiffeur", "appointment"],
    ["Quarterly review with Sarah", "meeting"],
    ["Weekly planning", "meeting"],
    ["Réunion d'équipe", "meeting"],
    ["Concert - Ancienne Belgique", "ticket"],
    ["bol.com delivery (bpost)", "delivery"],
    ["Levering IKEA", "delivery"],
    ["Huur betalen", "payment"],
    ["Trein naar Gent", "travel"],
    ["Lotte's birthday drinks", "personal"],
    ["Gym - Basic-Fit", "personal"],
    ["Call mum", "meeting"],
    ["Read a book", "other"],
  ])("%s → %s", (title, kind) => {
    expect(inferEventKind(title)).toBe(kind);
  });

  it("uses the location and, for clear cases, the description", () => {
    expect(inferEventKind("Sync", "https://meet.google.com/abc-defg-hij")).toBe("meeting");
    expect(inferEventKind("Lisbon", null, "Your flight SN 3815 departs from gate A42")).toBe("flight");
    expect(inferEventKind("Saturday", null, "Bring the concert tickets")).toBe("other");
  });
});

describe("time helpers (Europe/Brussels)", () => {
  it("converts wall-clock times across DST", () => {
    expect(zonedToUtc("2026-07-01", "09:00").toISOString()).toBe("2026-07-01T07:00:00.000Z"); // CEST, UTC+2
    expect(zonedToUtc("2026-12-01", "09:00").toISOString()).toBe("2026-12-01T08:00:00.000Z"); // CET, UTC+1
    expect(zonedToUtc("2026-03-29", "03:30").toISOString()).toBe("2026-03-29T01:30:00.000Z"); // just after spring-forward
  });

  it("puts late-evening UTC instants on the right Brussels day", () => {
    expect(dayKeyInTz("2026-11-09T23:30:00Z")).toBe("2026-11-10");
    expect(timeInTz("2026-11-09T23:30:00Z")).toBe("00:30");
    expect(dayKeyInTz("2026-11-10")).toBe("2026-11-10");
  });

  it("builds Monday-first grids", () => {
    expect(startOfWeekKey("2026-11-15")).toBe("2026-11-09"); // Sunday → Monday
    expect(weekKeys("2026-11-11")[0]).toBe("2026-11-09");
    const grid = monthGridKeys("2026-11");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-10-26");
    expect(grid).toContain("2026-11-30");
  });

  it("clamps month arithmetic to the last day", () => {
    expect(addMonthsKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsKey("2026-01-31", 2)).toBe("2026-03-31");
  });
});

describe("projectChargeDates", () => {
  it("projects every monthly charge inside the window without drifting", () => {
    expect(projectChargeDates("2026-11-30", "monthly", "2026-11-09", "2027-03-31")).toEqual(["2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28", "2027-03-30"]);
  });
  it("handles weekly, yearly and unknown cycles", () => {
    expect(projectChargeDates("2026-11-10", "weekly", "2026-11-09", "2026-11-30")).toEqual(["2026-11-10", "2026-11-17", "2026-11-24"]);
    expect(projectChargeDates("2026-12-03", "yearly", "2026-11-01", "2027-06-01")).toEqual(["2026-12-03"]);
    expect(projectChargeDates("2026-12-03", "unknown", "2026-11-01", "2027-06-01")).toEqual(["2026-12-03"]);
    expect(projectChargeDates(null, "monthly", "2026-11-01", "2027-06-01")).toEqual([]);
  });
  it("skips occurrences before the window", () => {
    expect(projectChargeDates("2026-10-05", "monthly", "2026-11-09", "2026-12-31")).toEqual(["2026-12-05"]);
  });
});

describe("mapGoogleEvent", () => {
  const cal = { id: "alex@example.com", summary: "alex@example.com", summaryOverride: "Personal", primary: true };
  it("maps timed events", () => {
    const row = mapGoogleEvent(
      { id: "e1", summary: "Dentist", location: "Leuven", start: { dateTime: "2026-11-13T09:15:00+01:00" }, end: { dateTime: "2026-11-13T09:45:00+01:00" }, htmlLink: "https://www.google.com/calendar/event?eid=abc" },
      cal,
      "user-1",
      "Europe/Brussels",
    )!;
    expect(row).toMatchObject({
      user_id: "user-1",
      source: "google",
      external_id: "alex@example.com:e1",
      starts_at: "2026-11-13T08:15:00.000Z",
      ends_at: "2026-11-13T08:45:00.000Z",
      all_day: false,
      kind: "appointment",
      calendar_name: "Personal",
      status: "confirmed",
    });
  });
  it("maps all-day events at local midnight with exclusive end", () => {
    const row = mapGoogleEvent({ id: "e2", summary: "Holiday in Lisbon", start: { date: "2026-11-27" }, end: { date: "2026-11-30" } }, cal, "u", "Europe/Brussels")!;
    expect(row.all_day).toBe(true);
    expect(row.starts_at).toBe("2026-11-26T23:00:00.000Z");
    expect(row.ends_at).toBe("2026-11-29T23:00:00.000Z");
  });
  it("drops noise and unsafe links", () => {
    expect(mapGoogleEvent({ id: "w", eventType: "workingLocation", start: { date: "2026-11-10" } }, cal, "u", "Europe/Brussels")).toBeNull();
    const row = mapGoogleEvent({ id: "x", summary: "<b>Thing</b>", description: "<p>Hi&nbsp;there</p>", start: { date: "2026-11-10" }, htmlLink: "https://evil.example/x" }, cal, "u", "Europe/Brussels")!;
    expect(row.html_link).toBeNull();
    expect(row.description).toBe("Hi there");
  });
});

describe("runCalendarSync", () => {
  it("fetches visible calendars with pagination, upserts rows and removes events deleted upstream", async () => {
    const { fetchJson, urls } = syncCalendarFixtures();
    const db = new Map<string, { id: string; row: GoogleEventRow }>([
      ["alex@example.com:gone", { id: "row-gone", row: { external_id: "alex@example.com:gone" } as GoogleEventRow }],
      ["hidden-cal:old", { id: "row-hidden", row: { external_id: "hidden-cal:old" } as GoogleEventRow }],
      ["alex@example.com:e1", { id: "row-e1", row: { external_id: "alex@example.com:e1" } as GoogleEventRow }],
    ]);
    const store: CalendarStore = {
      async listExisting() {
        return [...db.values()].map((v) => ({ id: v.id, external_id: v.row.external_id }));
      },
      async upsert(rows) {
        for (const r of rows) db.set(r.external_id, { id: db.get(r.external_id)?.id ?? `new-${r.external_id}`, row: r });
      },
      async deleteIds(ids) {
        for (const [k, v] of db) if (ids.includes(v.id)) db.delete(k);
      },
    };

    const stats = await runCalendarSync({ fetchJson, store, userId: "user-1", tz: "Europe/Brussels", now: new Date("2026-11-09T10:00:00Z") });

    expect(stats).toEqual({ calendars: 2, fetched: 5, upserted: 4, removed: 2, skipped: 1 });
    expect([...db.keys()].sort()).toEqual(["alex@example.com:e1", "alex@example.com:e2", "alex@example.com:e3", "work@group.calendar.google.com:w1"]);
    expect(db.get("alex@example.com:e1")!.id).toBe("row-e1"); // existing row kept its id
    expect(db.get("alex@example.com:e3")!.row.status).toBe("cancelled");
    expect(db.get("work@group.calendar.google.com:w1")!.row).toMatchObject({ calendar_name: "Work", kind: "meeting", user_id: "user-1" });
    // Hidden / unselected calendars are never queried; window bounds are passed through.
    expect(urls.some((u) => u.includes("hidden-cal"))).toBe(false);
    expect(urls.filter((u) => u.includes("/events?")).every((u) => u.includes("singleEvents=true") && u.includes("timeMin=2026-10-10T10%3A00%3A00.000Z"))).toBe(true);
    expect(urls.some((u) => u.includes("pageToken=page-2"))).toBe(true);
  });

  it("with several Google accounts, cleans up only this account's calendars", async () => {
    const { fetchJson } = syncCalendarFixtures();
    const db = new Map<string, string>([
      ["alex@example.com:gone", "row-gone"], // deleted upstream in this account
      ["old-shared@group.calendar.google.com:x1", "row-unsubscribed"], // a calendar this account showed last time and no longer does
      ["sam@example.com:s1", "row-other-account"], // belongs to the second connected account
    ]);
    const store: CalendarStore = {
      async listExisting() {
        return [...db].map(([external_id, id]) => ({ id, external_id }));
      },
      async upsert(rows) {
        for (const r of rows) db.set(r.external_id, db.get(r.external_id) ?? `new-${r.external_id}`);
      },
      async deleteIds(ids) {
        for (const [k, v] of db) if (ids.includes(v)) db.delete(k);
      },
    };
    let seen: string[] = [];
    const stats = await runCalendarSync({
      fetchJson,
      store,
      userId: "user-1",
      tz: "Europe/Brussels",
      now: new Date("2026-11-09T10:00:00Z"),
      ownCalendarIds: ["alex@example.com", "old-shared@group.calendar.google.com"],
      onCalendars: (ids) => (seen = ids),
    });
    expect(stats.removed).toBe(2);
    expect(db.has("sam@example.com:s1")).toBe(true); // the other account's event survives
    expect(db.has("alex@example.com:gone")).toBe(false);
    expect(db.has("old-shared@group.calendar.google.com:x1")).toBe(false);
    expect(seen).toEqual(["alex@example.com", "work@group.calendar.google.com"]);
  });
});
