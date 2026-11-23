import React, { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Check, Copy, Search } from "lucide-react";
import {
  getConnectionPrefix,
  getProviderSpec,
  isSearchProvider,
} from "../shared/catalog.ts";
import { getComboAccent, getProviderVisual } from "../lib/providerVisuals.ts";
import type { Combo, ProviderConnection } from "../types/gateway.ts";

interface ModelsViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  onConnectProvider: () => void;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

interface ModelRow {
  key: string;
  providerKey: string;
  isCombo?: boolean;
  providerName: string;
  modelId: string;
  copyId: string;
}

export function ModelsView({
  combos,
  connections,
  onConnectProvider,
  onNotify,
}: ModelsViewProps) {
  const [query, setQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const rows = useMemo<ModelRow[]>(() => {
    const list: ModelRow[] = [];
    const seen = new Set<string>();

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
      });
    }

    for (const conn of connections) {
      if (!conn.isActive || isSearchProvider(conn.provider)) continue;
      const spec = getProviderSpec(conn.provider);
      const prefix = getConnectionPrefix(conn);
      const providerName =
        conn.provider === "custom" && conn.name ? conn.name : spec.label;

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
                ...(conn.provider === "custom" ? [] : spec.models.map((m) => m.id)),
              ])
            );

      for (const modelId of models) {
        const key = `${prefix}:${modelId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({
          key,
          providerKey: conn.provider,
          providerName,
          modelId,
          copyId: `${prefix}/${modelId}`,
        });
      }
    }

    return list;
  }, [combos, connections]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.modelId.toLowerCase().includes(q) ||
        r.copyId.toLowerCase().includes(q) ||
        r.providerName.toLowerCase().includes(q)
    );
  }, [rows, query]);

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
          <h2 className="font-display text-xl font-semibold text-white">
            Models
          </h2>
          {rows.length > 0 && (
            <span className="text-xs font-mono text-[#A1A1AA]">
              {rows.length}
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter models"
              className="w-full bg-[#171C2E] border border-[#2B334E] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400 transition-colors"
            />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-[#171C2E] border border-[#2B334E] rounded-lg px-6 py-12 text-center space-y-3">
          <div className="text-sm font-medium text-white">
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
        <div className="bg-[#171C2E] border border-[#2B334E] rounded-lg px-6 py-10 text-center text-xs text-[#A1A1AA]">
          No models match your search.
        </div>
      ) : (
        <div className="bg-[#171C2E] border border-[#2B334E] rounded-lg divide-y divide-[#2B334E] overflow-hidden">
          {filtered.map((row, idx) => {
            const isCopied = copiedKey === row.key;
            const visual = row.isCombo
              ? getComboAccent(row.modelId)
              : getProviderVisual(row.providerKey);
            const shortCode = row.isCombo
              ? "CB"
              : getProviderVisual(row.providerKey).short;

            return (
              <motion.button
                key={row.key}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.2,
                  delay: Math.min(idx * 0.015, 0.22),
                }}
                onClick={() => handleCopy(row)}
                className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left hover:bg-[#1F263D]/70 transition-colors group"
              >
                <div className="min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 flex-1">
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
                    <span className="text-xs font-medium text-[#A1A1AA] truncate">
                      {row.providerName}
                    </span>
                  </div>
                  <span className="text-xs sm:text-sm font-mono text-white truncate">
                    {row.copyId}
                  </span>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium shrink-0 transition-colors ${
                    isCopied
                      ? "text-emerald-400"
                      : "text-[#71717A] group-hover:text-sky-400"
                  }`}
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Copy</span>
                    </>
                  )}
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}
