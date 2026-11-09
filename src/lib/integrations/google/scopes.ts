/** Read-only Google scopes. Kept separate from oauth.ts so pages can import them without server-only code. */
export const GOOGLE_SCOPES = {
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  calendar: "https://www.googleapis.com/auth/calendar.readonly",
} as const;
export type GoogleService = keyof typeof GOOGLE_SCOPES;

export function hasScope(connection: { scopes: string[] }, service: GoogleService) {
  return connection.scopes.includes(GOOGLE_SCOPES[service]);
}
