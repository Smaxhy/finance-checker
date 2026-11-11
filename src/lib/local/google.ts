/**
 * Read-only Google sign-in for the GitHub Pages edition, for any number of
 * Google accounts.
 *
 * There is no server to keep a client secret or a refresh token, so this uses
 * Google's OAuth flow for browser apps: the page goes to Google, the user
 * approves read-only access, and Google sends the page back to /oauth/ with a
 * short-lived access token (about an hour) in the URL fragment. Tokens are
 * kept in sessionStorage only - they are gone when the tab closes, are never
 * written to the data store and never appear in an export. When a token has
 * expired, the same round trip with `prompt=none` fetches a new one without
 * asking anything, as long as the user is still signed in to Google.
 *
 * Only two scopes are ever requested: gmail.readonly and calendar.readonly.
 */
import { GOOGLE_SCOPES, type GoogleService } from "@/lib/integrations/google/scopes";
import { getGmailAddress } from "@/lib/integrations/google/gmail";
import { googleFetch } from "@/lib/integrations/google/http";
import type { Connection } from "@/lib/types";
import { LOCAL_USER_ID, localDb, ready } from "./db";
import { BASE_PATH } from "./mode";
import { getGoogleClientId } from "./prefs";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const PENDING_KEY = "cc:google:pending";
const TOKEN_PREFIX = "cc:google:token:";
/** Set after a sign-in round trip so the app checks the mailboxes as soon as it is back. */
export const SYNC_FLAG = "cc:google:syncNow";
/** Fired when the app is back from a sign-in round trip without a page reload, so the check can start. */
export const MAIL_CHECK_EVENT = "cc:check-mail";
/** Set once per tab when an automatic refresh was attempted, so it never loops. */
export const AUTO_FLAG = "cc:google:autoTried";

export interface AuthOutcome {
  label: string;
  ok: boolean;
  reason?: string;
}

interface PendingAuth {
  state: string;
  mode: "add" | "refresh";
  services: GoogleService[];
  /** Connection being refreshed right now (refresh mode). */
  current: string | null;
  /** Connections still to refresh after the current one. */
  queue: string[];
  /** App path (without the base path) to return to. */
  returnTo: string;
  outcomes: AuthOutcome[];
  startedAt: number;
}

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function randomState(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Where Google sends the browser back to. Must be listed as an authorised redirect URI on the OAuth client. */
export function redirectUri(): string {
  return `${window.location.origin}${BASE_PATH}/oauth/`;
}

/** The site's origin, which must be listed as an authorised JavaScript origin on the OAuth client. */
export function siteOrigin(): string {
  return window.location.origin;
}

export function buildAuthUrl(opts: { clientId: string; state: string; services: GoogleService[]; prompt?: "none" | "select_account" | "consent"; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: opts.services.map((s) => GOOGLE_SCOPES[s]).join(" "),
    include_granted_scopes: "true",
    state: opts.state,
  });
  if (opts.prompt) params.set("prompt", opts.prompt);
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTH_URL}?${params}`;
}

// --- tokens (this tab only) -------------------------------------------------------

export function getToken(connectionId: string): string | null {
  const raw = session()?.getItem(TOKEN_PREFIX + connectionId);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as { token: string; expiresAt: number };
    // Leave a margin so a sync that starts now doesn't run out halfway.
    return t.expiresAt - Date.now() > 120_000 ? t.token : null;
  } catch {
    return null;
  }
}

function storeToken(connectionId: string, token: string, expiresInSeconds: number) {
  session()?.setItem(TOKEN_PREFIX + connectionId, JSON.stringify({ token, expiresAt: Date.now() + expiresInSeconds * 1000 }));
}

export function clearToken(connectionId: string) {
  session()?.removeItem(TOKEN_PREFIX + connectionId);
}

export function clearAllTokens() {
  const s = session();
  if (!s) return;
  for (let i = s.length - 1; i >= 0; i--) {
    const key = s.key(i);
    if (key?.startsWith(TOKEN_PREFIX)) s.removeItem(key);
  }
  s.removeItem(PENDING_KEY);
  s.removeItem(SYNC_FLAG);
}

// --- connections ----------------------------------------------------------------

export async function googleConnections(): Promise<Connection[]> {
  await ready();
  const { data } = await localDb.from("connections").select("*").eq("provider", "google").order("created_at");
  return ((data ?? []) as Connection[]).filter((c) => c.status !== "revoked");
}

/** Connections that can't be checked right now because their short-lived token has run out. */
export async function connectionsNeedingSignIn(): Promise<Connection[]> {
  return (await googleConnections()).filter((c) => !getToken(c.id));
}

// --- starting a round trip --------------------------------------------------------

function go(pending: PendingAuth, url: string) {
  session()?.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(url);
}

/** Path inside the app (no base path) of the page the user is on. */
export function currentAppPath(): string {
  const { pathname, search } = window.location;
  const path = BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || "/" : pathname;
  return `${path}${search}`;
}

/** Connect a (new) Google account. Google shows its account chooser, so a second or third account can be picked. */
export function startAddAccount(services: GoogleService[], opts: { loginHint?: string; returnTo?: string } = {}): boolean {
  const clientId = getGoogleClientId();
  if (!clientId || services.length === 0) return false;
  const state = randomState();
  go(
    { state, mode: "add", services, current: null, queue: [], returnTo: opts.returnTo ?? "/settings/accounts", outcomes: [], startedAt: Date.now() },
    buildAuthUrl({ clientId, state, services, prompt: opts.loginHint ? undefined : "select_account", loginHint: opts.loginHint }),
  );
  return true;
}

function servicesOf(c: Connection): GoogleService[] {
  const s = (Object.keys(GOOGLE_SCOPES) as GoogleService[]).filter((k) => c.scopes.includes(GOOGLE_SCOPES[k]));
  return s.length ? s : ["gmail"];
}

/**
 * Fetch fresh tokens for these connections, one after the other, without
 * asking the user anything (`prompt=none`). An account that needs attention
 * is marked "Needs reconnecting" and the chain moves on.
 */
export async function startRefresh(connectionIds: string[], opts: { returnTo?: string } = {}): Promise<boolean> {
  const clientId = getGoogleClientId();
  if (!clientId) return false;
  const all = await googleConnections();
  const todo = connectionIds.map((id) => all.find((c) => c.id === id)).filter((c): c is Connection => Boolean(c));
  if (todo.length === 0) return false;
  const [first, ...rest] = todo;
  const state = randomState();
  go(
    { state, mode: "refresh", services: servicesOf(first), current: first.id, queue: rest.map((c) => c.id), returnTo: opts.returnTo ?? currentAppPath(), outcomes: [], startedAt: Date.now() },
    buildAuthUrl({ clientId, state, services: servicesOf(first), prompt: "none", loginHint: first.label }),
  );
  return true;
}

// --- coming back from Google ---------------------------------------------------------

const DENIED: Record<string, string> = {
  access_denied: "Google access was not granted.",
  interaction_required: "Google needs you to sign in again for this account.",
  login_required: "You are signed out of this Google account in this browser.",
  consent_required: "Google needs you to approve read-only access again.",
  account_selection_required: "Google needs you to pick the account again.",
};

async function accountEmail(token: string, granted: string[]): Promise<string> {
  if (granted.includes(GOOGLE_SCOPES.gmail)) return getGmailAddress(token);
  // Calendar only: the primary calendar's id is the account's email address.
  const primary = await googleFetch<{ id?: string }>(token, "https://www.googleapis.com/calendar/v3/users/me/calendarList/primary");
  if (!primary.id) throw new Error("Google did not return the account's email address");
  return primary.id;
}

async function saveConnection(email: string, granted: string[]): Promise<Connection> {
  const { data: existing } = await localDb.from("connections").select("*").eq("provider", "google").eq("label", email).maybeSingle();
  const prev = existing as Connection | null;
  if (prev) {
    const scopes = [...new Set([...prev.scopes, ...granted])];
    await localDb.from("connections").update({ scopes, status: "active", last_error: null }).eq("id", prev.id);
    return { ...prev, scopes, status: "active", last_error: null };
  }
  const { data, error } = await localDb.from("connections").insert({ user_id: LOCAL_USER_ID, provider: "google", label: email, scopes: granted, status: "active", metadata: { email } }).select("*").single();
  if (error || !data) throw new Error(`Could not save the connection: ${error?.message ?? "unknown error"}`);
  return data as Connection;
}

export type AuthResult =
  | { kind: "redirect"; url: string }
  | { kind: "done"; returnTo: string; outcomes: AuthOutcome[]; connectedId?: string }
  | { kind: "error"; message: string; returnTo: string };

/** Handles the fragment Google sent back to /oauth/. Returns where to go next. */
export async function completeAuth(fragment: string): Promise<AuthResult> {
  const s = session();
  const raw = s?.getItem(PENDING_KEY);
  let pending: PendingAuth | null = null;
  try {
    pending = raw ? (JSON.parse(raw) as PendingAuth) : null;
  } catch {
    pending = null;
  }
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  const fail = (message: string): AuthResult => {
    s?.removeItem(PENDING_KEY);
    return { kind: "error", message, returnTo: pending?.returnTo ?? "/settings/accounts" };
  };
  // The state value proves this response answers a sign-in this tab started (and not a link someone sent).
  if (!pending || !params.get("state") || params.get("state") !== pending.state) return fail("This Google sign-in didn't start in this tab or has expired. Please try again.");
  if (Date.now() - pending.startedAt > 15 * 60_000) return fail("The Google sign-in took too long and expired. Please try again.");
  await ready();

  const clientId = getGoogleClientId();
  if (!clientId) return fail("The Google client ID is missing. Add it under Settings > Connected Accounts.");

  const error = params.get("error");
  const token = params.get("access_token");
  const expiresIn = Number(params.get("expires_in")) || 3600;
  const granted = (params.get("scope") ?? "").split(/\s+/).filter((x) => Object.values(GOOGLE_SCOPES).includes(x as (typeof GOOGLE_SCOPES)[GoogleService]));
  let connectedId: string | undefined;

  if (pending.mode === "add") {
    if (error || !token) return fail(DENIED[error ?? ""] ?? `Google sign-in failed${error ? ` (${error})` : ""}.`);
    if (granted.length === 0) return fail("Read-only access wasn't ticked on Google's screen, so nothing was connected. Try again and leave the boxes ticked.");
    try {
      const email = await accountEmail(token, granted);
      const connection = await saveConnection(email, granted);
      storeToken(connection.id, token, expiresIn);
      connectedId = connection.id;
      pending.outcomes.push({ label: email, ok: true });
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Could not read the Google account.");
    }
  } else {
    const all = await googleConnections();
    const expected = all.find((c) => c.id === pending!.current);
    if (expected) {
      const needsUser = (reason: string) => localDb.from("connections").update({ status: "expired", last_error: reason }).eq("id", expected.id);
      if (error || !token) {
        const reason = DENIED[error ?? ""] ?? `Google could not refresh access${error ? ` (${error})` : ""}.`;
        await needsUser(`${reason} Tap Reconnect to continue checking this mailbox.`);
        pending.outcomes.push({ label: expected.label, ok: false, reason });
      } else {
        try {
          const email = await accountEmail(token, granted.length ? granted : expected.scopes);
          // login_hint is only a hint: make sure the token really belongs to this mailbox.
          const owner = all.find((c) => c.label.toLowerCase() === email.toLowerCase());
          if (owner) {
            storeToken(owner.id, token, expiresIn);
            await localDb.from("connections").update({ status: "active", last_error: null }).eq("id", owner.id);
            pending.outcomes.push({ label: owner.label, ok: true });
          }
          if (!owner || owner.id !== expected.id) {
            const reason = "Google answered with a different account.";
            await needsUser(`${reason} Tap Reconnect and choose ${expected.label}.`);
            pending.outcomes.push({ label: expected.label, ok: false, reason });
          }
        } catch (e) {
          pending.outcomes.push({ label: expected.label, ok: false, reason: e instanceof Error ? e.message : "Could not verify the account" });
        }
      }
    }
    // Next mailbox in the chain.
    const nextId = pending.queue.shift();
    const next = nextId ? all.find((c) => c.id === nextId) : undefined;
    if (next) {
      const state = randomState();
      const updated: PendingAuth = { ...pending, state, current: next.id, services: servicesOf(next) };
      s?.setItem(PENDING_KEY, JSON.stringify(updated));
      return { kind: "redirect", url: buildAuthUrl({ clientId, state, services: servicesOf(next), prompt: "none", loginHint: next.label }) };
    }
  }

  s?.removeItem(PENDING_KEY);
  // A newly connected account is synced by the accounts page (?sync=<id>); a refresh syncs when the app is back.
  if (pending.mode === "refresh" && pending.outcomes.some((o) => o.ok)) s?.setItem(SYNC_FLAG, "all");
  return { kind: "done", returnTo: pending.returnTo, outcomes: pending.outcomes, connectedId };
}

/** Best-effort revoke of a token at Google (their revoke endpoint only accepts a simple form POST from browsers). */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", mode: "no-cors", headers: { "content-type": "application/x-www-form-urlencoded" } });
  } catch {
    // offline or blocked: the token expires by itself within the hour
  }
}
