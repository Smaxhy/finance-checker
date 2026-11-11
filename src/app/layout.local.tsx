// Root layout of the GitHub Pages edition (static export, data stored in the browser).
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LocalProviders } from "@/lib/local/providers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "Command Centre", template: "%s · Command Centre" },
  description: "Your personal finance, subscriptions and planning command centre - running entirely in your browser.",
  robots: { index: false, follow: false },
  applicationName: "Command Centre",
  appleWebApp: { capable: true, title: "Command Centre", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: { icon: `${base}/icons/favicon-32.png`, apple: `${base}/icons/apple-touch-icon.png` },
  manifest: `${base}/manifest.webmanifest`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
  ],
  colorScheme: "dark light",
};

/**
 * This edition can hold an API key and short-lived Google tokens in the browser, so the page
 * is only allowed to talk to itself, Anthropic and Google's read-only APIs. Anything else
 * (another site, an image beacon, a plugin) is blocked by the browser. Inline scripts have to
 * stay allowed because a static host can't issue nonces.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.anthropic.com https://gmail.googleapis.com https://www.googleapis.com https://oauth2.googleapis.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Applies the saved theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "production" && <meta httpEquiv="Content-Security-Policy" content={CSP} />}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <LocalProviders>{children}</LocalProviders>
      </body>
    </html>
  );
}
