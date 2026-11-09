import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/shell/theme";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Command Centre", template: "%s · Command Centre" },
  description: "Your personal finance, subscriptions, email and planning command centre.",
  robots: { index: false, follow: false },
  applicationName: "Command Centre",
  appleWebApp: { capable: true, title: "Command Centre", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets the bottom bar respect the iPhone home indicator
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
  ],
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme} className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full">
        <ThemeProvider initial={theme}>
          {children}
          <Toaster
            theme={theme}
            position="bottom-right"
            mobileOffset={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}
            toastOptions={{
              className: "!bg-surface !border-border !text-fg !shadow-card !rounded-xl !text-[13px]",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
