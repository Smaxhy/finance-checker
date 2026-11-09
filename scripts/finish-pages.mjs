// Post-build step for the GitHub Pages edition: writes the web app manifest
// (with the site's base path) and .nojekyll into the static export in ./out.
import { writeFile } from "node:fs/promises";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const manifest = {
  name: "Command Centre",
  short_name: "Command",
  description: "Your money, subscriptions and plans in one place - stored on this device.",
  start_url: `${base}/`,
  scope: `${base}/`,
  display: "standalone",
  orientation: "portrait",
  background_color: "#09090b",
  theme_color: "#09090b",
  categories: ["finance", "productivity"],
  icons: [
    { src: `${base}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${base}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `${base}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "Add transaction", url: `${base}/finances/transactions/?new=1` },
    { name: "Import bank CSV", url: `${base}/finances/transactions/?import=1` },
    { name: "Upcoming", url: `${base}/calendar/upcoming/` },
  ],
};
await writeFile(new URL("../out/manifest.webmanifest", import.meta.url), JSON.stringify(manifest, null, 2));
await writeFile(new URL("../out/.nojekyll", import.meta.url), "");
console.log("Wrote out/manifest.webmanifest and out/.nojekyll");
