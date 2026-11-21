import React, { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { getProviderSpec } from "../shared/catalog.ts";
import type { Combo, ProviderConnection } from "../types/gateway.ts";

interface ModelsViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  onConnectProvider: () => void;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

interface ModelRow {
  key: string;
  providerName: string;
  modelId: string;
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
        providerName: "Combo",
        modelId: combo.name,
      });
    }

    for (const conn of connections) {
      if (!conn.isActive) continue;
      const spec = getProviderSpec(conn.provider);
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
                ...spec.models.map((m) => m.id),
              ])
            );

      for (const modelId of models) {
        const key = `${conn.provider}:${modelId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ key, providerName, modelId });
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
        r.providerName.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const handleCopy = async (row: ModelRow) => {
    try {
      await navigator.clipboard.writeText(row.modelId);
      setCopiedKey(row.key);
      onNotify(`Copied ${row.modelId}`, "success");
      setTimeout(() => {
        setCopiedKey((prev) => (prev === row.key ? null : prev));
      }, 1500);
    } catch {
      onNotify("Failed to copy Model ID", "error");
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
              className="w-full bg-[#111114] border border-[#222227] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400 transition-colors"
            />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-lg px-6 py-12 text-center space-y-3">
          <div className="text-sm font-medium text-white">
            No connected models yet
          </div>
          <button
            type="button"
            onClick={onConnectProvider}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors"
          >
            Connect Provider
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-lg px-6 py-10 text-center text-xs text-[#A1A1AA]">
          No models match your search.
        </div>
      ) : (
        <div className="bg-[#111114] border border-[#222227] rounded-lg divide-y divide-[#222227] overflow-hidden">
          {filtered.map((row) => {
            const isCopied = copiedKey === row.key;
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => handleCopy(row)}
                className="w-full px-4 py-3 flex items-center justify-between gap-4 text-left hover:bg-[#18181B]/70 transition-colors group"
              >
                <div className="min-w-0 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 flex-1">
                  <span className="text-xs font-medium text-[#A1A1AA] sm:w-36 shrink-0 truncate">
                    {row.providerName}
                  </span>
                  <span className="text-xs sm:text-sm font-mono text-white truncate">
                    {row.modelId}
                  </span>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-medium shrink-0 transition-colors ${
                    isCopied
                      ? "text-emerald-400"
                      : "text-[#71717A] group-hover:text-amber-400"
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
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
