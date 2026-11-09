import "server-only";
import type { SyncContext, SyncStats } from "./types";

// Implemented in the email-intelligence workstream.
export async function syncGmail(ctx: SyncContext): Promise<SyncStats> {
  void ctx;
  throw new Error("Gmail sync is not implemented yet");
}
