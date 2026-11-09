import "server-only";
import type { SyncContext, SyncStats } from "./types";

// Implemented in the banking workstream.
export async function syncBank(ctx: SyncContext): Promise<SyncStats> {
  void ctx;
  throw new Error("Bank sync is not implemented yet");
}
