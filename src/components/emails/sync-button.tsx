"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SyncResponse {
  results?: { ok: boolean; error?: string; stats?: { gmail?: { stored?: number; scanned?: number; complete?: boolean } } }[];
  error?: string;
}

/** Triggers a read-only Gmail sync for one connection via /api/sync. */
export function GmailSyncButton({ connectionId, autoStart = false }: { connectionId: string; autoStart?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const started = useRef(false);

  const run = () =>
    start(async () => {
      try {
        const res = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId }) });
        const json = (await res.json()) as SyncResponse;
        const r = json.results?.[0];
        if (!res.ok || !r?.ok) {
          toast.error("Gmail sync failed", { description: r?.error ?? json.error ?? `HTTP ${res.status}` });
          return;
        }
        const g = r.stats?.gmail;
        toast.success("Gmail synced", {
          description: g ? `${g.stored ?? 0} new records from ${g.scanned ?? 0} messages${g.complete === false ? " - more history will load on the next sync" : ""}.` : undefined,
        });
        router.refresh();
      } catch {
        toast.error("Gmail sync failed", { description: "Network error" });
      }
    });

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <Button variant="secondary" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
