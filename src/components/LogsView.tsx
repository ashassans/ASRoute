import React, { useMemo, useState } from "react";
import { Pause, Play, Search, Trash2, X } from "lucide-react";
import type { FallbackHop, RequestLog } from "../types/gateway.ts";

interface LogsViewProps {
  logs: RequestLog[];
  sseConnected: boolean;
  streamPaused: boolean;
  onTogglePause: () => void;
  onClearLogs: () => Promise<void>;
}

function parseHops(raw: string): FallbackHop[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function LogsView({
  logs,
  sseConnected,
  streamPaused,
  onTogglePause,
  onClearLogs,
}: LogsViewProps) {
  const [filter, setFilter] = useState<"all" | "success" | "fallback" | "error">(
    "all"
  );
  const [query, setQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (filter === "success" && log.outcome !== "success") return false;
      if (filter === "fallback" && log.outcome !== "fallback_success")
        return false;
      if (
        filter === "error" &&
        log.outcome !== "error" &&
        log.outcome !== "rate_limited"
      )
        return false;
      if (!q) return true;
      return (
        log.requestedModel.toLowerCase().includes(q) ||
        log.resolvedModel.toLowerCase().includes(q) ||
        log.resolvedProvider.toLowerCase().includes(q) ||
        (log.detectedIntent || "").toLowerCase().includes(q) ||
        (log.apiKeyPrefix || "").toLowerCase().includes(q) ||
        (log.errorMessage || "").toLowerCase().includes(q)
      );
    });
  }, [logs, filter, query]);

  const selectedHops = selectedLog
    ? parseHops(selectedLog.fallbackAttempts)
    : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-white">
          Live Logs
        </h2>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={onTogglePause}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-[#111114] border border-[#222227] rounded-lg text-[#D4D4D8] hover:text-white whitespace-nowrap shrink-0"
          >
            {streamPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-amber-400" />
                <span>Resume Stream</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-[#10B981]" />
                <span>
                  {sseConnected ? "Live Stream Active" : "Connecting Stream..."}
                </span>
              </>
            )}
          </button>

          {logs.length > 0 && (
            <button
              type="button"
              onClick={onClearLogs}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#111114] border border-[#222227] rounded-lg text-[#A1A1AA] hover:text-red-400 whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-[#111114] border border-[#222227] rounded-lg self-start">
          {(
            [
              ["all", "All"],
              ["success", "200 OK"],
              ["fallback", "Fallback"],
              ["error", "Errors"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                filter === id
                  ? "bg-[#18181B] text-white"
                  : "text-[#A1A1AA] hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-72">
          <Search className="w-3.5 h-3.5 text-[#A1A1AA] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by model, provider, intent..."
            className="w-full bg-[#111114] border border-[#222227] rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-[#111114] border border-[#222227] rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-[#D4D4D8]">
              {logs.length === 0 ? "No logs" : "No matching logs"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#222227] text-xs text-[#A1A1AA]">
                  <th className="py-2.5 px-4 font-medium">Time</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Requested Model</th>
                  <th className="py-2.5 px-4 font-medium">Resolved Upstream</th>
                  <th className="py-2.5 px-4 font-medium">Intent</th>
                  <th className="py-2.5 px-4 font-medium text-right">Tokens</th>
                  <th className="py-2.5 px-4 font-medium text-right">Cost</th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Latency
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222227] text-xs">
                {filtered.map((log) => {
                  const statusColor =
                    log.outcome === "success"
                      ? "text-emerald-400"
                      : log.outcome === "fallback_success"
                        ? "text-amber-400"
                        : "text-red-400";
                  const statusText =
                    log.outcome === "fallback_success"
                      ? `${log.statusCode} Fallback`
                      : `${log.statusCode} ${
                          log.outcome === "success" ? "OK" : "Error"
                        }`;
                  const hops = parseHops(log.fallbackAttempts);
                  const totalTok = log.promptTokens + log.completionTokens;

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="h-10 hover:bg-[#18181B]/70 cursor-pointer transition-colors"
                    >
                      <td className="py-2 px-4 font-mono text-[#A1A1AA] tabular-nums whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </td>
                      <td
                        className={`py-2 px-4 font-mono font-medium whitespace-nowrap ${statusColor}`}
                      >
                        {statusText}
                      </td>
                      <td className="py-2 px-4 font-mono text-white truncate max-w-[160px]">
                        {log.requestedModel}
                      </td>
                      <td className="py-2 px-4 font-mono text-[#D4D4D8] truncate max-w-[220px]">
                        <span>{log.resolvedProvider}</span>
                        <span className="mx-1 text-[#A1A1AA]">/</span>
                        <span>{log.resolvedModel}</span>
                        {hops.length > 1 && (
                          <span className="ml-1.5 text-amber-400">
                            ({hops.length} hops)
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-4 font-mono text-[#A1A1AA] whitespace-nowrap">
                        {log.detectedIntent || "—"}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-[#D4D4D8] tabular-nums">
                        {totalTok.toLocaleString()}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-[#A1A1AA] tabular-nums">
                        ${log.estimatedCostUsd.toFixed(5)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-[#D4D4D8] tabular-nums whitespace-nowrap">
                        {log.latencyMs}ms
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Request Trace Drawer */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-black/60 flex justify-end">
          <div className="w-full max-w-lg bg-[#111114] border-l border-[#222227] h-full overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#222227]">
              <div>
                <h3 className="font-display text-base font-semibold text-white">
                  Request Trace Inspector
                </h3>
                <div className="font-mono text-xs text-[#A1A1AA] mt-0.5">
                  {selectedLog.id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-[#A1A1AA] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-5 space-y-5 text-xs">
              <div className="grid grid-cols-2 gap-4 bg-[#09090B] border border-[#222227] rounded-lg p-4">
                <div>
                  <div className="text-[#A1A1AA]">Requested Model</div>
                  <div className="mt-1 font-mono text-white">
                    {selectedLog.requestedModel}
                  </div>
                </div>
                <div>
                  <div className="text-[#A1A1AA]">Detected Intent</div>
                  <div className="mt-1 font-mono text-emerald-400">
                    {selectedLog.detectedIntent || "standard"}
                  </div>
                </div>
                <div>
                  <div className="text-[#A1A1AA]">API Key</div>
                  <div className="mt-1 font-mono text-white">
                    {selectedLog.apiKeyPrefix || "Dashboard Playground"}
                  </div>
                </div>
                <div>
                  <div className="text-[#A1A1AA]">Tokens (In / Out)</div>
                  <div className="mt-1 font-mono text-white tabular-nums">
                    {selectedLog.promptTokens} / {selectedLog.completionTokens}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[#A1A1AA]">End-to-End Latency & Cost</div>
                  <div className="mt-1 font-mono text-white tabular-nums">
                    {selectedLog.latencyMs}ms · $
                    {selectedLog.estimatedCostUsd.toFixed(6)}
                  </div>
                </div>
              </div>

              {selectedLog.errorMessage && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 text-red-300 font-mono break-words">
                  {selectedLog.errorMessage}
                </div>
              )}

              <div>
                <h4 className="font-medium text-[#D4D4D8] mb-2">
                  Routing & Fallback Execution Trace ({selectedHops.length})
                </h4>
                {selectedHops.length === 0 ? (
                  <p className="text-[#A1A1AA]">No hop trace recorded.</p>
                ) : (
                  <div className="border border-[#222227] rounded-lg divide-y divide-[#222227] bg-[#09090B]">
                    {selectedHops.map((hop, idx) => (
                      <div key={idx} className="p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-white">
                            #{idx + 1} {hop.connectionName} ({hop.provider} /{" "}
                            {hop.model})
                          </span>
                          <span
                            className={`font-mono ${
                              hop.status === "success"
                                ? "text-emerald-400"
                                : hop.status === "failed"
                                  ? "text-red-400"
                                  : "text-[#A1A1AA]"
                            }`}
                          >
                            {hop.status}
                            {hop.statusCode ? ` · ${hop.statusCode}` : ""}
                          </span>
                        </div>
                        <div className="text-[#A1A1AA] font-mono break-words">
                          {hop.reason} · {hop.latencyMs}ms
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
