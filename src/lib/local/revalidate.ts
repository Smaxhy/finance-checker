// Browser replacement for next/cache's revalidatePath: re-render pages that read local data.
import { LOCAL_CHANGE_EVENT } from "./db";

export function revalidatePath(..._args: unknown[]) {
  void _args;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
}
