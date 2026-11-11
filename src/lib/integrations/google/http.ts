/**
 * Google REST helper shared by the server (full edition) and the browser
 * (GitHub Pages edition). Only ever sends GET requests with a bearer token.
 */
export class GoogleAuthError extends Error {
  constructor(
    message: string,
    public readonly reconnect: boolean,
  ) {
    super(message);
  }
}

/** Small helper for Google REST calls with consistent error handling. */
export async function googleFetch<T>(accessToken: string, url: string): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (res.status === 401) throw new GoogleAuthError("Google rejected the access token", true);
    if (res.status === 403) {
      const body = (await res.text()).slice(0, 400);
      // A read-only scope that wasn't granted, or an API that isn't enabled for the Google Cloud project.
      if (/insufficient|scope|PERMISSION_DENIED|accessNotConfigured|has not been used|disabled/i.test(body)) {
        throw new GoogleAuthError(/accessNotConfigured|has not been used|disabled/i.test(body) ? "This Google API isn't switched on for your Google Cloud project yet." : "Google didn't grant read access for this.", false);
      }
      throw new Error(`Google API 403: ${body.slice(0, 300)}`);
    }
    if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
  throw new Error("Google API is rate limiting requests - try again later");
}
