import "server-only";
import type { SyncContext, SyncStats } from "./types";

// Implemented in the calendar workstream.
export async function syncCalendar(ctx: SyncContext): Promise<SyncStats> {
  void ctx;
  throw new Error("Calendar sync is not implemented yet");
}
