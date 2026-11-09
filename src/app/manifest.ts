import type { MetadataRoute } from "next";

/** Lets the app be installed to a phone's home screen and open full-screen like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Command Centre",
    short_name: "Command",
    description: "Your money, subscriptions, inbox and plans in one place.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#09090b",
    theme_color: "#09090b",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add transaction", url: "/finances/transactions?new=1" },
      { name: "Upcoming", url: "/calendar/upcoming" },
      { name: "Subscriptions", url: "/subscriptions" },
    ],
  };
}
