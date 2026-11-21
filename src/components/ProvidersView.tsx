import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { PROVIDER_CATALOG, getProviderSpec } from "../shared/catalog.ts";
import { ToggleSwitch } from "./ToggleSwitch.tsx";
import type { BootstrapPayload, ProviderConnection } from "../types/gateway.ts";

interface ProvidersViewProps {
  connections: ProviderConnection[];
  onRefresh: () => Promise<void>;
  onUpdateWorkspace: React.Dispatch<React.SetStateAction<BootstrapPayload | null>>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

function getUtcResetCountdown(): string {
  const now = new Date();
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0
  );
  const diffMin = Math.max(1, Math.floor((nextMidnight - now.getTime()) / 60000));
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return `${hrs}h ${mins}m`;
}

export function ProvidersView({
  connections,
  onRefresh,
  onUpdateWorkspace,
  onNotify,
}: ProvidersViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [provider, setProvider] = useState("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [freeOnly, setFreeOnly] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [extraApiKeys, setExtraApiKeys] = useState("");
  const [clearKeyPool, setClearKeyPool] = useState(false);
  const [editingPoolPreview, setEditingPoolPreview] = useState<string[]>([]);
  const [rpmLimit, setRpmLimit] = useState("");
  const [rpdLimit, setRpdLimit] = useState("");
  const [dailyTokenQuota, setDailyTokenQuota] = useState("");
  const [monthlyUsdQuota, setMonthlyUsdQuota] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [probingAll, setProbingAll] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedHealthId, setExpandedHealthId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; latencyMs: number; detail: string }>
  >({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAdd) setShowAdd(false);
        if (openMenuId) {
          setOpenMenuId(null);
          setConfirmDeleteId(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAdd, openMenuId]);

  const selectedSpec = getProviderSpec(provider);

  const openModal = () => {
    setEditingId(null);
    setProvider("openai");
    setName("");
    setBaseUrl(getProviderSpec("openai").defaultBaseUrl);
    setDefaultModel("");
    setFetchedModels([]);
    setFreeOnly(false);
    setFetchError(null);
    setApiKey("");
    setExtraApiKeys("");
    setClearKeyPool(false);
    setEditingPoolPreview([]);
    setRpmLimit("");
    setRpdLimit("");
    setDailyTokenQuota("");
    setMonthlyUsdQuota("");
    setShowAdvanced(false);
    setShowAdd(true);
  };

  const openEditModal = (conn: ProviderConnection) => {
    setEditingId(conn.id);
    setProvider(conn.provider);
    setName(conn.name);
    setBaseUrl(conn.baseUrl || getProviderSpec(conn.provider).defaultBaseUrl);
    setDefaultModel(conn.defaultModel || "");
    setFetchedModels(conn.availableModels || []);
    setFreeOnly(false);
    setFetchError(null);
    setApiKey("");
    setExtraApiKeys("");
    setClearKeyPool(false);
    setEditingPoolPreview(conn.maskedPoolKeys || []);
    setRpmLimit(conn.rpmLimit !== null ? String(conn.rpmLimit) : "");
    setRpdLimit(conn.rpdLimit !== null ? String(conn.rpdLimit) : "");
    setDailyTokenQuota(
      conn.dailyTokenQuota !== null ? String(conn.dailyTokenQuota) : ""
    );
    setMonthlyUsdQuota(
      conn.monthlyUsdQuota !== null ? String(conn.monthlyUsdQuota) : ""
    );
    setShowAdvanced(
      Boolean(
        conn.poolKeyCount > 0 ||
          conn.rpmLimit ||
          conn.rpdLimit ||
          conn.dailyTokenQuota ||
          conn.monthlyUsdQuota
      )
    );
    setShowAdd(true);
  };

  const handleProviderChange = (next: string) => {
    setProvider(next);
    const spec = getProviderSpec(next);
    setBaseUrl(spec.defaultBaseUrl);
    setDefaultModel("");
    setFetchedModels([]);
    setFetchError(null);
  };

  const handleFetchModels = async (overrideFreeOnly?: boolean) => {
    const onlyFree =
      typeof overrideFreeOnly === "boolean" ? overrideFreeOnly : freeOnly;
    if (!apiKey.trim() && !editingId) {
      setFetchError("Enter API key first");
      return;
    }
    setFetchingModels(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/providers/fetch-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: editingId || undefined,
          provider,
          baseUrl: baseUrl.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          freeOnly: onlyFree,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error || "Failed to fetch models";
        setFetchError(msg);
        onNotify(msg, "error");
        return;
      }
      const models: string[] = Array.isArray(data.models) ? data.models : [];
      setFetchedModels(models);
      if (models.length > 0) {
        if (!defaultModel.trim() || (onlyFree && !models.includes(defaultModel))) {
          setDefaultModel(models[0]);
        }
        if (editingId) {
          await onRefresh();
        }
        onNotify(
          `Fetched ${models.length}${onlyFree ? " free" : ""} model${models.length === 1 ? "" : "s"}`,
          "success"
        );
      } else {
        setFetchError(onlyFree ? "No free models returned" : "No models returned");
      }
    } catch {
      setFetchError("Network error fetching models");
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const isEdit = Boolean(editingId);
      const url = isEdit ? `/api/providers/${editingId}` : "/api/providers";
      const method = isEdit ? "PATCH" : "POST";

      const payload: Record<string, unknown> = {
        name: name.trim(),
        baseUrl: baseUrl.trim() || null,
        defaultModel: defaultModel.trim() || null,
        availableModels: fetchedModels,
        rpmLimit: rpmLimit ? Number(rpmLimit) : null,
        rpdLimit: rpdLimit ? Number(rpdLimit) : null,
        dailyTokenQuota: dailyTokenQuota ? Number(dailyTokenQuota) : null,
        monthlyUsdQuota: monthlyUsdQuota ? Number(monthlyUsdQuota) : null,
      };

      if (!isEdit) {
        payload.provider = provider;
        payload.apiKey = apiKey.trim();
        if (extraApiKeys.trim()) {
          payload.extraApiKeys = extraApiKeys;
        }
      } else {
        if (apiKey.trim()) {
          payload.apiKey = apiKey.trim();
        }
        if (clearKeyPool) {
          payload.clearKeyPool = true;
        } else if (extraApiKeys.trim()) {
          payload.extraApiKeys = extraApiKeys;
        }
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Failed to save provider connection", "error");
        return;
      }
      const savedConn = data.connection as ProviderConnection | undefined;
      if (savedConn) {
        onUpdateWorkspace((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            connections: isEdit
              ? prev.connections.map((c) => (c.id === savedConn.id ? savedConn : c))
              : [savedConn, ...prev.connections],
          };
        });
      } else {
        await onRefresh();
      }
      setShowAdd(false);
      setEditingId(null);
      onNotify(
        isEdit ? "Provider connection updated." : "Provider connection saved.",
        "success"
      );
    } catch {
      onNotify("Network error while saving provider", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (conn: ProviderConnection) => {
    const nextActive = !conn.isActive;
    onUpdateWorkspace((prev) =>
      prev
        ? {
            ...prev,
            connections: prev.connections.map((c) =>
              c.id === conn.id ? { ...c, isActive: nextActive } : c
            ),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/providers/${conn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        onUpdateWorkspace((prev) =>
          prev
            ? {
                ...prev,
                connections: prev.connections.map((c) =>
                  c.id === conn.id ? { ...c, isActive: conn.isActive } : c
                ),
              }
            : prev
        );
        onNotify("Failed to update provider state", "error");
      }
    } catch {
      onUpdateWorkspace((prev) =>
        prev
          ? {
              ...prev,
              connections: prev.connections.map((c) =>
                c.id === conn.id ? { ...c, isActive: conn.isActive } : c
              ),
            }
          : prev
      );
      onNotify("Network error updating provider", "error");
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/providers/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [id]: data }));
      await onRefresh();
      onNotify(
        data.ok
          ? `Probe succeeded in ${data.latencyMs}ms`
          : `Probe failed: ${data.detail}`,
        data.ok ? "success" : "error"
      );
    } catch {
      onNotify("Connection probe request failed", "error");
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncRowModels = async (
    conn: ProviderConnection,
    onlyFree = false
  ) => {
    setSyncingId(conn.id);
    try {
      const res = await fetch("/api/providers/fetch-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: conn.id, freeOnly: onlyFree }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Failed to fetch models", "error");
        return;
      }
      const models: string[] = Array.isArray(data.models) ? data.models : [];
      await onRefresh();
      onNotify(
        `Synced ${models.length}${onlyFree ? " free" : ""} model${models.length === 1 ? "" : "s"} for ${conn.name}`,
        "success"
      );
    } catch {
      onNotify("Network error syncing models", "error");
    } finally {
      setSyncingId(null);
    }
  };

  const handleProbeFree = async (conn: ProviderConnection) => {
    setProbingId(conn.id);
    try {
      const res = await fetch(`/api/providers/${conn.id}/probe-free`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Failed to ping free models", "error");
        return;
      }
      await onRefresh();
      const probedCount = Array.isArray(data.probedModels)
        ? data.probedModels.length
        : 0;
      if (probedCount === 0) {
        onNotify(`No free models synced on ${conn.name} yet.`, "error");
      } else {
        onNotify(
          `${conn.name}: ${data.healthyCount}/${probedCount} free models online`,
          data.healthyCount > 0 ? "success" : "error"
        );
      }
    } catch {
      onNotify("Network error probing free models", "error");
    } finally {
      setProbingId(null);
    }
  };

  const handleProbeAllFree = async () => {
    const activeConns = connections.filter((c) => c.isActive);
    if (activeConns.length === 0) return;
    setProbingAll(true);
    let totalHealthy = 0;
    let totalProbed = 0;
    try {
      for (const conn of activeConns) {
        try {
          const res = await fetch(`/api/providers/${conn.id}/probe-free`, {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            totalHealthy += Number(data.healthyCount || 0);
            totalProbed += Array.isArray(data.probedModels)
              ? data.probedModels.length
              : 0;
          }
        } catch {
          // continue probing remaining connections
        }
      }
      await onRefresh();
      if (totalProbed > 0) {
        onNotify(
          `Health check complete: ${totalHealthy}/${totalProbed} free models online`,
          totalHealthy > 0 ? "success" : "error"
        );
      } else {
        onNotify("No free models found to ping. Run Sync Free first.", "error");
      }
    } finally {
      setProbingAll(false);
    }
  };

  const handleResetCircuit = async (id: string) => {
    onUpdateWorkspace((prev) =>
      prev
        ? {
            ...prev,
            connections: prev.connections.map((c) =>
              c.id === id
                ? {
                    ...c,
                    circuitStatus: "healthy",
                    failureCount: 0,
                    cooldownUntil: null,
                    lastError: null,
                  }
                : c
            ),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/providers/${id}/reset-circuit`, {
        method: "POST",
      });
      if (res.ok) {
        onNotify("Circuit breaker reset to Healthy.", "success");
      } else {
        await onRefresh();
      }
    } catch {
      await onRefresh();
      onNotify("Failed to reset circuit breaker", "error");
    }
  };

  const handleDelete = async (id: string) => {
    setOpenMenuId(null);
    setConfirmDeleteId(null);
    onUpdateWorkspace((prev) =>
      prev
        ? {
            ...prev,
            connections: prev.connections.filter((c) => c.id !== id),
            combos: prev.combos.map((combo) => ({
              ...combo,
              tiers: combo.tiers.filter((t) => t.connectionId !== id),
            })),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        onNotify("Provider connection removed.", "success");
      } else {
        await onRefresh();
        onNotify("Failed to remove provider", "error");
      }
    } catch {
      await onRefresh();
      onNotify("Failed to remove provider", "error");
    }
  };

  const resetCountdown = getUtcResetCountdown();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-white">
          Providers
        </h2>
        <div className="flex items-center gap-2.5 flex-wrap">
          {connections.some((c) => c.isActive) && (
            <button
              type="button"
              onClick={handleProbeAllFree}
              disabled={probingAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#111114] hover:bg-[#18181B] text-[#D4D4D8] hover:text-white border border-[#222227] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Activity
                className={`w-3.5 h-3.5 text-emerald-400 ${probingAll ? "animate-pulse" : ""}`}
              />
              <span>{probingAll ? "Pinging..." : "Ping Free"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={openModal}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Provider</span>
          </button>
        </div>
      </div>

      {openMenuId && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setOpenMenuId(null);
            setConfirmDeleteId(null);
          }}
          aria-hidden="true"
        />
      )}

      {connections.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-white">No providers connected yet</p>
          <p className="mt-1 text-xs text-[#8B8B95]">
            Add an upstream API provider to start routing and load-balancing requests.
          </p>
          <button
            type="button"
            onClick={openModal}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Provider</span>
          </button>
        </div>
      ) : (
        <>
          {/* Mobile Cards (<768px) — avoids horizontal table & menu clipping */}
          <div className="md:hidden space-y-3">
            {connections.map((conn) => {
              const testInfo = testResults[conn.id];
              const circuitLabel = !conn.isActive
                ? "Disabled"
                : conn.circuitStatus === "open"
                  ? `Open (${conn.failureCount} fails)`
                  : conn.circuitStatus === "half_open"
                    ? "Half-Open"
                    : "Healthy";
              const circuitColor = !conn.isActive
                ? "text-[#A1A1AA]"
                : conn.circuitStatus === "open"
                  ? "text-red-400"
                  : conn.circuitStatus === "half_open"
                    ? "text-amber-400"
                    : "text-emerald-400";

              return (
                <div
                  key={conn.id}
                  className="bg-[#111114] border border-[#222227] rounded-lg p-4 space-y-3 relative"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">
                        {conn.name}
                      </div>
                      <div className="mt-0.5 text-xs font-mono text-[#A1A1AA] truncate">
                        {conn.provider}
                        {conn.defaultModel ? ` · ${conn.defaultModel}` : ""}
                      </div>
                    </div>
                    <span className={`text-xs font-medium shrink-0 ${circuitColor}`}>
                      {circuitLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#8B8B95] tabular-nums">
                    <span>{conn.maskedKey}</span>
                    <span>
                      {conn.usedRequestsToday.toLocaleString()} req · $
                      {conn.usedCostMonth.toFixed(4)}
                    </span>
                  </div>

                  {conn.lastError && (
                    <div className="text-xs text-red-400 truncate">
                      {conn.lastError}
                    </div>
                  )}
                  {testInfo && (
                    <div
                      className={`text-xs ${
                        testInfo.ok ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {testInfo.detail} ({testInfo.latencyMs}ms)
                    </div>
                  )}

                  <div className="pt-2 border-t border-[#1D1D22] flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleTest(conn.id)}
                        disabled={testingId === conn.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#D4D4D8] hover:text-white"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>{testingId === conn.id ? "Testing..." : "Test"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(conn)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#A1A1AA] hover:text-white"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSyncRowModels(conn, true)}
                        disabled={syncingId === conn.id}
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Sync free</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggle(conn)}
                        className="text-xs text-[#A1A1AA] hover:text-white"
                      >
                        {conn.isActive ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDeleteId === conn.id) {
                            setConfirmDeleteId(null);
                            handleDelete(conn.id);
                          } else {
                            setConfirmDeleteId(conn.id);
                          }
                        }}
                        className={`text-xs font-medium ${
                          confirmDeleteId === conn.id
                            ? "text-red-300 underline underline-offset-2"
                            : "text-red-400 hover:text-red-300"
                        }`}
                      >
                        {confirmDeleteId === conn.id ? "Confirm?" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block bg-[#111114] border border-[#222227] rounded-lg">
            <div className="overflow-visible">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#222227] text-xs text-[#A1A1AA]">
                  <th className="py-3 px-5 font-medium">Connection</th>
                  <th className="py-3 px-4 font-medium">Credential & Pool</th>
                  <th className="py-3 px-4 font-medium">Circuit & RPM</th>
                  <th className="py-3 px-4 font-medium text-right">
                    Daily Quota
                  </th>
                  <th className="py-3 px-4 font-medium text-right">
                    Monthly Spend
                  </th>
                  <th className="py-3 px-5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222227] text-sm">
                {connections.map((conn) => {
                  const testInfo = testResults[conn.id];
                  const tokenPct = conn.dailyTokenQuota
                    ? Math.min(
                        100,
                        Math.round(
                          (conn.usedTokensToday / conn.dailyTokenQuota) * 100
                        )
                      )
                    : null;
                  const reqPct = conn.rpdLimit
                    ? Math.min(
                        100,
                        Math.round((conn.usedRequestsToday / conn.rpdLimit) * 100)
                      )
                    : null;

                  const healthEntries = Object.entries(conn.modelHealth || {});
                  const onlineHealth = healthEntries.filter(([, h]) => h.ok);
                  const fastestLatency = onlineHealth
                    .map(([, h]) => h.latencyMs)
                    .sort((a, b) => a - b)[0];

                  const circuitLabel = !conn.isActive
                    ? "Disabled"
                    : conn.circuitStatus === "open"
                      ? `Open (${conn.failureCount} fails)`
                      : conn.circuitStatus === "half_open"
                        ? "Half-Open Probe"
                        : "Healthy";
                  const circuitColor = !conn.isActive
                    ? "text-[#A1A1AA]"
                    : conn.circuitStatus === "open"
                      ? "text-red-400"
                      : conn.circuitStatus === "half_open"
                        ? "text-amber-400"
                        : "text-emerald-400";

                  return (
                    <tr
                      key={conn.id}
                      className="hover:bg-[#18181B]/50 transition-colors"
                    >
                      <td className="py-3.5 px-5 align-top">
                        <div className="font-medium text-white">
                          {conn.name}
                        </div>
                        <div className="mt-0.5 text-xs text-[#A1A1AA] font-mono">
                          {conn.provider}
                          {conn.defaultModel ? (
                            <span className="text-amber-400">
                              {" "}
                              · {conn.defaultModel}
                            </span>
                          ) : null}
                          {conn.availableModels.length > 0 ? (
                            <span className="text-emerald-400">
                              {" "}
                              · {conn.availableModels.length} models
                            </span>
                          ) : null}
                          {conn.baseUrl ? ` · ${conn.baseUrl}` : ""}
                        </div>
                        {healthEntries.length > 0 && (
                          <div className="mt-1.5 text-xs font-mono text-[#A1A1AA]">
                            <span>
                              <span
                                className={
                                  onlineHealth.length > 0
                                    ? "text-emerald-400"
                                    : "text-red-400"
                                }
                              >
                                {onlineHealth.length}/{healthEntries.length} online
                              </span>
                              {fastestLatency !== undefined
                                ? ` · ${fastestLatency}ms`
                                : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedHealthId(
                                  expandedHealthId === conn.id ? null : conn.id
                                )
                              }
                              className="ml-2 text-[#71717A] hover:text-white underline underline-offset-2"
                            >
                              {expandedHealthId === conn.id ? "hide" : "details"}
                            </button>
                            <AnimatePresence initial={false}>
                              {expandedHealthId === conn.id && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                                  className="mt-1.5 space-y-0.5 text-[11px] text-[#A1A1AA] overflow-hidden"
                                >
                                  {healthEntries.slice(0, 8).map(([mId, h]) => (
                                    <div
                                      key={mId}
                                      className="flex items-center gap-2"
                                      title={h.error || `${h.latencyMs}ms`}
                                    >
                                      <span
                                        className={
                                          h.ok ? "text-emerald-400" : "text-red-400"
                                        }
                                      >
                                        {h.ok ? "OK" : "ERR"}
                                      </span>
                                      <span className="truncate max-w-[200px] text-[#D4D4D8]">
                                        {mId}
                                      </span>
                                      <span>
                                        {h.ok ? `${h.latencyMs}ms` : "failed"}
                                      </span>
                                    </div>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )}
                        {conn.lastError && (
                          <div className="mt-1 text-xs text-red-400 max-w-xs truncate">
                            {conn.lastError}
                          </div>
                        )}
                        {testInfo && (
                          <div
                            className={`mt-1 text-xs ${
                              testInfo.ok ? "text-emerald-400" : "text-red-400"
                            }`}
                          >
                            {testInfo.detail} ({testInfo.latencyMs}ms)
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top font-mono text-xs text-[#D4D4D8]">
                        <div>{conn.maskedKey}</div>
                        {conn.poolKeyCount > 0 && (
                          <div className="mt-1 text-[11px] text-emerald-400">
                            +{conn.poolKeyCount} pool key
                            {conn.poolKeyCount === 1 ? "" : "s"}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <div className={`text-xs font-medium ${circuitColor}`}>
                          {circuitLabel}
                        </div>
                        {conn.lastLatencyMs !== null && (
                          <div className="mt-0.5 font-mono text-xs text-[#A1A1AA] tabular-nums">
                            {conn.lastLatencyMs}ms avg
                          </div>
                        )}
                        {conn.rpmLimit && (
                          <div className="mt-0.5 font-mono text-[11px] text-amber-300 tabular-nums">
                            {conn.rpmLimit} RPM queue
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top text-right font-mono text-xs tabular-nums">
                        <div className="text-[#E5E7EB]">
                          {conn.usedRequestsToday.toLocaleString()}
                          {conn.rpdLimit ? ` / ${conn.rpdLimit.toLocaleString()} req` : " req"}
                        </div>
                        <div className="text-[#A1A1AA] mt-0.5">
                          {conn.usedTokensToday.toLocaleString()}
                          {conn.dailyTokenQuota
                            ? ` / ${conn.dailyTokenQuota.toLocaleString()} tok`
                            : " tok"}
                        </div>
                        {(reqPct !== null || tokenPct !== null) && (
                          <>
                            <div className="mt-1.5 w-24 ml-auto h-1 bg-[#09090B] rounded-full overflow-hidden">
                              <div
                                style={{
                                  width: `${Math.max(reqPct ?? 0, tokenPct ?? 0)}%`,
                                }}
                                className={`h-full ${
                                  Math.max(reqPct ?? 0, tokenPct ?? 0) >= 90
                                    ? "bg-red-500"
                                    : "bg-[#10B981]"
                                }`}
                              />
                            </div>
                            <div className="mt-1 text-[10px] text-[#71717A]">
                              Resets in {resetCountdown}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top text-right font-mono text-xs text-[#D4D4D8] tabular-nums">
                        ${conn.usedCostMonth.toFixed(4)}
                        {conn.monthlyUsdQuota
                          ? ` / $${conn.monthlyUsdQuota.toFixed(2)}`
                          : ""}
                      </td>
                      <td className="py-3.5 px-5 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-3 relative">
                          <button
                            type="button"
                            onClick={() => handleTest(conn.id)}
                            disabled={testingId === conn.id}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#A1A1AA] hover:text-white transition-colors whitespace-nowrap"
                          >
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <span>
                              {testingId === conn.id ? "Testing..." : "Test"}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditModal(conn)}
                            title="Edit connection"
                            className="p-1 text-[#A1A1AA] hover:text-white transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              setOpenMenuId(
                                openMenuId === conn.id ? null : conn.id
                              );
                            }}
                            aria-label="More provider actions"
                            className="p-1 text-[#A1A1AA] hover:text-white rounded hover:bg-[#18181B] transition-colors"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>

                          <AnimatePresence>
                            {openMenuId === conn.id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                                className="absolute right-0 top-full mt-1 w-44 z-30 bg-[#18181B] border border-[#27272A] rounded-lg shadow-xl py-1 text-left origin-top-right"
                              >
                                <button
                                  type="button"
                                  disabled={syncingId === conn.id}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    handleSyncRowModels(conn, false);
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-[#E5E7EB] hover:bg-[#222227] flex items-center gap-2"
                                >
                                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Sync all models</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={syncingId === conn.id}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    handleSyncRowModels(conn, true);
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-emerald-300 hover:bg-[#222227] flex items-center gap-2"
                                >
                                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Sync free only</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={probingId === conn.id}
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    handleProbeFree(conn);
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-[#E5E7EB] hover:bg-[#222227] flex items-center gap-2"
                                >
                                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>
                                    {probingId === conn.id
                                      ? "Pinging..."
                                      : "Ping free models"}
                                  </span>
                                </button>
                                {conn.circuitStatus !== "healthy" && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      handleResetCircuit(conn.id);
                                    }}
                                    className="w-full px-3 py-1.5 text-xs text-amber-300 hover:bg-[#222227] flex items-center gap-2"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    <span>Reset circuit</span>
                                  </button>
                                )}
                                <div className="my-1 border-t border-[#27272A]" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    handleToggle(conn);
                                  }}
                                  className="w-full px-3 py-1.5 text-xs text-[#D4D4D8] hover:bg-[#222227] flex items-center justify-between"
                                >
                                  <span>{conn.isActive ? "Disable" : "Enable"}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirmDeleteId === conn.id) {
                                      setOpenMenuId(null);
                                      setConfirmDeleteId(null);
                                      handleDelete(conn.id);
                                    } else {
                                      setConfirmDeleteId(conn.id);
                                    }
                                  }}
                                  className={`w-full px-3 py-1.5 text-xs hover:bg-[#222227] flex items-center gap-2 ${
                                    confirmDeleteId === conn.id
                                      ? "text-red-300 font-semibold"
                                      : "text-red-400"
                                  }`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>
                                    {confirmDeleteId === conn.id
                                      ? "Confirm delete?"
                                      : "Delete"}
                                  </span>
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {/* Add / Edit Provider Modal */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={() => setShowAdd(false)}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-[#111114] border border-[#222227] rounded-xl p-6 max-h-[90vh] overflow-y-auto"
            >
            <div className="flex items-center justify-between pb-4 border-b border-[#222227]">
              <h3 className="font-display text-base font-semibold text-white">
                {editingId ? "Edit Provider Connection" : "Add Provider"}
              </h3>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="text-[#A1A1AA] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Provider
                  </label>
                  <select
                    value={provider}
                    disabled={Boolean(editingId)}
                    onChange={(e) => handleProviderChange(e.target.value)}
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60 focus:outline-none focus:border-amber-400"
                  >
                    {PROVIDER_CATALOG.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Connection Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  API Key
                </label>
                <input
                  type="password"
                  required={!editingId}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    editingId ? "Leave blank to keep existing key" : undefined
                  }
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Base URL
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Model ID
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    list="provider-model-suggestions"
                    value={defaultModel}
                    onChange={(e) => setDefaultModel(e.target.value)}
                    className="flex-1 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={() => handleFetchModels()}
                    disabled={fetchingModels}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#18181B] hover:bg-[#222227] disabled:opacity-60 text-white border border-[#27272A] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${fetchingModels ? "animate-spin" : ""}`}
                    />
                    <span>{fetchingModels ? "Fetching..." : "Fetch"}</span>
                  </button>
                </div>
                <div className="mt-2.5 px-1">
                  <ToggleSwitch
                    checked={freeOnly}
                    onChange={setFreeOnly}
                    label="Import free models only"
                  />
                </div>
                <datalist id="provider-model-suggestions">
                  {Array.from(
                    new Set([
                      ...fetchedModels,
                      ...selectedSpec.models.map((m) => m.id),
                    ])
                  ).map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>

                {fetchedModels.length > 0 && (
                  <select
                    value={
                      fetchedModels.includes(defaultModel) ? defaultModel : ""
                    }
                    onChange={(e) => {
                      if (e.target.value) setDefaultModel(e.target.value);
                    }}
                    className="mt-2 w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs font-mono text-amber-300 focus:outline-none focus:border-amber-400"
                  >
                    <option value="">
                      Fetched models ({fetchedModels.length})
                    </option>
                    {fetchedModels.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                )}

                {fetchError && (
                  <div className="mt-1.5 text-xs text-red-400">
                    {fetchError}
                  </div>
                )}
              </div>

              <div className="border-t border-[#222227] pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-medium text-[#A1A1AA] hover:text-white transition-colors"
                >
                  <span>Rate limits, quotas & key pool</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${
                      showAdvanced ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {showAdvanced && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      className="mt-3.5 space-y-4 overflow-hidden"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <label className="block text-xs font-medium text-[#D4D4D8]">
                            Free Key Pool (Extra keys, one per line)
                          </label>
                          {editingPoolPreview.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setClearKeyPool((v) => !v);
                                if (!clearKeyPool) setExtraApiKeys("");
                              }}
                              className="text-[11px] text-amber-400 hover:text-amber-300"
                            >
                              {clearKeyPool
                                ? "Keep pool keys"
                                : `Clear ${editingPoolPreview.length} saved`}
                            </button>
                          )}
                        </div>
                        <textarea
                          rows={2}
                          disabled={clearKeyPool}
                          value={extraApiKeys}
                          onChange={(e) => setExtraApiKeys(e.target.value)}
                          className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs font-mono text-white disabled:opacity-50 focus:outline-none focus:border-amber-400"
                        />
                        {editingPoolPreview.length > 0 && !clearKeyPool && (
                          <div className="mt-1 text-[11px] font-mono text-[#A1A1AA]">
                            Saved pool: {editingPoolPreview.join(", ")}
                          </div>
                        )}
                      </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                          RPM Limit
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={rpmLimit}
                          onChange={(e) => setRpmLimit(e.target.value)}
                          className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                          Daily Reqs (RPD)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={rpdLimit}
                          onChange={(e) => setRpdLimit(e.target.value)}
                          className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                          Daily Tokens
                        </label>
                        <input
                          type="number"
                          min={1000}
                          value={dailyTokenQuota}
                          onChange={(e) => setDailyTokenQuota(e.target.value)}
                          className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                          Monthly USD
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={0.1}
                          value={monthlyUsdQuota}
                          onChange={(e) => setMonthlyUsdQuota(e.target.value)}
                          className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                        />
                      </div>
                    </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="pt-3 border-t border-[#222227] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#222227] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] rounded-lg transition-colors whitespace-nowrap"
                >
                  {submitting
                    ? "Saving..."
                    : editingId
                      ? "Save Changes"
                      : "Save Connection"}
                </button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
