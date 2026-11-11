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
import { handleAssistantRequest } from "./assistant";
import { AUTO_FLAG, MAIL_CHECK_EVENT, SYNC_FLAG, getToken, googleConnections, startAddAccount, startRefresh } from "./google";
import { describeSync, syncGoogleLocal } from "./sync";
import { getAutoCheck, getGoogleClientId } from "./prefs";
import type { GoogleService } from "@/lib/integrations/google/scopes";
import { runPipeline } from "@/lib/engines/pipeline";
import { buildTransactionsCsv } from "@/app/api/reports/csv";
import type { AppSupabaseClient } from "./server";

const db = localDb as unknown as AppSupabaseClient;
const UNAVAILABLE = "Not available in the GitHub Pages edition - it runs only in your browser. Import a bank CSV instead, or deploy the full edition (see README).";
/** While the app is open, mailboxes with a valid sign-in are re-checked this often. */
const RECHECK_MS = 15 * 60_000;
/** An automatic trip to Google on opening the app happens at most this often. */
const AUTO_REFRESH_MS = 3 * 3600_000;

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

/**
 * "Sync" for the GitHub Pages edition. With Google accounts connected it checks
 * them (read-only) and then re-runs detection; without any, it only re-runs
 * detection on the local data. Mirrors the server's /api/sync response.
 */
async function localSyncRequest(init?: RequestInit) {
  let body: { connectionId?: string; full?: boolean } = {};
  try {
    body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  } catch {
    body = {};
  }
  const connections = await googleConnections();
  if (connections.length === 0) return { results: [], pipeline: await localSync() };
  const { results, pipeline } = await syncGoogleLocal({ connectionId: body.connectionId, full: body.full });
  const expired = results.filter((r) => r.needsSignIn);
  if (expired.length > 0 && expired.length === results.length) {
    // Nothing could be checked because the hour-long sign-in ran out. The user just asked for a
    // check, so fetch fresh access from Google now; the app comes back here and checks by itself.
    await flushNow();
    if (await startRefresh(expired.map((r) => r.connectionId))) return new Promise<never>(() => undefined);
  }
  return { results: results.map((r) => (r.needsSignIn ? { ...r, error: `Sign in to Google again to check ${r.label} (Settings > Connected Accounts > Reconnect).` } : r)), pipeline };
}

/** Checks every connected mailbox and reports the outcome in a toast. */
async function checkMail(announce: boolean) {
  const id = announce ? toast.loading("Checking your email…") : undefined;
  try {
    const { results } = await syncGoogleLocal({
      onProgress: (p) => {
        if (id === undefined) return;
        const d = p.detail;
        toast.loading(`Checking ${p.label}…`, { id, description: p.step === "calendar" ? "Reading the calendar" : d?.phase === "reading" ? `Read ${d.done} of ${d.total} new messages` : d?.phase === "saving" ? "Saving what matters" : "Looking for new messages" });
      },
    });
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok && !r.needsSignIn);
    const stored = ok.reduce((a, r) => a + Number(r.stats.gmail?.stored ?? 0), 0);
    if (failed.length) toast.error(`Couldn't check ${failed.map((r) => r.label).join(", ")}`, { id, description: failed[0].error });
    else if (announce) toast.success("Email checked", { id, description: ok.length ? describeSync(results) : "Sign in to Google again under Settings > Connected Accounts." });
    else if (stored > 0) toast.success(`${stored} new email${stored === 1 ? "" : "s"} worth knowing about`, { description: describeSync(results) });
  } catch (e) {
    if (announce) toast.error("Couldn't check your email", { id, description: e instanceof Error ? e.message : undefined });
  }
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
      if (path === "/api/sync") return json(await localSyncRequest(init));
      if (path === "/api/assistant") return handleAssistantRequest(init);
      if (path.startsWith("/api/integrations/")) return json({ error: "setup_required", message: UNAVAILABLE }, 503);
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
      } else if (path === "/api/integrations/google/start") {
        // "Connect Gmail / Calendar" and "Reconnect": go to Google for read-only access.
        stop();
        const services = (url.searchParams.get("services") ?? "gmail,calendar").split(",").filter((x): x is GoogleService => x === "gmail" || x === "calendar");
        if (!getGoogleClientId()) toast.info("Add your Google client ID first (Settings > Connected Accounts).");
        else void flushNow().then(() => startAddAccount(services, { loginHint: url.searchParams.get("hint") ?? undefined }));
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

    // 4. Keep things fresh. With Google accounts connected: check them when the app comes back
    //    from a sign-in, when it opens with a still-valid sign-in, and every 15 minutes while open.
    //    Without any: just refresh detection and notifications at most every 6 hours.
    const lastMailCheck = () => Number(localStorage.getItem("cc:lastMailCheck") ?? 0);
    (async () => {
      await ready();
      if (appPath(new URL(window.location.href)).startsWith("/oauth")) return;
      const connections = await googleConnections();
      if (connections.length === 0) {
        const last = Number(localStorage.getItem("cc:lastPipeline") ?? 0);
        const { count } = await localDb.from("transactions").select("id", { count: "exact", head: true });
        if ((count ?? 0) > 0 && Date.now() - last > 6 * 3600_000) await localSync().catch(() => undefined);
        return;
      }
      if (sessionStorage.getItem(SYNC_FLAG)) {
        sessionStorage.removeItem(SYNC_FLAG);
        await checkMail(true);
        return;
      }
      const signedIn = connections.filter((c) => getToken(c.id));
      if (signedIn.length > 0) {
        if (Date.now() - lastMailCheck() > RECHECK_MS) await checkMail(false);
      } else if (getAutoCheck() && getGoogleClientId() && navigator.onLine && !sessionStorage.getItem(AUTO_FLAG) && Date.now() - lastMailCheck() > AUTO_REFRESH_MS) {
        // Opt-in: fetch fresh read-only access without asking (once per tab, so it can never loop).
        sessionStorage.setItem(AUTO_FLAG, "1");
        await flushNow();
        await startRefresh(connections.map((c) => c.id));
      }
    })();
    // Back from a sign-in round trip (the app navigates back without reloading): check now.
    window.addEventListener(MAIL_CHECK_EVENT, () => {
      if (!sessionStorage.getItem(SYNC_FLAG)) return;
      sessionStorage.removeItem(SYNC_FLAG);
      void checkMail(true);
    });
    window.setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - lastMailCheck() < RECHECK_MS) return;
      void googleConnections().then((connections) => {
        if (connections.some((c) => getToken(c.id))) void checkMail(false);
      });
    }, 5 * 60_000);
  }, [router]);

  return null;
}
