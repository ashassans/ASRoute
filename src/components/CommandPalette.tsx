import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Copy,
  Cpu,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { getConnectionPrefix, getProviderSpec, isSearchProvider } from "../shared/catalog.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import type { Combo, ProviderConnection } from "../types/gateway.ts";

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  group: "Navigation" | "Models & Combos" | "Actions";
  keywords?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  navItems: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    accent: string;
  }>;
  combos: Combo[];
  connections: ProviderConnection[];
  onNavigateTab: (tabId: string) => void;
  onOpenPlaygroundModel: (modelId: string) => void;
  onCreateApiKey: () => void;
  onCopyBaseUrl: () => void;
  onClearCache: () => void;
  onRefreshWorkspace: () => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  open,
  onClose,
  navItems,
  combos,
  connections,
  onNavigateTab,
  onOpenPlaygroundModel,
  onCreateApiKey,
  onCopyBaseUrl,
  onClearCache,
  onRefreshWorkspace,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(dialogRef, open, inputRef);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const items = useMemo<CommandPaletteItem[]>(() => {
    const list: CommandPaletteItem[] = [];

    for (const nav of navItems) {
      list.push({
        id: `nav:${nav.id}`,
        title: `Go to ${nav.label}`,
        subtitle: `/dashboard${nav.id === "overview" ? "" : `/${nav.id}`}`,
        group: "Navigation",
        keywords: `${nav.label} ${nav.id} navigate tab page`,
        icon: nav.icon,
        accent: nav.accent,
        onSelect: () => {
          onNavigateTab(nav.id);
          onClose();
        },
      });
    }

    list.push(
      {
        id: "act:new-key",
        title: "Create New API Key",
        subtitle: "Open API Keys & create a scoped gateway key",
        group: "Actions",
        keywords: "api key token secret generate",
        icon: Plus,
        accent: "#FBBF24",
        onSelect: () => {
          onCreateApiKey();
          onClose();
        },
      },
      {
        id: "act:copy-url",
        title: "Copy Gateway Base URL",
        subtitle: "Copy your OpenAI-compatible /v1 endpoint",
        group: "Actions",
        keywords: "endpoint url base copy curl sdk",
        icon: Copy,
        accent: "#38BDF8",
        onSelect: () => {
          onCopyBaseUrl();
          onClose();
        },
      },
      {
        id: "act:clear-cache",
        title: "Clear Response Cache",
        subtitle: "Purge cached completions on the server",
        group: "Actions",
        keywords: "cache purge flush reset",
        icon: Trash2,
        accent: "#FB923C",
        onSelect: () => {
          onClearCache();
          onClose();
        },
      },
      {
        id: "act:refresh",
        title: "Refresh Workspace",
        subtitle: "Reload providers, combos, keys & logs",
        group: "Actions",
        keywords: "reload sync bootstrap refresh",
        icon: RefreshCw,
        accent: "#34D399",
        onSelect: () => {
          onRefreshWorkspace();
          onClose();
        },
      },
      {
        id: "act:settings",
        title: "Account Settings",
        subtitle: "Update profile name or change password",
        group: "Actions",
        keywords: "profile password email account",
        icon: Settings,
        accent: "#818CF8",
        onSelect: () => {
          onOpenSettings();
          onClose();
        },
      }
    );

    for (const c of combos) {
      if (!c.isActive) continue;
      list.push({
        id: `combo:${c.id}`,
        title: c.name,
        subtitle: `Test combo in Playground · ${c.strategy} (${c.tiers.length} tiers)`,
        group: "Models & Combos",
        keywords: `combo ${c.name} ${c.strategy} playground`,
        icon: Layers,
        accent: "#F472B6",
        onSelect: () => {
          onOpenPlaygroundModel(c.name);
          onClose();
        },
      });
    }

    const seenModels = new Set<string>();
    for (const conn of connections) {
      if (!conn.isActive || isSearchProvider(conn.provider)) continue;
      const spec = getProviderSpec(conn.provider);
      const prefix = getConnectionPrefix(conn);
      const modelIds = Array.from(
        new Set([
          ...(conn.defaultModel ? [conn.defaultModel] : []),
          ...(conn.availableModels || []),
          ...(conn.provider === "custom" ? [] : spec.models.map((m) => m.id)),
        ])
      ).slice(0, 12);

      for (const mId of modelIds) {
        const fullId = `${prefix}/${mId}`;
        if (seenModels.has(fullId)) continue;
        seenModels.add(fullId);
        list.push({
          id: `model:${fullId}`,
          title: fullId,
          subtitle: `Test in Playground · ${conn.name || spec.label}`,
          group: "Models & Combos",
          keywords: `${fullId} ${conn.name} ${spec.label} model playground`,
          icon: Cpu,
          accent: "#C084FC",
          onSelect: () => {
            onOpenPlaygroundModel(fullId);
            onClose();
          },
        });
      }
    }

    return list;
  }, [
    navItems,
    combos,
    connections,
    onNavigateTab,
    onOpenPlaygroundModel,
    onCreateApiKey,
    onCopyBaseUrl,
    onClearCache,
    onRefreshWorkspace,
    onOpenSettings,
    onClose,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 24);
    const terms = q.split(/\s+/).filter(Boolean);
    return items
      .filter((item) => {
        const haystack =
          `${item.title} ${item.subtitle || ""} ${item.group} ${item.keywords || ""}`.toLowerCase();
        return terms.every((t) => haystack.includes(t));
      })
      .slice(0, 30);
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector<HTMLElement>(
      `[data-cmd-index="${activeIndex}"]`
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
    } else if (e.key === "Enter" && filtered[activeIndex]) {
      e.preventDefault();
      filtered[activeIndex].onSelect();
    }
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-start justify-center pt-[12vh] px-4"
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -6 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-xl bg-[#101422] border border-[#2B334E] rounded-2xl shadow-2xl overflow-hidden outline-none"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2B334E] bg-[#171C2E]/80">
          <Search className="w-4 h-4 text-indigo-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a tab, run an action, or test a model..."
            aria-label="Search commands"
            className="flex-1 bg-transparent text-sm text-white placeholder-[#71717A] focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="text-[#71717A] hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Command results"
          className="max-h-[52vh] overflow-y-auto py-2 px-2 space-y-1"
        >
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#71717A]">
              No matching pages, models, or actions.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === activeIndex;
              const prevGroup = idx > 0 ? filtered[idx - 1].group : null;
              const showGroup = item.group !== prevGroup;
              return (
                <React.Fragment key={item.id}>
                  {showGroup && (
                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-cmd-index={idx}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.onSelect}
                    className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-left transition-colors ${
                      isSelected
                        ? "bg-[#1F263D] text-white border border-[#343E5E]"
                        : "text-[#D4D4D8] border border-transparent hover:bg-[#171C2E]"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className="w-4 h-4 shrink-0"
                        style={{ color: item.accent || "#818CF8" }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">
                          {item.title}
                        </div>
                        {item.subtitle && (
                          <div className="text-[11px] text-[#71717A] truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-indigo-300 shrink-0">
                        {item.group === "Models & Combos" ? (
                          <Terminal className="w-3 h-3" />
                        ) : (
                          <ArrowRight className="w-3 h-3" />
                        )}
                      </span>
                    )}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-[#2B334E] bg-[#171C2E]/60 flex items-center justify-between text-[10px] text-[#71717A] font-mono">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>Esc Close</span>
          </div>
          <span>⌘K / Ctrl+K</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
