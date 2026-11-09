/**
 * Fixture responses shaped like the Google Calendar API v3, used by tests to
 * exercise the sync without network access.
 */
import type { FetchJson, GCalCalendar, GCalEvent } from "@/lib/integrations/google/calendar";

export function syncCalendarFixtures() {
  const urls: string[] = [];
  const calendars: GCalCalendar[] = [
    { id: "alex@example.com", summary: "alex@example.com", primary: true, accessRole: "owner" },
    { id: "work@group.calendar.google.com", summary: "Work", selected: true, accessRole: "reader" },
    { id: "hidden-cal", summary: "Holidays", selected: false, accessRole: "reader" },
  ];
  const personalPage1: GCalEvent[] = [
    { id: "e1", status: "confirmed", summary: "Dentist - check-up", start: { dateTime: "2026-11-13T09:15:00+01:00" }, end: { dateTime: "2026-11-13T09:45:00+01:00" } },
    { id: "e2", status: "tentative", summary: "Lisbon trip", start: { date: "2026-11-27" }, end: { date: "2026-11-30" } },
  ];
  const personalPage2: GCalEvent[] = [
    { id: "e3", status: "cancelled", summary: "Dinner at Zarza", start: { dateTime: "2026-11-11T19:30:00+01:00" }, end: { dateTime: "2026-11-11T22:00:00+01:00" } },
    { id: "loc", eventType: "workingLocation", summary: "Home", start: { date: "2026-11-10" }, end: { date: "2026-11-11" } },
  ];
  const work: GCalEvent[] = [
    { id: "w1", summary: "Quarterly review", location: "https://meet.google.com/abc", start: { dateTime: "2026-11-12T14:00:00+01:00" }, end: { dateTime: "2026-11-12T15:00:00+01:00" } },
  ];

  const fetchJson: FetchJson = async <T,>(url: string): Promise<T> => {
    urls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith("/users/me/calendarList")) return { items: calendars } as T;
    if (u.pathname.includes("/calendars/alex%40example.com/events") || u.pathname.includes(`/calendars/${encodeURIComponent("alex@example.com")}/events`)) {
      return (u.searchParams.get("pageToken") === "page-2" ? { items: personalPage2 } : { items: personalPage1, nextPageToken: "page-2" }) as T;
    }
    if (u.pathname.includes(`/calendars/${encodeURIComponent("work@group.calendar.google.com")}/events`)) return { items: work } as T;
    throw new Error(`Unexpected URL in fixture: ${url}`);
  };
  return { fetchJson, urls };
}
