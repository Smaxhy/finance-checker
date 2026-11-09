"use client";
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

type Theme = "dark" | "light";

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: "dark", setTheme: () => {} });

// The <html data-theme> attribute is the source of truth (set by the server from a
// cookie, or before first paint from localStorage in the static GitHub Pages edition).
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemeProvider({ initial, children }: { initial: Theme; children: ReactNode }) {
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => initial,
  );
  const setTheme = useCallback((t: Theme) => {
    document.documentElement.dataset.theme = t;
    document.cookie = `theme=${t}; path=/; max-age=31536000; samesite=lax`;
    try {
      localStorage.setItem("theme", t);
    } catch {
      // storage unavailable (private mode) - the cookie still applies
    }
  }, []);
  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
