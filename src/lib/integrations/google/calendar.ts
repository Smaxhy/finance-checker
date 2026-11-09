/**
 * Minimal, read-only Google Calendar API v3 client. The HTTP call is injected
 * (`fetchJson`) so the same code runs against googleFetch in production and
 * against fixtures in tests.
 */

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export type FetchJson = <T>(url: string) => Promise<T>;

export interface GCalCalendar {
  id: string;
  summary?: string;
  summaryOverride?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  accessRole?: string;
  timeZone?: string;
}

export interface GCalDateTime {
  date?: string; // all-day: YYYY-MM-DD
  dateTime?: string; // RFC3339 with offset
  timeZone?: string;
}

export interface GCalEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GCalDateTime;
  end?: GCalDateTime;
  eventType?: string;
}

interface ListResponse<T> {
  items?: T[];
  nextPageToken?: string;
}

/** Calendars the user shows in Google Calendar (selected or primary, not hidden). */
export async function listVisibleCalendars(fetchJson: FetchJson): Promise<GCalCalendar[]> {
  const out: GCalCalendar[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ minAccessRole: "reader", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetchJson<ListResponse<GCalCalendar>>(`${CALENDAR_API}/users/me/calendarList?${params}`);
    out.push(...(res.items ?? []));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out.filter((c) => !c.hidden && (c.selected || c.primary));
}

/** All event instances (recurring events expanded) in [timeMin, timeMax). */
export async function listCalendarEvents(fetchJson: FetchJson, calendarId: string, timeMin: string, timeMax: string, maxPages = 20): Promise<GCalEvent[]> {
  const out: GCalEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      timeMin,
      timeMax,
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetchJson<ListResponse<GCalEvent>>(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    out.push(...(res.items ?? []));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
