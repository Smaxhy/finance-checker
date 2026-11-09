// The GitHub Pages edition has no accounts: the app and its data live in this browser.
export interface AuthState {
  error?: string;
  message?: string;
}
const unavailable = { error: "Sign-in isn't used in the GitHub Pages edition." };
export async function signIn(): Promise<AuthState> {
  return unavailable;
}
export async function signUp(): Promise<AuthState> {
  return unavailable;
}
export async function sendMagicLink(): Promise<AuthState> {
  return unavailable;
}
export async function signOut() {}
