import React, { useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2, Zap, X } from "lucide-react";
import { PROVIDER_CATALOG, getProviderSpec } from "../shared/catalog.ts";
import type { ProviderConnection } from "../types/gateway.ts";

interface ProvidersViewProps {
  connections: ProviderConnection[];
  serverGeminiAvailable: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function ProvidersView({
  connections,
  serverGeminiAvailable,
  onRefresh,
  onNotify,
}: ProvidersViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [provider, setProvider] = useState("openai");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [useServerKey, setUseServerKey] = useState(false);
  const [dailyTokenQuota, setDailyTokenQuota] = useState("");
  const [monthlyUsdQuota, setMonthlyUsdQuota] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; latencyMs: number; detail: string }>
  >({});

  const selectedSpec = getProviderSpec(provider);

  const openModal = () => {
    setEditingId(null);
    setProvider("openai");
    setName("");
    setBaseUrl(getProviderSpec("openai").defaultBaseUrl);
    setDefaultModel("");
    setFetchedModels([]);
    setFetchError(null);
    setApiKey("");
    setUseServerKey(false);
    setDailyTokenQuota("");
    setMonthlyUsdQuota("");
    setShowAdd(true);
  };

  const openEditModal = (conn: ProviderConnection) => {
    setEditingId(conn.id);
    setProvider(conn.provider);
    setName(conn.name);
    setBaseUrl(conn.baseUrl || getProviderSpec(conn.provider).defaultBaseUrl);
    setDefaultModel(conn.defaultModel || "");
    setFetchedModels([]);
    setFetchError(null);
    setApiKey("");
    setUseServerKey(conn.maskedKey === "Built-in Gemini Key");
    setDailyTokenQuota(
      conn.dailyTokenQuota !== null ? String(conn.dailyTokenQuota) : ""
    );
    setMonthlyUsdQuota(
      conn.monthlyUsdQuota !== null ? String(conn.monthlyUsdQuota) : ""
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
    setUseServerKey(next === "gemini" && serverGeminiAvailable);
  };

  const handleFetchModels = async () => {
    if (!useServerKey && !apiKey.trim() && !editingId) {
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
          useServerKey,
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
        if (!defaultModel.trim()) {
          setDefaultModel(models[0]);
        }
        onNotify(`Fetched ${models.length} models`, "success");
      } else {
        setFetchError("No models returned");
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
        dailyTokenQuota: dailyTokenQuota ? Number(dailyTokenQuota) : null,
        monthlyUsdQuota: monthlyUsdQuota ? Number(monthlyUsdQuota) : null,
      };

      if (!isEdit) {
        payload.provider = provider;
        payload.useServerKey = useServerKey;
        payload.apiKey = useServerKey ? "" : apiKey.trim();
      } else {
        if (provider === "gemini") {
          payload.useServerKey = useServerKey;
        }
        if (apiKey.trim()) {
          payload.apiKey = apiKey.trim();
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
      setShowAdd(false);
      setEditingId(null);
      await onRefresh();
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
    try {
      const res = await fetch(`/api/providers/${conn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !conn.isActive }),
      });
      if (!res.ok) {
        onNotify("Failed to update provider state", "error");
        return;
      }
      await onRefresh();
    } catch {
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

  const handleResetCircuit = async (id: string) => {
    try {
      const res = await fetch(`/api/providers/${id}/reset-circuit`, {
        method: "POST",
      });
      if (res.ok) {
        await onRefresh();
        onNotify("Circuit breaker reset to Healthy.", "success");
      }
    } catch {
      onNotify("Failed to reset circuit breaker", "error");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        await onRefresh();
        onNotify("Provider connection removed.", "success");
      }
    } catch {
      onNotify("Failed to remove provider", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-white">
          Providers
        </h2>
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Provider</span>
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-white">No providers connected</p>
          <button
            type="button"
            onClick={openModal}
            className="mt-4 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap"
          >
            Add Provider
          </button>
        </div>
      ) : (
        <div className="bg-[#111114] border border-[#222227] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#222227] text-xs text-[#A1A1AA]">
                  <th className="py-3 px-5 font-medium">Connection</th>
                  <th className="py-3 px-4 font-medium">Credential</th>
                  <th className="py-3 px-4 font-medium">Circuit State</th>
                  <th className="py-3 px-4 font-medium text-right">
                    Daily Tokens
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
                          {conn.baseUrl ? ` · ${conn.baseUrl}` : ""}
                        </div>
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
                        {conn.maskedKey}
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
                      </td>
                      <td className="py-3.5 px-4 align-top text-right font-mono text-xs tabular-nums">
                        <div className="text-[#E5E7EB]">
                          {conn.usedTokensToday.toLocaleString()}
                          {conn.dailyTokenQuota
                            ? ` / ${conn.dailyTokenQuota.toLocaleString()}`
                            : " / ∞"}
                        </div>
                        {tokenPct !== null && (
                          <div className="mt-1.5 w-24 ml-auto h-1 bg-[#09090B] rounded-full overflow-hidden">
                            <div
                              style={{ width: `${tokenPct}%` }}
                              className={`h-full ${
                                tokenPct >= 90 ? "bg-red-500" : "bg-[#10B981]"
                              }`}
                            />
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top text-right font-mono text-xs text-[#D4D4D8] tabular-nums">
                        ${conn.usedCostMonth.toFixed(4)}
                        {conn.monthlyUsdQuota
                          ? ` / $${conn.monthlyUsdQuota.toFixed(2)}`
                          : ""}
                      </td>
                      <td className="py-3.5 px-5 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleTest(conn.id)}
                            disabled={testingId === conn.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#222227] rounded-md transition-colors whitespace-nowrap"
                          >
                            <Zap className="w-3.5 h-3.5 text-amber-400" />
                            <span>
                              {testingId === conn.id ? "Testing..." : "Test"}
                            </span>
                          </button>

                          {conn.circuitStatus !== "healthy" && (
                            <button
                              type="button"
                              onClick={() => handleResetCircuit(conn.id)}
                              title="Reset circuit breaker"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-300 bg-[#09090B] border border-[#222227] rounded-md hover:border-amber-500/40 whitespace-nowrap"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Reset</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openEditModal(conn)}
                            title="Edit connection"
                            className="p-1.5 text-[#A1A1AA] hover:text-amber-400 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggle(conn)}
                            className="px-2.5 py-1.5 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#222227] rounded-md whitespace-nowrap"
                          >
                            {conn.isActive ? "Disable" : "Enable"}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDelete(conn.id)}
                            title="Delete connection"
                            className="p-1.5 text-[#A1A1AA] hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Provider Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#111114] border border-[#222227] rounded-xl p-6">
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
                    placeholder={`e.g. ${selectedSpec.label} Primary`}
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              {provider === "gemini" && serverGeminiAvailable && (
                <label className="flex items-center gap-2.5 text-xs text-[#D4D4D8] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useServerKey}
                    onChange={(e) => setUseServerKey(e.target.checked)}
                    className="rounded border-[#222227] bg-[#09090B] text-amber-400"
                  />
                  <span>Use built-in Gemini key</span>
                </label>
              )}

              {!useServerKey && (
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    API Key
                  </label>
                  <input
                    type="password"
                    required={!editingId && !useServerKey}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      editingId
                        ? "Leave blank to keep existing key"
                        : "Enter upstream API key"
                    }
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Base URL
                </label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={selectedSpec.defaultBaseUrl}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
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
                    placeholder={
                      selectedSpec.models[0]?.id || "e.g. gpt-4o"
                    }
                    className="flex-1 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                  />
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${fetchingModels ? "animate-spin" : ""}`}
                    />
                    <span>{fetchingModels ? "Fetching..." : "Fetch"}</span>
                  </button>
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Daily Token Quota
                  </label>
                  <input
                    type="number"
                    min={1000}
                    value={dailyTokenQuota}
                    onChange={(e) => setDailyTokenQuota(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Monthly USD Budget
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0.1}
                    value={monthlyUsdQuota}
                    onChange={(e) => setMonthlyUsdQuota(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                  />
                </div>
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
          </div>
        </div>
      )}
    </div>
  );
}
