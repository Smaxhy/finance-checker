"use client";
import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { ThemeProvider, useTheme } from "@/components/shell/theme";
import { LocalBoot } from "./boot";

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      mobileOffset={{ bottom: "calc(84px + env(safe-area-inset-bottom))" }}
      toastOptions={{ className: "!bg-surface !border-border !text-fg !shadow-card !rounded-xl !text-[13px]" }}
    />
  );
}

/** Root providers for the GitHub Pages edition (theme, toasts, browser glue). */
export function LocalProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider initial="dark">
      <LocalBoot />
      {children}
      <ThemedToaster />
    </ThemeProvider>
  );
}
