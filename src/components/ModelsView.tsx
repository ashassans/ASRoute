import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, Search, Terminal } from "lucide-react";
import {
  getConnectionPrefix,
  getProviderSpec,
  isSearchProvider,
  type ModelCapability,
} from "../shared/catalog.ts";
import { getComboAccent, getProviderVisual } from "../lib/providerVisuals.ts";
import type { Combo, ProviderConnection } from "../types/gateway.ts";

interface ModelsViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  onConnectProvider: () => void;
  onTestInPlayground?: (modelId: string) => void;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

type CategoryFilter = "all" | "combo" | ModelCapability;

interface ModelRow {
  key: string;
  providerKey: string;
  isCombo?: boolean;
  isBuiltinAuto?: boolean;
  providerName: string;
  modelId: string;
  copyId: string;
  capabilities: ModelCapability[];
  strategyLabel?: string;
}

const FILTER_TABS: Array<{ id: CategoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "combo", label: "Combos" },
  { id: "fast", label: "Fast" },
  { id: "coding", label: "Coding" },
  { id: "reasoning", label: "Reasoning" },
  { id: "vision", label: "Vision" },
  { id: "tools", label: "Tools" },
];

export function ModelsView({
  combos,
  connections,
  onConnectProvider,
  onTestInPlayground,
  onNotify,
}: ModelsViewProps) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const rows = useMemo<ModelRow[]>(() => {
    const list: ModelRow[] = [];
    const seen = new Set<string>();

    const activeLlmConns = connections.filter(
      (c) => c.isActive && !isSearchProvider(c.provider)
    );
    if (activeLlmConns.length > 0) {
      seen.add("builtin:auto");
      list.push({
        key: "builtin:auto",
        providerKey: "as-router",
        isBuiltinAuto: true,
        providerName: "Built-in",
        modelId: "auto",
        copyId: "auto",
        capabilities: ["fast", "coding", "reasoning", "vision", "tools"],
        strategyLabel: `intent_auto · ${activeLlmConns.length} ${
          activeLlmConns.length === 1 ? "provider" : "providers"
        }`,
      });
    }

    for (const combo of combos) {
      if (!combo.isActive) continue;
      const key = `combo:${combo.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        key,
        providerKey: "combo",
        isCombo: true,
        providerName: "Combo",
        modelId: combo.name,
        copyId: combo.name,
        capabilities: [],
        strategyLabel: `${combo.strategy} · ${combo.tiers.length} tiers`,
      });
    }

    for (const conn of connections) {
      if (!conn.isActive || isSearchProvider(conn.provider)) continue;
      const spec = getProviderSpec(conn.provider);
      const prefix = getConnectionPrefix(conn);
      const providerName =
        conn.provider === "custom" && conn.name ? conn.name : spec.label;
      const specCapsById = new Map(
        spec.models.map((m) => [m.id.toLowerCase(), m.capabilities])
      );

      const models =
        conn.availableModels && conn.availableModels.length > 0
          ? Array.from(
              new Set([
                ...(conn.defaultModel ? [conn.defaultModel] : []),
                ...conn.availableModels,
              ])
            )
          : Array.from(
              new Set([
                ...(conn.defaultModel ? [conn.defaultModel] : []),
                ...(conn.provider === "custom"
                  ? []
                  : spec.models.map((m) => m.id)),
              ])
            );

      for (const modelId of models) {
        const key = `${prefix}:${modelId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const lower = modelId.toLowerCase();
        const inferredCaps: ModelCapability[] = specCapsById.get(lower) || [];
        list.push({
          key,
          providerKey: conn.provider,
          providerName,
          modelId,
          copyId: `${prefix}/${modelId}`,
          capabilities: inferredCaps,
        });
      }
    }

    return list;
  }, [combos, connections]);

  const providerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (!map.has(row.providerName)) {
        map.set(row.providerName, row.providerName);
      }
    }
    return Array.from(map.values());
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (categoryFilter === "combo" && !r.isCombo) return false;
      if (
        categoryFilter !== "all" &&
        categoryFilter !== "combo" &&
        !r.capabilities.includes(categoryFilter)
      ) {
        return false;
      }
      if (providerFilter !== "all" && r.providerName !== providerFilter) {
        return false;
      }
      if (!q) return true;
      return (
        r.modelId.toLowerCase().includes(q) ||
        r.copyId.toLowerCase().includes(q) ||
        r.providerName.toLowerCase().includes(q) ||
        r.capabilities.some((c) => c.includes(q))
      );
    });
  }, [rows, query, categoryFilter, providerFilter]);

  const handleCopy = async (row: ModelRow) => {
    try {
      await navigator.clipboard.writeText(row.copyId);
      setCopiedKey(row.key);
      onNotify(`Copied ${row.copyId}`, "success");
      setTimeout(() => {
        setCopiedKey((prev) => (prev === row.key ? null : prev));
      }, 1500);
    } catch {
      onNotify("Clipboard access denied", "error");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-xl font-semibold text-ink">
            Models
          </h2>
          {rows.length > 0 && (
            <span className="text-xs font-mono text-ink-muted">
              {filtered.length === rows.length
                ? rows.length
                : `${filtered.length} / ${rows.length}`}
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {providerOptions.length > 1 && (
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                aria-label="Filter by provider"
                className="bg-surface border border-hairline rounded-lg px-2.5 py-1.5 text-xs text-ink-2 focus:outline-none focus:border-indigo-400"
              >
                <option value="all">All Providers</option>
                {providerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-ink-dim absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models, combos, or providers..."
                aria-label="Filter models"
                className="w-full bg-surface border border-hairline rounded-lg pl-8 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="inline-flex items-center gap-1 p-1 bg-surface border border-hairline rounded-lg overflow-x-auto max-w-full">
          {FILTER_TABS.map((tab) => {
            const active = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`relative px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  active ? "text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="models-filter-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className="absolute inset-0 bg-elevated rounded-md"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-lg px-6 py-12 text-center space-y-3">
          <div className="text-sm font-medium text-ink">
            No connected models yet
          </div>
          <button
            type="button"
            onClick={onConnectProvider}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors"
          >
            Connect Provider
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-lg px-6 py-10 text-center space-y-2">
          <div className="text-xs text-ink-muted">
            No models match your active filters.
          </div>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setCategoryFilter("all");
              setProviderFilter("all");
            }}
            className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="bg-surface border border-hairline rounded-lg divide-y divide-hairline overflow-hidden">
          {filtered.map((row, idx) => {
            const isCopied = copiedKey === row.key;
            const visual = row.isBuiltinAuto
              ? {
                  color: "#6366F1",
                  softBg: "rgba(99, 102, 241, 0.14)",
                  border: "rgba(99, 102, 241, 0.35)",
                  short: "AS",
                }
              : row.isCombo
                ? getComboAccent(row.modelId)
                : getProviderVisual(row.providerKey);
            const shortCode = row.isBuiltinAuto
              ? "AS"
              : row.isCombo
                ? "CB"
                : getProviderVisual(row.providerKey).short;

            return (
              <motion.div
                key={row.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(idx * 0.012, 0.2),
                }}
                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-elevated/55 transition-colors"
              >
                <div className="min-w-0 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 flex-1">
                  <div className="flex items-center gap-2 sm:w-44 shrink-0 min-w-0">
                    <span
                      className="w-5 h-5 rounded border flex items-center justify-center font-mono text-[10px] font-bold shrink-0"
                      style={{
                        color: visual.color,
                        backgroundColor: visual.softBg,
                        borderColor: visual.border,
                      }}
                    >
                      {shortCode}
                    </span>
                    <span className="text-xs font-medium text-ink-muted truncate">
                      {row.providerName}
                    </span>
                  </div>

                  <div className="min-w-0 flex flex-wrap items-center gap-2">
                    <span className="text-xs sm:text-sm font-mono text-ink truncate">
                      {row.copyId}
                    </span>
                    {row.strategyLabel && (
                      <span className="text-[10px] font-mono text-pink-300/90 bg-pink-500/10 border border-pink-500/25 px-1.5 py-0.5 rounded">
                        {row.strategyLabel}
                      </span>
                    )}
                    {row.capabilities.slice(0, 4).map((cap) => (
                      <span
                        key={cap}
                        className="hidden md:inline-block text-[10px] font-mono text-ink-muted bg-canvas border border-hairline px-1.5 py-0.5 rounded"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopy(row)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      isCopied
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-hairline bg-canvas text-ink-2 hover:text-ink hover:border-hairline-strong"
                    }`}
                  >
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-ink-muted" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  {onTestInPlayground && (
                    <button
                      type="button"
                      onClick={() => onTestInPlayground(row.copyId)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-indigo-500/35 bg-indigo-500/12 text-indigo-300 hover:bg-indigo-500/20 hover:text-ink transition-colors whitespace-nowrap"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Test</span>
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
