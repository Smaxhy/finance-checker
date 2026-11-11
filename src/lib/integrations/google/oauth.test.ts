import { beforeAll, describe, expect, it } from "vitest";

let buildGoogleAuthUrl: typeof import("./oauth").buildGoogleAuthUrl;

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  ({ buildGoogleAuthUrl } = await import("./oauth"));
});

describe("buildGoogleAuthUrl", () => {
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it("asks for read-only scopes with PKCE and offline access", () => {
    const p = params(buildGoogleAuthUrl({ state: "s1", challenge: "c1", services: ["gmail", "calendar"] }));
    expect(p).toMatchObject({
      client_id: "test-client.apps.googleusercontent.com",
      redirect_uri: "https://app.example.com/api/integrations/google/callback",
      response_type: "code",
      access_type: "offline",
      code_challenge: "c1",
      code_challenge_method: "S256",
      state: "s1",
      prompt: "consent",
    });
    expect(p.scope.split(" ")).toEqual(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"]);
    expect(p.scope).not.toMatch(/gmail\.(send|modify|compose)|mail\.google\.com|calendar(\.events)?(?!\.readonly)\b/);
  });

  it("shows Google's account chooser when adding another account, and targets one account when reconnecting", () => {
    const add = params(buildGoogleAuthUrl({ state: "s", challenge: "c", services: ["gmail"], chooseAccount: true }));
    expect(add.prompt).toBe("consent select_account");
    expect(add.login_hint).toBeUndefined();
    const reconnect = params(buildGoogleAuthUrl({ state: "s", challenge: "c", services: ["gmail"], loginHint: "sam@example.com" }));
    expect(reconnect).toMatchObject({ prompt: "consent", login_hint: "sam@example.com" });
  });
});
