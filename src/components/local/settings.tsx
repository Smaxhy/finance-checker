/**
 * Settings panels that only exist in the GitHub Pages edition (Google setup,
 * mail-check options, the user's own Claude key). In the server edition these
 * are never shown - the pages check IS_LOCAL first - so this file provides
 * empty stand-ins and keeps the browser-only code out of the server build.
 * The Pages build swaps in src/lib/local/components/settings.tsx.
 */
type Empty<P = object> = (props: P) => null;

export const AiLocalCard: Empty<{ assistant: boolean; extraction: boolean }> = () => null;
export const GoogleLocalSetup: Empty = () => null;
export const GoogleLocalOptions: Empty<{ connectionIds: string[] }> = () => null;
export const LocalSignInState: Empty<{ id: string }> = () => null;
