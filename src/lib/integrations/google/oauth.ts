import "server-only";
import { createHash } from "node:crypto";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Connection } from "@/lib/types";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { readSecrets, updateConnection, writeSecrets } from "@/lib/integrations/connections";

/** Read-only scopes only. The app can never send, delete or modify email or calendar data. */
import { GOOGLE_SCOPES, type GoogleService } from "./scopes";
export { GOOGLE_SCOPES, hasScope, type GoogleService } from "./scopes";
import { GoogleAuthError } from "./http";
export { GoogleAuthError, googleFetch } from "./http";
const IDENTITY_SCOPES = ["openid", "email"];

export interface GoogleSecrets {
  refresh_token: string;
  access_token?: string;
  expires_at?: number; // epoch ms
}

export function googleRedirectUri() {
  return `${env.appUrl}/api/integrations/google/callback`;
}

export function createPkce() {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildGoogleAuthUrl(opts: { state: string; challenge: string; services: GoogleService[]; loginHint?: string; chooseAccount?: boolean }) {
  if (!env.google.clientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: [...IDENTITY_SCOPES, ...opts.services.map((s) => GOOGLE_SCOPES[s])].join(" "),
    access_type: "offline",
    // "consent" guarantees a refresh token; "select_account" lets the user pick which Google account to connect.
    prompt: opts.chooseAccount ? "consent select_account" : "consent",
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.google.clientId!, client_secret: env.google.clientSecret!, ...body }),
    cache: "no-store",
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok) {
    throw new GoogleAuthError(`Google token request failed: ${json.error_description ?? json.error ?? res.status}`, json.error === "invalid_grant");
  }
  return json;
}

export async function exchangeGoogleCode(code: string, verifier: string) {
  return tokenRequest({ code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
}

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!res.ok) throw new Error("Could not read the Google account email");
  const json = (await res.json()) as { email?: string };
  if (!json.email) throw new Error("Google did not return an email address");
  return json.email;
}

export async function revokeGoogleToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", cache: "no-store" }).catch(() => undefined);
}

/** Returns a valid access token for the connection, refreshing (and persisting) it when needed. */
export async function getGoogleAccessToken(admin: AdminClient, connection: Connection): Promise<string> {
  const secrets = await readSecrets<GoogleSecrets>(admin, connection.id, connection.user_id);
  if (!secrets?.refresh_token) throw new GoogleAuthError("No Google credentials stored - please reconnect.", true);
  if (secrets.access_token && secrets.expires_at && secrets.expires_at - Date.now() > 60_000) return secrets.access_token;
  try {
    const t = await tokenRequest({ refresh_token: secrets.refresh_token, grant_type: "refresh_token" });
    await writeSecrets(admin, connection.id, connection.user_id, {
      refresh_token: t.refresh_token ?? secrets.refresh_token,
      access_token: t.access_token,
      expires_at: Date.now() + t.expires_in * 1000,
    } satisfies GoogleSecrets);
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleAuthError && e.reconnect) {
      await updateConnection(admin, connection.id, connection.user_id, { status: "expired", last_error: "Google access was revoked or expired. Reconnect to resume syncing." });
    }
    throw e;
  }
}
