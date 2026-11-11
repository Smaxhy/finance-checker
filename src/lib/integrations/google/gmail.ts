// Browser-safe: plain read-only REST calls with a bearer token.
import { googleFetch } from "./http";
import type { GmailMessage } from "@/lib/email/mime";

/**
 * Minimal read-only Gmail REST client. Only GET endpoints of the
 * gmail.readonly scope are used - nothing here can send, modify or delete mail.
 */
const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export async function listMessages(accessToken: string, q: string, pageToken?: string, maxResults = 100): Promise<GmailListResponse> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults), includeSpamTrash: "false" });
  if (pageToken) params.set("pageToken", pageToken);
  return googleFetch<GmailListResponse>(accessToken, `${BASE}/messages?${params}`);
}

export async function getMessageMetadata(accessToken: string, id: string): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "Subject", "Date"]) params.append("metadataHeaders", h);
  return googleFetch<GmailMessage>(accessToken, `${BASE}/messages/${encodeURIComponent(id)}?${params}`);
}

export async function getMessageFull(accessToken: string, id: string): Promise<GmailMessage> {
  return googleFetch<GmailMessage>(accessToken, `${BASE}/messages/${encodeURIComponent(id)}?format=full`);
}

/** Link that opens the message in Gmail, in the right account when several are signed in. */
export function gmailWebLink(id: string, account?: string | null): string {
  if (account && account.includes("@")) return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${encodeURIComponent(id)}`;
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
}

/** The address of the mailbox a token belongs to. */
export async function getGmailAddress(accessToken: string): Promise<string> {
  const profile = await googleFetch<{ emailAddress?: string }>(accessToken, `${BASE}/profile`);
  if (!profile.emailAddress) throw new Error("Google did not return the mailbox address");
  return profile.emailAddress;
}

/** Runs `fn` over `items` with at most `limit` promises in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
