"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SyncResponse {
  results?: { ok: boolean; provider?: string; label?: string; error?: string; stats?: { gmail?: { stored?: number; scanned?: number; complete?: boolean } } }[];
  error?: string;
}

/**
 * Triggers a read-only Gmail check via /api/sync: one mailbox when a
 * connection id is given, otherwise every connected account.
 */
export function GmailSyncButton({ connectionId, autoStart = false, mailboxes = 1 }: { connectionId?: string; autoStart?: boolean; mailboxes?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const started = useRef(false);

  const run = () =>
    start(async () => {
      try {
        const res = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(connectionId ? { connectionId } : {}) });
        const json = (await res.json()) as SyncResponse;
        const results = (json.results ?? []).filter((r) => r.stats?.gmail || r.provider === undefined || r.provider === "google");
        const ok = results.filter((r) => r.ok);
        const failed = results.filter((r) => !r.ok);
        if (!res.ok || (ok.length === 0 && failed.length > 0) || results.length === 0) {
          toast.error("The email check failed", { description: failed[0]?.error ?? json.error ?? `HTTP ${res.status}` });
          return;
        }
        const stored = ok.reduce((a, r) => a + (r.stats?.gmail?.stored ?? 0), 0);
        const scanned = ok.reduce((a, r) => a + (r.stats?.gmail?.scanned ?? 0), 0);
        const more = ok.some((r) => r.stats?.gmail?.complete === false);
        toast.success(ok.length > 1 ? `${ok.length} mailboxes checked` : "Mailbox checked", {
          description: `${stored} new record${stored === 1 ? "" : "s"} from ${scanned} message${scanned === 1 ? "" : "s"}${more ? " - more history will load on the next check" : ""}.`,
        });
        for (const f of failed) toast.error(f.label ? `Couldn't check ${f.label}` : "One mailbox couldn't be checked", { description: f.error });
        router.refresh();
      } catch {
        toast.error("The email check failed", { description: "Network error" });
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
      {pending ? "Checking…" : mailboxes > 1 ? "Check all" : "Check now"}
    </Button>
  );
}
