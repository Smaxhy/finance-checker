/**
 * Google Calendar → `events` table synchronisation logic, written against
 * injected I/O (`fetchJson`, `store`) so it can be tested without network or
 * database. The production wiring lives in src/lib/sync/calendar.ts.
 */
import type { EventKind } from "@/lib/types";
import { listCalendarEvents, listVisibleCalendars, type FetchJson, type GCalCalendar, type GCalEvent } from "@/lib/integrations/google/calendar";
import { inferEventKind } from "./kind";
import { zonedToUtc } from "./time";

export interface GoogleEventRow {
  user_id: string;
  source: "google";
  external_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  kind: EventKind;
  status: "confirmed" | "tentative" | "cancelled";
  calendar_name: string | null;
  html_link: string | null;
  is_demo: false;
}

export interface CalendarStore {
  /** Existing google-sourced rows for this user whose start falls in the window. */
  listExisting(fromIso: string, toIso: string): Promise<{ id: string; external_id: string }[]>;
  upsert(rows: GoogleEventRow[]): Promise<void>;
  deleteIds(ids: string[]): Promise<void>;
}

export interface CalendarSyncStats {
  calendars: number;
  fetched: number;
  upserted: number;
  removed: number;
  skipped: number;
  [key: string]: number;
}

// Only ever link out to Google Calendar itself.
const SAFE_LINK = /^https:\/\/(?:www\.google\.com\/calendar\/|calendar\.google\.com\/)/;

// Event types that are noise in a personal agenda.
const SKIPPED_EVENT_TYPES = new Set(["workingLocation", "focusTime", "outOfOffice"]);

function clean(text: string | undefined, max: number): string | null {
  if (!text) return null;
  const t = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, max) : null;
}

export function mapGoogleEvent(ev: GCalEvent, calendar: Pick<GCalCalendar, "id" | "summary" | "summaryOverride" | "primary">, userId: string, tz: string): GoogleEventRow | null {
  if (!ev.id || !ev.start) return null;
  if (ev.eventType && SKIPPED_EVENT_TYPES.has(ev.eventType)) return null;
  const allDay = Boolean(ev.start.date && !ev.start.dateTime);
  let startsAt: string;
  let endsAt: string | null = null;
  if (allDay) {
    startsAt = zonedToUtc(ev.start.date!, "00:00", tz).toISOString();
    // Google's all-day end date is exclusive; keep it exclusive (midnight of the next day).
    if (ev.end?.date) endsAt = zonedToUtc(ev.end.date, "00:00", tz).toISOString();
  } else if (ev.start.dateTime) {
    startsAt = new Date(ev.start.dateTime).toISOString();
    if (ev.end?.dateTime) endsAt = new Date(ev.end.dateTime).toISOString();
  } else {
    return null;
  }
  const title = (ev.summary?.trim() || "(No title)").slice(0, 300);
  return {
    user_id: userId,
    source: "google",
    external_id: `${calendar.id}:${ev.id}`,
    title,
    description: clean(ev.description, 2000),
    location: clean(ev.location, 300),
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay,
    kind: inferEventKind(title, ev.location, ev.description),
    status: ev.status === "cancelled" ? "cancelled" : ev.status === "tentative" ? "tentative" : "confirmed",
    calendar_name: (calendar.summaryOverride ?? calendar.summary ?? (calendar.primary ? "Primary" : null))?.slice(0, 120) ?? null,
    html_link: ev.htmlLink && SAFE_LINK.test(ev.htmlLink) ? ev.htmlLink : null,
    is_demo: false,
  };
}

export async function runCalendarSync(opts: {
  fetchJson: FetchJson;
  store: CalendarStore;
  userId: string;
  tz: string;
  now?: Date;
  pastDays?: number;
  futureDays?: number;
}): Promise<CalendarSyncStats> {
  const now = opts.now ?? new Date();
  const timeMin = new Date(now.getTime() - (opts.pastDays ?? 30) * 86_400_000).toISOString();
  const timeMax = new Date(now.getTime() + (opts.futureDays ?? 180) * 86_400_000).toISOString();

  const calendars = await listVisibleCalendars(opts.fetchJson);
  const rows = new Map<string, GoogleEventRow>();
  let fetched = 0;
  let skipped = 0;
  for (const cal of calendars) {
    const events = await listCalendarEvents(opts.fetchJson, cal.id, timeMin, timeMax);
    fetched += events.length;
    for (const ev of events) {
      const row = mapGoogleEvent(ev, cal, opts.userId, opts.tz);
      if (row) rows.set(row.external_id, row);
      else skipped++;
    }
  }

  const upserts = [...rows.values()];
  for (let i = 0; i < upserts.length; i += 200) await opts.store.upsert(upserts.slice(i, i + 200));

  // Anything we stored earlier inside this window that Google no longer returns was deleted
  // (or its calendar was hidden) upstream.
  const existing = await opts.store.listExisting(timeMin, timeMax);
  const stale = existing.filter((e) => !rows.has(e.external_id)).map((e) => e.id);
  for (let i = 0; i < stale.length; i += 100) await opts.store.deleteIds(stale.slice(i, i + 100));

  return { calendars: calendars.length, fetched, upserted: upserts.length, removed: stale.length, skipped };
}
