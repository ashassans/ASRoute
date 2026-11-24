import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme.ts";

interface ThemeToggleProps {
  compact?: boolean;
  className?: string;
}

export function ThemeToggle({ compact = false, className = "" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isLight ? "Switch to dark theme" : "Switch to light theme"}
      title={isLight ? "Switch to Obsidian Dark" : "Switch to Light Mode"}
      className={`inline-flex items-center justify-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink bg-surface hover:bg-elevated border border-hairline rounded-lg transition-colors whitespace-nowrap shrink-0 ${
        compact ? "w-8 h-8 p-0" : "px-2.5 sm:px-3 py-1.5"
      } ${className}`}
    >
      {isLight ? (
        <>
          <Moon className="w-3.5 h-3.5 text-indigo-500" />
          {!compact && <span className="hidden xl:inline">Dark</span>}
        </>
      ) : (
        <>
          <Sun className="w-3.5 h-3.5 text-cyan-400" />
          {!compact && <span className="hidden xl:inline">Light</span>}
        </>
      )}
    </button>
  );
}
