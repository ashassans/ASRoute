import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import {
  getConnectionPrefix,
  getProviderSpec,
  isSearchProvider,
  type ModelCapability,
} from "../shared/catalog.ts";
import { getComboAccent, getProviderVisual } from "../lib/providerVisuals.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import type {
  BootstrapPayload,
  Combo,
  ProviderConnection,
} from "../types/gateway.ts";

interface ModelsViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  onConnectProvider: () => void;
  onTestInPlayground?: (modelId: string) => void;
  onUpdateWorkspace?: React.Dispatch<
    React.SetStateAction<BootstrapPayload | null>
  >;
  onRefresh?: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

type CategoryFilter = "all" | "combo" | ModelCapability;
type CheckStatusFilter = "all" | "working" | "failed";

interface ModelRow {
  key: string;
  connectionId?: string;
  providerKey: string;
  isCombo?: boolean;
  isBuiltinAuto?: boolean;
  providerName: string;
  modelId: string;
  copyId: string;
  capabilities: ModelCapability[];
  strategyLabel?: string;
}

interface ModelCheckState {
  status: "queued" | "checking" | "ok" | "error";
  latencyMs?: number;
  error?: string;
  testedAt?: string;
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

function getCheckKey(row: ModelRow): string {
  return row.connectionId ? `${row.connectionId}:${row.modelId}` : row.key;
}

export function ModelsView({
  combos,
  connections,
  onConnectProvider,
  onTestInPlayground,
  onUpdateWorkspace,
  onRefresh,
  onNotify,
}: ModelsViewProps) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<CheckStatusFilter>("all");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [confirmCheckOpen, setConfirmCheckOpen] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkResults, setCheckResults] = useState<
    Record<string, ModelCheckState>
  >({});
  const [deletingKeys, setDeletingKeys] = useState<Set<string>>(new Set());
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const confirmModalRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useFocusTrap(confirmModalRef, confirmCheckOpen);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!confirmCheckOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmCheckOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmCheckOpen]);

  const rows = useMemo<ModelRow[]>(() => {
    const list: ModelRow[] = [];
    const seen = new Set<string>();

    const activeLlmConns = connections.filter(
      (c) => c.isActive && !isSearchProvider(c.provider)
    );
    const activeComboNames = new Set(
      combos.filter((c) => c.isActive).map((c) => c.name.trim().toLowerCase())
    );
    if (activeLlmConns.length > 0) {
      if (!activeComboNames.has("auto")) {
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
      if (!activeComboNames.has("claude")) {
        seen.add("builtin:claude");
        list.push({
          key: "builtin:claude",
          providerKey: "as-router",
          isBuiltinAuto: true,
          providerName: "Built-in",
          modelId: "claude",
          copyId: "claude",
          capabilities: ["coding", "reasoning", "vision", "tools"],
          strategyLabel: `best_model · ${activeLlmConns.length} ${
            activeLlmConns.length === 1 ? "provider" : "providers"
          }`,
        });
      }
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
          connectionId: conn.id,
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

  const checkableRows = useMemo(
    () =>
      rows.filter(
        (r) => Boolean(r.connectionId) && !r.isCombo && !r.isBuiltinAuto
      ),
    [rows]
  );

  const checkableProviderCount = useMemo(
    () => new Set(checkableRows.map((r) => r.connectionId)).size,
    [checkableRows]
  );

  const checkStats = useMemo(() => {
    let total = 0;
    let working = 0;
    let failed = 0;
    let pending = 0;
    const failedRows: ModelRow[] = [];

    for (const row of checkableRows) {
      const st = checkResults[getCheckKey(row)];
      if (!st) continue;
      total += 1;
      if (st.status === "ok") working += 1;
      else if (st.status === "error") {
        failed += 1;
        failedRows.push(row);
      } else pending += 1;
    }

    return {
      total,
      done: working + failed,
      working,
      failed,
      pending,
      failedRows,
    };
  }, [checkableRows, checkResults]);

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
      if (statusFilter !== "all") {
        const st = checkResults[getCheckKey(r)];
        if (statusFilter === "working" && st?.status !== "ok") return false;
        if (statusFilter === "failed" && st?.status !== "error") return false;
      }
      if (!q) return true;
      return (
        r.modelId.toLowerCase().includes(q) ||
        r.copyId.toLowerCase().includes(q) ||
        r.providerName.toLowerCase().includes(q) ||
        r.capabilities.some((c) => c.includes(q))
      );
    });
  }, [
    rows,
    query,
    categoryFilter,
    providerFilter,
    statusFilter,
    checkResults,
  ]);

  const applyConnectionUpdate = (updated?: ProviderConnection) => {
    if (!updated) return;
    if (onUpdateWorkspace) {
      onUpdateWorkspace((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          connections: prev.connections.map((c) =>
            c.id === updated.id ? updated : c
          ),
        };
      });
    }
  };

  const runCheckModels = async (targetRows: ModelRow[]) => {
    if (targetRows.length === 0 || checkingAll) return;

    setConfirmCheckOpen(false);
    setConfirmDeleteAllOpen(false);
    setCheckingAll(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Reset/initialize status for target rows
    setCheckResults((prev) => {
      const next = targetRows.length === checkableRows.length ? {} : { ...prev };
      for (const row of targetRows) {
        next[getCheckKey(row)] = { status: "queued" };
      }
      return next;
    });

    // Group into batches of 3 per connectionId so modelHealth updates on a connection never race
    const batchesByConn = new Map<string, ModelRow[][]>();
    for (const row of targetRows) {
      if (!row.connectionId) continue;
      const list = batchesByConn.get(row.connectionId) || [];
      const lastBatch = list[list.length - 1];
      if (!lastBatch || lastBatch.length >= 3) {
        list.push([row]);
      } else {
        lastBatch.push(row);
      }
      batchesByConn.set(row.connectionId, list);
    }

    const connectionQueues = Array.from(batchesByConn.entries()).map(
      ([connectionId, batches]) => ({ connectionId, batches, idx: 0 })
    );

    let queueCursor = 0;
    let workingCount = 0;
    let failedCount = 0;
    let stopped = false;

    const runConnectionQueue = async (entry: {
      connectionId: string;
      batches: ModelRow[][];
    }) => {
      for (const batch of entry.batches) {
        if (controller.signal.aborted) {
          stopped = true;
          break;
        }

        setCheckResults((prev) => {
          const next = { ...prev };
          for (const r of batch) {
            next[getCheckKey(r)] = { status: "checking" };
          }
          return next;
        });

        try {
          const res = await fetch(
            `/api/providers/${encodeURIComponent(entry.connectionId)}/test-models`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ models: batch.map((r) => r.modelId) }),
              signal: controller.signal,
            }
          );

          const data = (await res.json()) as {
            error?: string;
            results?: Array<{
              model: string;
              ok: boolean;
              latencyMs?: number;
              testedAt?: string;
              error?: string;
            }>;
            connection?: ProviderConnection;
          };

          if (!res.ok) {
            const errMsg = data.error || `HTTP ${res.status}`;
            setCheckResults((prev) => {
              const next = { ...prev };
              for (const r of batch) {
                next[getCheckKey(r)] = { status: "error", error: errMsg };
              }
              return next;
            });
            failedCount += batch.length;
            continue;
          }

          if (data.connection) {
            applyConnectionUpdate(data.connection);
          }

          const byModel = new Map(
            (data.results || []).map((item) => [item.model, item])
          );
          setCheckResults((prev) => {
            const next = { ...prev };
            for (const r of batch) {
              const item = byModel.get(r.modelId);
              if (item) {
                next[getCheckKey(r)] = {
                  status: item.ok ? "ok" : "error",
                  latencyMs: item.latencyMs,
                  error: item.error,
                  testedAt: item.testedAt,
                };
                if (item.ok) workingCount += 1;
                else failedCount += 1;
              } else {
                next[getCheckKey(r)] = {
                  status: "error",
                  error: "No result returned",
                };
                failedCount += 1;
              }
            }
            return next;
          });
        } catch (err: unknown) {
          if (controller.signal.aborted) {
            stopped = true;
            break;
          }
          const msg =
            err instanceof Error ? err.message : "Network error checking model";
          setCheckResults((prev) => {
            const next = { ...prev };
            for (const r of batch) {
              next[getCheckKey(r)] = { status: "error", error: msg };
            }
            return next;
          });
          failedCount += batch.length;
        }
      }
    };

    const workerCount = Math.min(4, connectionQueues.length);
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (queueCursor < connectionQueues.length) {
          if (controller.signal.aborted) {
            stopped = true;
            break;
          }
          const current = connectionQueues[queueCursor];
          queueCursor += 1;
          if (current) {
            await runConnectionQueue(current);
          }
        }
      })
    );

    if (stopped || controller.signal.aborted) {
      setCheckResults((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (
            next[k].status === "queued" ||
            next[k].status === "checking"
          ) {
            delete next[k];
          }
        }
        return next;
      });
      onNotify(
        `Check stopped (${workingCount} working, ${failedCount} failed).`,
        failedCount > 0 ? "error" : "success"
      );
    } else {
      onNotify(
        `Checked ${workingCount + failedCount} models: ${workingCount} working, ${failedCount} failed.`,
        failedCount > 0 ? "error" : "success"
      );
    }

    abortRef.current = null;
    setCheckingAll(false);
  };

  const handleStopCheck = () => {
    abortRef.current?.abort();
  };

  const handleDeleteModel = async (row: ModelRow) => {
    if (!row.connectionId) return;
    const ck = getCheckKey(row);
    setDeletingKeys((prev) => new Set(prev).add(ck));

    try {
      const res = await fetch(
        `/api/providers/${encodeURIComponent(row.connectionId)}/remove-models`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ models: [row.modelId] }),
        }
      );
      const data = (await res.json()) as {
        error?: string;
        deactivated?: boolean;
        connection?: ProviderConnection;
      };
      if (!res.ok) {
        onNotify(data.error || "Failed to delete model.", "error");
        return;
      }

      if (data.connection) {
        applyConnectionUpdate(data.connection);
      } else if (onRefresh) {
        await onRefresh();
      }

      setCheckResults((prev) => {
        const next = { ...prev };
        delete next[ck];
        return next;
      });

      onNotify(
        data.deactivated
          ? `Removed ${row.copyId} and deactivated ${row.providerName} (no models left).`
          : `Removed ${row.copyId}.`,
        "success"
      );
    } catch {
      onNotify("Network error deleting model.", "error");
    } finally {
      setDeletingKeys((prev) => {
        const next = new Set(prev);
        next.delete(ck);
        return next;
      });
    }
  };

  const handleDeleteAllFailed = async () => {
    if (checkStats.failedRows.length === 0 || bulkDeleting) return;
    setBulkDeleting(true);

    const byConn = new Map<string, ModelRow[]>();
    for (const row of checkStats.failedRows) {
      if (!row.connectionId) continue;
      const arr = byConn.get(row.connectionId) || [];
      arr.push(row);
      byConn.set(row.connectionId, arr);
    }

    let removedTotal = 0;
    let errorCount = 0;
    const removedKeys: string[] = [];

    for (const [connId, failedList] of byConn.entries()) {
      try {
        const res = await fetch(
          `/api/providers/${encodeURIComponent(connId)}/remove-models`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              models: failedList.map((r) => r.modelId),
            }),
          }
        );
        const data = (await res.json()) as {
          removedCount?: number;
          connection?: ProviderConnection;
        };
        if (res.ok) {
          removedTotal += data.removedCount ?? failedList.length;
          for (const r of failedList) {
            removedKeys.push(getCheckKey(r));
          }
          if (data.connection) {
            applyConnectionUpdate(data.connection);
          }
        } else {
          errorCount += failedList.length;
        }
      } catch {
        errorCount += failedList.length;
      }
    }

    if (!onUpdateWorkspace && onRefresh) {
      await onRefresh();
    }

    setCheckResults((prev) => {
      const next = { ...prev };
      for (const k of removedKeys) {
        delete next[k];
      }
      return next;
    });

    setConfirmDeleteAllOpen(false);
    setBulkDeleting(false);
    if (statusFilter === "failed" && errorCount === 0) {
      setStatusFilter("all");
    }

    if (errorCount > 0) {
      onNotify(
        `Deleted ${removedTotal} failed models; ${errorCount} could not be removed.`,
        "error"
      );
    } else {
      onNotify(`Deleted ${removedTotal} failed model(s).`, "success");
    }
  };

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

  const progressPct =
    checkStats.total > 0
      ? Math.round((checkStats.done / checkStats.total) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-xl font-semibold text-ink">
            Models
          </h2>
          {rows.length > 0 && (
            <span className="text-xs font-mono tabular-nums text-ink-muted">
              {filtered.length === rows.length
                ? rows.length
                : `${filtered.length} / ${rows.length}`}
            </span>
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-wrap">
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

            <div className="relative w-full sm:w-60">
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

            {checkableRows.length > 0 &&
              (checkingAll ? (
                <button
                  type="button"
                  onClick={handleStopCheck}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 bg-red-500/12 text-red-300 hover:bg-red-500/20 transition-colors whitespace-nowrap shrink-0"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span className="tabular-nums">
                    Stop ({checkStats.done}/{checkStats.total})
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmCheckOpen(true)}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors whitespace-nowrap shrink-0"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Check All Models</span>
                </button>
              ))}
          </div>
        )}
      </div>

      {checkStats.total > 0 && (
        <div className="bg-surface border border-hairline rounded-lg px-4 py-3 space-y-2.5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono tabular-nums">
              {checkingAll ? (
                <span className="inline-flex items-center gap-1.5 font-sans font-medium text-indigo-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    Checking {checkStats.done} / {checkStats.total}
                  </span>
                </span>
              ) : (
                <span className="font-sans font-medium text-ink">
                  Checked {checkStats.done} / {checkStats.total}
                </span>
              )}
              <span className="text-ink-dim" aria-hidden="true">
                ·
              </span>
              <span className="text-emerald-400">
                {checkStats.working} working
              </span>
              <span className="text-ink-dim" aria-hidden="true">
                ·
              </span>
              <span
                className={
                  checkStats.failed > 0 ? "text-red-400" : "text-ink-muted"
                }
              >
                {checkStats.failed} failed
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1 p-0.5 bg-canvas border border-hairline rounded-lg">
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "working", label: `Working (${checkStats.working})` },
                    { id: "failed", label: `Failed (${checkStats.failed})` },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStatusFilter(opt.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap tabular-nums ${
                      statusFilter === opt.id
                        ? "bg-elevated text-ink"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {!checkingAll && checkStats.failed > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => runCheckModels(checkStats.failedRows)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-hairline bg-canvas text-ink-2 hover:text-ink hover:border-hairline-strong transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Re-check Failed</span>
                  </button>

                  {confirmDeleteAllOpen ? (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={bulkDeleting}
                        onClick={handleDeleteAllFailed}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white transition-colors whitespace-nowrap shrink-0"
                      >
                        {bulkDeleting ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        <span>
                          Confirm Delete ({checkStats.failed})
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={bulkDeleting}
                        onClick={() => setConfirmDeleteAllOpen(false)}
                        className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-hairline bg-canvas text-ink-muted hover:text-ink transition-colors whitespace-nowrap"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAllOpen(true)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete All Failed ({checkStats.failed})</span>
                    </button>
                  )}
                </>
              )}

              {!checkingAll && (
                <button
                  type="button"
                  onClick={() => {
                    setCheckResults({});
                    setStatusFilter("all");
                    setConfirmDeleteAllOpen(false);
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {checkingAll && (
            <div className="h-1.5 w-full bg-canvas rounded-full overflow-hidden border border-hairline">
              <div
                className="h-full bg-indigo-500 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      )}

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
              setStatusFilter("all");
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
            const checkKey = getCheckKey(row);
            const checkState = row.connectionId
              ? checkResults[checkKey]
              : undefined;
            const isDeleting = deletingKeys.has(checkKey);

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
                <div className="min-w-0 flex flex-col gap-1 flex-1">
                  <div className="min-w-0 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
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

                  {checkState?.status === "error" && checkState.error && (
                    <div className="sm:pl-48 text-[11px] font-mono text-red-400/90 break-words">
                      {checkState.error}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {checkState && (
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums mr-1 whitespace-nowrap ${
                        checkState.status === "ok"
                          ? "text-emerald-400"
                          : checkState.status === "error"
                            ? "text-red-400"
                            : checkState.status === "checking"
                              ? "text-indigo-400"
                              : "text-ink-dim"
                      }`}
                    >
                      {checkState.status === "ok" && (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Working
                            {typeof checkState.latencyMs === "number"
                              ? ` · ${checkState.latencyMs}ms`
                              : ""}
                          </span>
                        </>
                      )}
                      {checkState.status === "error" && (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Error</span>
                        </>
                      )}
                      {checkState.status === "checking" && (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          <span>Checking</span>
                        </>
                      )}
                      {checkState.status === "queued" && <span>Queued</span>}
                    </span>
                  )}

                  {checkState?.status === "error" && row.connectionId && (
                    <button
                      type="button"
                      disabled={isDeleting || bulkDeleting}
                      onClick={() => handleDeleteModel(row)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                      <span>Delete</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleCopy(row)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
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

      <AnimatePresence>
        {confirmCheckOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setConfirmCheckOpen(false)}
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              ref={confirmModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-check-models-title"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-surface border border-hairline-strong rounded-xl p-5 space-y-4 shadow-2xl outline-none"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3
                    id="confirm-check-models-title"
                    className="font-display text-base font-semibold text-ink"
                  >
                    Check all connected models
                  </h3>
                  <p className="text-xs text-ink-muted leading-relaxed">
                    Send one lightweight request (max 16 tokens) to each of the{" "}
                    <span className="font-mono tabular-nums text-ink font-medium">
                      {checkableRows.length}
                    </span>{" "}
                    connected models across{" "}
                    <span className="font-mono tabular-nums text-ink font-medium">
                      {checkableProviderCount}
                    </span>{" "}
                    {checkableProviderCount === 1 ? "provider" : "providers"}.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close confirmation dialog"
                  onClick={() => setConfirmCheckOpen(false)}
                  className="text-ink-muted hover:text-ink p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="bg-canvas border border-hairline rounded-lg px-3.5 py-2.5 text-xs text-ink-2 space-y-1 leading-relaxed">
                <p>
                  Working models will stay in your list with their response
                  latency.
                </p>
                <p>
                  Models returning errors will show a Delete option individually
                  and a bulk Delete All Failed action.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmCheckOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium rounded-lg border border-hairline bg-canvas text-ink-2 hover:text-ink transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => runCheckModels(checkableRows)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span className="tabular-nums">
                    Confirm &amp; Check ({checkableRows.length})
                  </span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
