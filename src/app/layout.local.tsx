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

// Applies the saved theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <LocalProviders>{children}</LocalProviders>
      </body>
    </html>
  );
}
