/** True in the GitHub Pages edition (static, browser-only, data stored on this device). */
export const IS_LOCAL = process.env.NEXT_PUBLIC_LOCAL_MODE === "1";
/** URL prefix the static site is served under, e.g. "/finance-checker" on GitHub Pages. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
