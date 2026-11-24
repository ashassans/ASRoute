import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "asrouter_theme";
const THEME_EVENT = "asrouter-theme-change";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
    window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: mode }));
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    const current = getStoredTheme();
    document.documentElement.dataset.theme = current;
    document.documentElement.style.colorScheme = current;
    setThemeState(current);

    const onThemeChange = (ev: Event) => {
      const detail = (ev as CustomEvent<ThemeMode>).detail;
      if (detail === "dark" || detail === "light") {
        setThemeState(detail);
      }
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === THEME_STORAGE_KEY) {
        const next: ThemeMode = ev.newValue === "light" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;
        setThemeState(next);
      }
    };

    window.addEventListener(THEME_EVENT, onThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemeMode = getStoredTheme() === "dark" ? "light" : "dark";
    setThemeState(next);
    applyTheme(next);
  }, []);

  return { theme, setTheme, toggleTheme };
}
