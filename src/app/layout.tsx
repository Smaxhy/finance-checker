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
};

export const viewport: Viewport = {
  themeColor: "#09090b",
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
            toastOptions={{
              className: "!bg-surface !border-border !text-fg !shadow-card !rounded-xl !text-[13px]",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
