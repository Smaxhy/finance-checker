import type { AdminClient } from "@/lib/supabase/admin";
import type { Connection } from "@/lib/types";

export interface SyncContext {
  /** Service-role client. EVERY query must filter by `userId` explicitly. */
  admin: AdminClient;
  userId: string;
  connection: Connection;
  /** Re-scan the full history window instead of continuing from the cursor. */
  full?: boolean;
}

export interface SyncStats {
  [key: string]: number | string | boolean | undefined;
}
