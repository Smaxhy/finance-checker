"use client";
// GitHub Pages edition only: one-time Google setup and the options for checking mail.
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Loader2, MailCheck, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/input";
import { LOCAL_CHANGE_EVENT } from "@/lib/local/db";
import { getToken, redirectUri, siteOrigin } from "@/lib/local/google";
import { getAutoCheck, getGoogleClientId, isValidGoogleClientId, setAutoCheck, setGoogleClientId } from "@/lib/local/prefs";

function subscribe(onChange: () => void) {
  window.addEventListener(LOCAL_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(LOCAL_CHANGE_EVENT, onChange);
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1 flex items-center gap-1.5">
      <code className="min-w-0 flex-1 truncate rounded bg-surface-3 px-2 py-1 font-mono text-[11.5px] text-fg">{value}</code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Copy ${value}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </span>
  );
}

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
    {children} <ExternalLink className="size-3" />
  </a>
);

/** Shown until a Google client ID is saved: the one-time setup, in plain steps. */
export function GoogleLocalSetup() {
  const [value, setValue] = useState("");
  // Known only in the browser (they depend on where this copy of the app is hosted).
  const origin = useSyncExternalStore(subscribe, siteOrigin, () => null);
  const redirect = useSyncExternalStore(subscribe, redirectUri, () => null);
  const urls = origin && redirect ? { origin, redirect } : null;
  const valid = isValidGoogleClientId(value);

  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface/60 p-4 sm:p-5" data-testid="google-setup">
      <p className="text-[13.5px] font-medium">Let the app read your Gmail and Google Calendar (read-only)</p>
      <p className="mt-1 text-[12.5px] text-muted">
        Google only lets an app read mail if it has its own &quot;client ID&quot;. Creating one is free and takes about 10 minutes, once. After that you can connect as many Google accounts as you
        like. The app can never send, delete or change anything.
      </p>
      <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-[12.5px] text-secondary">
        <li>
          Open <A href="https://console.cloud.google.com/projectcreate">Google Cloud: new project</A>, give it any name (for example &quot;Command Centre&quot;) and click <b>Create</b>.
        </li>
        <li>
          Switch on the two things the app reads - click <b>Enable</b> on each page: <A href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</A> and{" "}
          <A href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">Google Calendar API</A>.
        </li>
        <li>
          Open <A href="https://console.cloud.google.com/auth/overview">Google Auth Platform</A> and click <b>Get started</b>. Fill in an app name and your email, choose <b>External</b>, and finish.
          Then under <b>Audience → Test users</b> add every Gmail address you want to connect.
        </li>
        <li>
          Open <A href="https://console.cloud.google.com/auth/clients">Clients</A> → <b>Create client</b> → type <b>Web application</b>, and paste these two values:
          <span className="mt-1.5 block text-muted">Authorised JavaScript origins</span>
          {urls && <CopyValue value={urls.origin} />}
          <span className="mt-1.5 block text-muted">Authorised redirect URIs</span>
          {urls && <CopyValue value={urls.redirect} />}
        </li>
        <li>
          Click <b>Create</b>, copy the <b>Client ID</b> (it ends in <code className="font-mono text-[11.5px]">.apps.googleusercontent.com</code>) and paste it here:
          <form
            className="mt-2 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              setGoogleClientId(value);
              toast.success("Client ID saved - you can connect your Google accounts now");
            }}
          >
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="1234567890-abc123.apps.googleusercontent.com" aria-label="Google client ID" autoComplete="off" spellCheck={false} className="font-mono text-[12px]" />
            <Button type="submit" variant="primary" disabled={!valid}>
              Save
            </Button>
          </form>
          {value && !valid && <span className="mt-1 block text-[12px] text-danger">That doesn&apos;t look like a client ID. It should end in .apps.googleusercontent.com</span>}
        </li>
      </ol>
      <p className="mt-3 text-[12px] text-muted">
        The first time you connect, Google shows &quot;Google hasn&apos;t verified this app&quot;. That is expected for an app you made yourself: click <b>Continue</b>. The client ID is not a
        password - it only identifies your copy of the app, and it stays in this browser.
      </p>
    </div>
  );
}

/** Shown once a client ID exists: how and when mail is checked. */
/** Re-evaluates when local data changes and every 30 seconds (tokens expire on their own). */
function subscribeWithClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 30_000);
  window.addEventListener(LOCAL_CHANGE_EVENT, onChange);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener(LOCAL_CHANGE_EVENT, onChange);
  };
}

/** How many of these accounts still have a valid hour-long read-only pass in this tab. */
function useSignedIn(ids: string[]): number {
  return useSyncExternalStore(
    subscribeWithClock,
    () => ids.filter((id) => getToken(id)).length,
    () => 0,
  );
}

export function LocalSignInState({ id }: { id: string }) {
  const ready = useSignedIn([id]) === 1;
  return <span data-testid="signin-state"> · {ready ? "signed in for the next hour" : "signs in again on the next check"}</span>;
}

export function GoogleLocalOptions({ connectionIds }: { connectionIds: string[] }) {
  const accounts = connectionIds.length;
  const needSignIn = accounts - useSignedIn(connectionIds);
  const auto = useSyncExternalStore(subscribe, getAutoCheck, () => false);
  const clientId = useSyncExternalStore(subscribe, getGoogleClientId, () => null);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);

  const checkAll = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const json = (await res.json()) as { results: { ok: boolean; label?: string; error?: string; stats?: { gmail?: { stored?: number } } }[] };
      const ok = json.results.filter((r) => r.ok);
      const failed = json.results.filter((r) => !r.ok);
      const stored = ok.reduce((a, r) => a + (r.stats?.gmail?.stored ?? 0), 0);
      if (ok.length) toast.success(`Checked ${ok.length} account${ok.length === 1 ? "" : "s"}`, { description: `${stored} new email${stored === 1 ? "" : "s"} worth knowing about.` });
      for (const f of failed) toast.error(f.label ?? "Couldn't check an account", { description: f.error });
    } catch {
      toast.error("Couldn't check your email");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-4" data-testid="google-options">
      {accounts > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Check all accounts now</p>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {needSignIn > 0
                ? "Google's read-only pass lasts about an hour. Checking fetches a new one first: the page hops to Google and straight back, without asking anything."
                : "While the app is open, your accounts are checked again every 15 minutes."}
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={checkAll} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <MailCheck />} {checking ? "Checking…" : "Check now"}
          </Button>
        </div>
      )}
      <label className="flex items-start justify-between gap-6">
        <span>
          <span className="block text-[13px] font-medium">Check automatically when I open the app</span>
          <span className="mt-0.5 block text-[12.5px] text-muted">
            At most once every 3 hours, the page hops to Google and back by itself to fetch a fresh read-only pass, then checks your mail. Off by default. Nothing can be checked while the app is
            closed - this edition has no server.
          </span>
        </span>
        <Switch label="Check automatically when I open the app" checked={auto} onChange={(v) => setAutoCheck(v)} />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-[12px] text-muted">
        {editing ? (
          <ClientIdEditor current={clientId ?? ""} onDone={() => setEditing(false)} />
        ) : (
          <>
            <span className="min-w-0 truncate">
              Google client ID: <code className="font-mono text-[11.5px]">{clientId ? `${clientId.slice(0, 14)}…${clientId.slice(-28)}` : "not set"}</code>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Change
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ClientIdEditor({ current, onDone }: { current: string; onDone: () => void }) {
  const [value, setValue] = useState(current);
  const valid = isValidGoogleClientId(value);
  return (
    <form
      className="flex w-full flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() && !valid) return;
        setGoogleClientId(value.trim() || null);
        toast.success(value.trim() ? "Client ID updated" : "Client ID removed");
        onDone();
      }}
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Google client ID" autoComplete="off" spellCheck={false} className="font-mono text-[12px]" />
      <Button type="submit" variant="primary" size="sm" disabled={Boolean(value.trim()) && !valid}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}
