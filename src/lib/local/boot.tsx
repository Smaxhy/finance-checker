"use client";
/**
 * GitHub Pages edition glue: there is no server, so the few places that call
 * API routes are answered in the browser - exports become local downloads,
 * "sync" re-runs detection on local data, and server-only integrations say
 * they're unavailable. Also refreshes detection/notifications once a day.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { exportAll, flushNow, LOCAL_CHANGE_EVENT, LOCAL_USER_ID, localDb, ready } from "./db";
import { BASE_PATH } from "./mode";
import { runPipeline } from "@/lib/engines/pipeline";
import { buildTransactionsCsv } from "@/app/api/reports/csv";
import type { AppSupabaseClient } from "./server";

const db = localDb as unknown as AppSupabaseClient;
const UNAVAILABLE = "Not available in the GitHub Pages edition - it runs only in your browser. Import a bank CSV instead, or deploy the full edition (see README).";

/** Path inside the app: base path removed, trailing slash dropped (the static export adds one). */
function appPath(url: URL): string {
  const path = BASE_PATH && url.pathname.startsWith(BASE_PATH) ? url.pathname.slice(BASE_PATH.length) || "/" : url.pathname;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function exportTransactions(url: URL) {
  const from = url.searchParams.get("from") ?? "1990-01-01";
  const to = url.searchParams.get("to") ?? "2100-12-31";
  const { csv } = await buildTransactionsCsv(db, { id: LOCAL_USER_ID }, from, to);
  download(`transactions_${from}_${to}.csv`, csv, "text/csv;charset=utf-8");
}

async function exportEverything() {
  const data = await exportAll();
  download(`command-centre-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exported_at: new Date().toISOString(), edition: "github-pages", ...data }, null, 2), "application/json");
}

async function localSync() {
  await ready();
  const pipeline = await runPipeline(db, LOCAL_USER_ID);
  localStorage.setItem("cc:lastPipeline", String(Date.now()));
  window.dispatchEvent(new Event(LOCAL_CHANGE_EVENT));
  return pipeline;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let installed = false;

export function LocalBoot() {
  const router = useRouter();

  useEffect(() => {
    if (installed) return;
    installed = true;

    // 1. Answer API calls in the browser.
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      if (url.origin !== window.location.origin) return realFetch(input, init);
      const path = appPath(url);
      if (!path.startsWith("/api/")) return realFetch(input, init);
      if (path === "/api/sync") return json({ results: [], pipeline: await localSync() });
      if (path === "/api/assistant" || path.startsWith("/api/integrations/")) return json({ error: "setup_required", message: UNAVAILABLE }, 503);
      return json({ error: UNAVAILABLE }, 404);
    };

    // 2. Links to server routes become local downloads or a friendly notice.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const path = appPath(url);
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (path === "/api/reports/transactions") {
        stop();
        void exportTransactions(url).catch(() => toast.error("Export failed"));
      } else if (path === "/api/export") {
        stop();
        void exportEverything();
      } else if (path.startsWith("/api/")) {
        stop();
        toast.info(UNAVAILABLE);
      } else {
        // Subscription detail pages are exported once; the id travels as ?id=.
        const m = path.match(/^\/subscriptions\/([0-9a-f-]{36})\/?$/i);
        if (m) {
          stop();
          router.push(`/subscriptions/_?id=${m[1]}`);
        }
      }
    };
    window.addEventListener("click", onClick, true);

    // 3. Keep data safe when the tab is hidden or closed.
    const onHide = () => void flushNow();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    // 4. "Daily job": refresh detection and notifications at most every 6 hours.
    (async () => {
      await ready();
      const last = Number(localStorage.getItem("cc:lastPipeline") ?? 0);
      const { count } = await localDb.from("transactions").select("id", { count: "exact", head: true });
      if ((count ?? 0) > 0 && Date.now() - last > 6 * 3600_000) await localSync().catch(() => undefined);
    })();
  }, [router]);

  return null;
}
