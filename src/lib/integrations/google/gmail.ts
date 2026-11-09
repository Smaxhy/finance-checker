import "server-only";
import { googleFetch } from "./oauth";
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

export function gmailWebLink(id: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;
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
