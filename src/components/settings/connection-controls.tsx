"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Landmark, Loader2, RefreshCw, Search, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { disconnectConnection } from "@/app/actions/settings";

async function runSync(connectionId: string) {
  const res = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Sync failed");
  const result = json.results?.[0];
  if (result && !result.ok) throw new Error(result.error ?? "Sync failed");
  return json as { results: { stats: Record<string, Record<string, number>> }[]; pipeline: { subscriptionsCreated: number; notificationsCreated: number } };
}

function describe(stats: Record<string, Record<string, number>> | undefined) {
  if (!stats) return "";
  const parts: string[] = [];
  if (stats.gmail) parts.push(`${stats.gmail.stored ?? 0} emails`);
  if (stats.calendar) parts.push(`${stats.calendar.upserted ?? stats.calendar.stored ?? 0} events`);
  if (stats.bank) parts.push(`${stats.bank.stored ?? 0} new transactions`);
  return parts.join(", ");
}

export function SyncButton({ connectionId, label = "Sync now" }: { connectionId: string; label?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const res = await runSync(connectionId);
            toast.success("Sync complete", { description: describe(res.results[0]?.stats) || undefined });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Sync failed");
          }
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {pending ? "Syncing…" : label}
    </Button>
  );
}

/** After an OAuth/PSD2 redirect (?sync=<id>) kick off the first sync automatically. */
export function AutoSync() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const started = useRef(false);
  useEffect(() => {
    const id = params.get("sync");
    if (!id || started.current) return;
    started.current = true;
    router.replace(pathname, { scroll: false });
    const t = toast.loading("Connected - running the first sync. This can take a minute…");
    runSync(id)
      .then((res) => toast.success("First sync complete", { id: t, description: describe(res.results[0]?.stats) || undefined }))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Sync failed", { id: t }))
      .finally(() => router.refresh());
  }, [params, pathname, router]);
  return null;
}

export function DisconnectButton({ id, name, dataLabel }: { id: string; name: string; dataLabel: string }) {
  const [open, setOpen] = useState(false);
  const [deleteData, setDeleteData] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-danger hover:text-danger">
        <Unplug /> Disconnect
      </Button>
      <DialogContent title={`Disconnect ${name}?`} description="Access is revoked at the provider and the stored credentials are deleted immediately.">
        <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent-strong)]" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
          <span>
            Also delete the {dataLabel} imported from this connection
            <span className="block text-[12px] text-muted">Leave unticked to keep your history without further syncing.</span>
          </span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await disconnectConnection({ id, deleteData });
                if (res.ok) {
                  toast.success(res.message ?? "Disconnected");
                  setOpen(false);
                  router.refresh();
                } else toast.error(res.message);
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Disconnect
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectBankButton({ label = "Connect a bank", country = "BE" }: { label?: string; country?: string }) {
  const [open, setOpen] = useState(false);
  const [banks, setBanks] = useState<{ name: string; country: string; logo: string | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open || banks) return;
    fetch(`/api/integrations/enablebanking/aspsps?country=${country}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error === "setup_required" ? "Enable Banking isn't configured on the server." : (j.error ?? "Could not load banks"));
        setBanks(j.banks);
      })
      .catch((e) => setError(e.message));
  }, [open, banks, country]);

  const filtered = useMemo(() => (banks ?? []).filter((b) => b.name.toLowerCase().includes(q.toLowerCase())), [banks, q]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        <Landmark /> {label}
      </Button>
      <DialogContent
        wide
        title="Connect a bank account"
        description="You'll be sent to your bank to approve read-only access (balances and transactions) via Enable Banking, a licensed PSD2 provider. Your bank login is never shared with this app. Access lasts up to 180 days, then your bank asks you to renew it."
      >
        {error ? (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</p>
        ) : !banks ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading banks…
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search KBC, Belfius, ING, BNP Paribas Fortis…" className="pl-8" />
            </div>
            <ul className="grid max-h-[46vh] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
              {filtered.map((b) => (
                <li key={`${b.country}-${b.name}`}>
                  <a
                    href={`/api/integrations/enablebanking/start?aspsp=${encodeURIComponent(b.name)}&country=${b.country}`}
                    className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-[13px] transition-colors hover:border-border hover:bg-surface-2"
                  >
                    {b.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.logo} alt="" className="size-6 rounded bg-white object-contain p-0.5" />
                    ) : (
                      <Landmark className="size-4 text-muted" />
                    )}
                    {b.name}
                  </a>
                </li>
              ))}
              {filtered.length === 0 && <li className="py-6 text-center text-[12.5px] text-muted">No bank matches “{q}”.</li>}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
