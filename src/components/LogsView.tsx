import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  Copy,
  Download,
  Pause,
  Play,
  RotateCcw,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { getProviderVisual } from "../lib/providerVisuals.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import type { FallbackHop, RequestLog } from "../types/gateway.ts";

interface LogsViewProps {
  logs: RequestLog[];
  hasMoreLogs?: boolean;
  loadingMoreLogs?: boolean;
  sseConnected: boolean;
  streamPaused: boolean;
  onTogglePause: () => void;
  onLoadMoreLogs?: () => Promise<void>;
  onClearLogs: () => Promise<void>;
  onOpenPlayground?: () => void;
  onReplayInPlayground?: (modelId: string) => void;
}

function parseHops(raw: string): FallbackHop[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function downloadBlob(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function LogsView({
  logs,
  hasMoreLogs = false,
  loadingMoreLogs = false,
  sseConnected,
  streamPaused,
  onTogglePause,
  onLoadMoreLogs,
  onClearLogs,
  onOpenPlayground,
  onReplayInPlayground,
}: LogsViewProps) {
  const [filter, setFilter] = useState<"all" | "success" | "fallback" | "error">(
    "all"
  );
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedTrace, setCopiedTrace] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(drawerRef, Boolean(selectedLog));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedLog) setSelectedLog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLog]);

  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.resolvedProvider) set.add(log.resolvedProvider);
    }
    return Array.from(set).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((log) => {
      if (
        filter === "success" &&
        log.outcome !== "success" &&
        log.outcome !== "cache_hit"
      )
        return false;
      if (filter === "fallback" && log.outcome !== "fallback_success")
        return false;
      if (
        filter === "error" &&
        log.outcome !== "error" &&
        log.outcome !== "rate_limited"
      )
        return false;
      if (
        providerFilter !== "all" &&
        log.resolvedProvider !== providerFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        log.requestedModel.toLowerCase().includes(q) ||
        log.resolvedModel.toLowerCase().includes(q) ||
        log.resolvedProvider.toLowerCase().includes(q) ||
        (log.connectionName || "").toLowerCase().includes(q) ||
        (log.detectedIntent || "").toLowerCase().includes(q) ||
        (log.apiKeyPrefix || "").toLowerCase().includes(q) ||
        (log.errorMessage || "").toLowerCase().includes(q)
      );
    });
  }, [logs, filter, providerFilter, query]);

  const selectedHops = selectedLog
    ? parseHops(selectedLog.fallbackAttempts)
    : [];

  const handleExportCsv = () => {
    const headers = [
      "id",
      "createdAt",
      "statusCode",
      "outcome",
      "requestedModel",
      "resolvedProvider",
      "resolvedModel",
      "connectionName",
      "detectedIntent",
      "promptTokens",
      "completionTokens",
      "estimatedCostUsd",
      "latencyMs",
      "errorMessage",
    ];
    const escapeCsv = (val: unknown) => {
      const str = String(val ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const rows = filtered.map((l) =>
      [
        l.id,
        l.createdAt,
        l.statusCode,
        l.outcome,
        l.requestedModel,
        l.resolvedProvider,
        l.resolvedModel,
        l.connectionName || "",
        l.detectedIntent || "",
        l.promptTokens,
        l.completionTokens,
        l.estimatedCostUsd,
        l.latencyMs,
        l.errorMessage || "",
      ]
        .map(escapeCsv)
        .join(",")
    );
    downloadBlob(
      `as-router-logs-${new Date().toISOString().slice(0, 10)}.csv`,
      [headers.join(","), ...rows].join("\n"),
      "text/csv;charset=utf-8"
    );
  };

  const handleExportJson = () => {
    downloadBlob(
      `as-router-logs-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(filtered, null, 2),
      "application/json"
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-ink">
          Live Logs
        </h2>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={onTogglePause}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface border border-hairline rounded-lg text-ink-2 hover:text-ink whitespace-nowrap shrink-0"
          >
            {streamPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-indigo-400" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-emerald-400" />
                <span>{sseConnected ? "Live" : "Connecting..."}</span>
              </>
            )}
          </button>

          {filtered.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-elevated border border-hairline rounded-lg text-ink-2 hover:text-ink whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-elevated border border-hairline rounded-lg text-ink-2 hover:text-ink whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-ink-muted" />
                <span>JSON</span>
              </button>
            </>
          )}

          {logs.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  return;
                }
                setConfirmClear(false);
                await onClearLogs();
              }}
              onBlur={() => setConfirmClear(false)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                confirmClear
                  ? "text-red-300 underline underline-offset-2"
                  : "text-ink-muted hover:text-red-400"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{confirmClear ? "Confirm Clear?" : "Clear"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 p-1 bg-surface border border-hairline rounded-lg self-start overflow-x-auto max-w-full">
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
                className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  filter === id
                    ? "text-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {filter === id && (
                  <motion.span
                    layoutId="logs-filter-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className="absolute inset-0 bg-elevated rounded-md"
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            ))}
          </div>

          {providerOptions.length > 1 && (
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              aria-label="Filter logs by provider"
              className="bg-surface border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink-2 focus:outline-none focus:border-indigo-400"
            >
              <option value="all">All Providers</option>
              {providerOptions.map((prov) => (
                <option key={prov} value={prov}>
                  {prov}
                </option>
              ))}
            </select>
          )}

          {logs.length > 0 && (
            <span className="text-[11px] font-mono text-ink-dim tabular-nums">
              {filtered.length === logs.length
                ? `${logs.length} traces`
                : `${filtered.length} / ${logs.length}`}
            </span>
          )}
        </div>

        <div className="relative lg:w-72">
          <Search className="w-3.5 h-3.5 text-ink-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by model, provider, key, error..."
            aria-label="Search logs"
            className="w-full bg-surface border border-hairline rounded-lg pl-8 pr-3 py-2 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-400"
          />
        </div>
      </div>

      {/* Logs Table / Mobile Cards */}
      <div className="bg-surface border border-hairline rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-ink">
              {logs.length === 0 ? "No request logs yet" : "No matching logs"}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {logs.length === 0
                ? "Send a prompt in the Playground or hit your gateway endpoint to see real-time traces."
                : "Try adjusting your status filter or search query."}
            </p>
            {logs.length === 0 && onOpenPlayground && (
              <button
                type="button"
                onClick={onOpenPlayground}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors whitespace-nowrap"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Open Playground</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="md:hidden divide-y divide-hairline">
              {filtered.map((log) => {
                const statusColor =
                  log.outcome === "cache_hit"
                    ? "text-sky-400"
                    : log.outcome === "success"
                      ? "text-emerald-400"
                      : log.outcome === "fallback_success"
                        ? "text-amber-400"
                        : "text-red-400";
                const statusText =
                  log.outcome === "cache_hit"
                    ? `${log.statusCode} Cache Hit`
                    : log.outcome === "fallback_success"
                      ? `${log.statusCode} Fallback`
                      : `${log.statusCode} ${
                          log.outcome === "success" ? "OK" : "Error"
                        }`;
                const totalTok = log.promptTokens + log.completionTokens;
                const provVisual = getProviderVisual(log.resolvedProvider);

                return (
                  <motion.button
                    key={log.id}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => setSelectedLog(log)}
                    className="w-full text-left p-4 hover:bg-elevated/70 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`font-mono font-medium ${statusColor}`}>
                        {statusText}
                      </span>
                      <span className="font-mono text-ink-muted tabular-nums">
                        {new Date(log.createdAt).toLocaleTimeString()} · {log.latencyMs}ms
                      </span>
                    </div>
                    <div className="font-mono text-xs text-ink truncate">
                      <span style={{ color: provVisual.color }}>
                        {log.resolvedProvider}
                      </span>
                      <span className="text-ink-dim">/</span>
                      <span>{log.resolvedModel}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-ink-muted tabular-nums">
                      <span className="truncate">req: {log.requestedModel}</span>
                      <span>
                        {totalTok.toLocaleString()} tok · ${log.estimatedCostUsd.toFixed(5)}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-hairline text-xs text-ink-muted">
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
              <tbody className="divide-y divide-hairline text-xs">
                {filtered.map((log) => {
                  const statusColor =
                    log.outcome === "cache_hit"
                      ? "text-sky-400"
                      : log.outcome === "success"
                        ? "text-emerald-400"
                        : log.outcome === "fallback_success"
                          ? "text-amber-400"
                          : "text-red-400";
                  const statusText =
                    log.outcome === "cache_hit"
                      ? `${log.statusCode} Cache Hit`
                      : log.outcome === "fallback_success"
                        ? `${log.statusCode} Fallback`
                        : `${log.statusCode} ${
                            log.outcome === "success" ? "OK" : "Error"
                          }`;
                  const hops = parseHops(log.fallbackAttempts);
                  const totalTok = log.promptTokens + log.completionTokens;
                  const provVisual = getProviderVisual(log.resolvedProvider);

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="h-10 hover:bg-elevated/70 cursor-pointer transition-colors"
                    >
                      <td className="py-2 px-4 font-mono text-ink-muted tabular-nums whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </td>
                      <td
                        className={`py-2 px-4 font-mono font-medium whitespace-nowrap ${statusColor}`}
                      >
                        {statusText}
                      </td>
                      <td className="py-2 px-4 font-mono text-ink truncate max-w-[160px]">
                        {log.requestedModel}
                      </td>
                      <td className="py-2 px-4 font-mono text-ink-2 truncate max-w-[220px]">
                        <span
                          className="font-semibold"
                          style={{ color: provVisual.color }}
                        >
                          {log.resolvedProvider}
                        </span>
                        <span className="mx-1 text-ink-muted">/</span>
                        <span>{log.resolvedModel}</span>
                        {hops.length > 1 && (
                          <span className="ml-1.5 text-amber-400">
                            ({hops.length} hops)
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-4 font-mono text-ink-muted whitespace-nowrap">
                        {log.detectedIntent || "—"}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-ink-2 tabular-nums">
                        {totalTok.toLocaleString()}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-ink-muted tabular-nums">
                        ${log.estimatedCostUsd.toFixed(5)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-ink-2 tabular-nums whitespace-nowrap">
                        {log.latencyMs}ms
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {hasMoreLogs && onLoadMoreLogs && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={onLoadMoreLogs}
            disabled={loadingMoreLogs}
            className="px-4 py-2 text-xs font-medium bg-surface hover:bg-elevated disabled:opacity-50 text-ink-2 hover:text-ink border border-hairline rounded-lg transition-colors"
          >
            {loadingMoreLogs ? "Loading older logs..." : "Load More Logs"}
          </button>
        </div>
      )}

      {/* Request Trace Drawer */}
      <AnimatePresence>
        {selectedLog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            onClick={() => setSelectedLog(null)}
            className="fixed inset-0 z-50 bg-black/60 flex justify-end"
          >
            <motion.div
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="trace-inspector-title"
              tabIndex={-1}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-surface border-l border-hairline h-full overflow-y-auto p-6 outline-none"
            >
            <div className="flex items-center justify-between pb-4 border-b border-hairline">
              <div>
                <h3
                  id="trace-inspector-title"
                  className="font-display text-base font-semibold text-ink"
                >
                  Request Trace Inspector
                </h3>
                <div className="font-mono text-xs text-ink-muted mt-0.5">
                  {selectedLog.id}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close trace inspector"
                onClick={() => setSelectedLog(null)}
                className="text-ink-muted hover:text-ink p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {onReplayInPlayground && selectedLog.requestedModel && (
                <button
                  type="button"
                  onClick={() => {
                    const modelToReplay = selectedLog.requestedModel;
                    setSelectedLog(null);
                    onReplayInPlayground(modelToReplay);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Replay in Playground</span>
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify(
                        { ...selectedLog, hops: selectedHops },
                        null,
                        2
                      )
                    );
                    setCopiedTrace(true);
                    setTimeout(() => setCopiedTrace(false), 1500);
                  } catch {
                    // ignore clipboard failure
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-canvas hover:bg-elevated border border-hairline text-ink-2 hover:text-ink rounded-lg transition-colors"
              >
                {copiedTrace ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied Trace JSON</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-ink-muted" />
                    <span>Copy Trace JSON</span>
                  </>
                )}
              </button>
            </div>

            <div className="mt-5 space-y-5 text-xs">
              <div className="grid grid-cols-2 gap-4 bg-canvas border border-hairline rounded-lg p-4">
                <div>
                  <div className="text-ink-muted">Requested Model</div>
                  <div className="mt-1 font-mono text-ink">
                    {selectedLog.requestedModel}
                  </div>
                </div>
                <div>
                  <div className="text-ink-muted">Detected Intent</div>
                  <div className="mt-1 font-mono text-emerald-400">
                    {selectedLog.detectedIntent || "standard"}
                  </div>
                </div>
                <div>
                  <div className="text-ink-muted">API Key</div>
                  <div className="mt-1 font-mono text-ink">
                    {selectedLog.apiKeyPrefix || "Dashboard Playground"}
                  </div>
                </div>
                <div>
                  <div className="text-ink-muted">Tokens (In / Out)</div>
                  <div className="mt-1 font-mono text-ink tabular-nums">
                    {selectedLog.promptTokens} / {selectedLog.completionTokens}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-ink-muted">End-to-End Latency & Cost</div>
                  <div className="mt-1 font-mono text-ink tabular-nums">
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
                <h4 className="font-medium text-ink-2 mb-2">
                  Routing & Fallback Execution Trace ({selectedHops.length})
                </h4>
                {selectedHops.length === 0 ? (
                  <p className="text-ink-muted">No hop trace recorded.</p>
                ) : (
                  <div className="border border-hairline rounded-lg divide-y divide-hairline bg-canvas">
                    {selectedHops.map((hop, idx) => (
                      <div key={idx} className="p-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-ink">
                            #{idx + 1} {hop.connectionName} ({hop.provider} /{" "}
                            {hop.model})
                          </span>
                          <span
                            className={`font-mono ${
                              hop.status === "success"
                                ? "text-emerald-400"
                                : hop.status === "failed"
                                  ? "text-red-400"
                                  : "text-ink-muted"
                            }`}
                          >
                            {hop.status}
                            {hop.statusCode ? ` · ${hop.statusCode}` : ""}
                          </span>
                        </div>
                        <div className="text-ink-muted font-mono break-words">
                          {hop.reason} · {hop.latencyMs}ms
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
