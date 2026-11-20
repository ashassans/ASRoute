import React, { useEffect, useState } from "react";
import { Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Combo, GatewayApiKey } from "../types/gateway.ts";

interface ApiKeysViewProps {
  keys: GatewayApiKey[];
  combos: Combo[];
  gatewayEndpoint: string;
  openCreateCounter: number;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function ApiKeysView({
  keys,
  combos,
  gatewayEndpoint,
  openCreateCounter,
  onRefresh,
  onNotify,
}: ApiKeysViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [allowedCombo, setAllowedCombo] = useState("");
  const [dailyTokenLimit, setDailyTokenLimit] = useState("");
  const [monthlyUsdLimit, setMonthlyUsdLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const openCreateModal = () => {
    setEditingId(null);
    setName("");
    setAllowedCombo("");
    setDailyTokenLimit("");
    setMonthlyUsdLimit("");
    setShowCreate(true);
  };

  const openEditModal = (k: GatewayApiKey) => {
    setEditingId(k.id);
    setName(k.name);
    setAllowedCombo(k.allowedCombo || "");
    setDailyTokenLimit(
      k.dailyTokenLimit !== null ? String(k.dailyTokenLimit) : ""
    );
    setMonthlyUsdLimit(
      k.monthlyUsdLimit !== null ? String(k.monthlyUsdLimit) : ""
    );
    setShowCreate(true);
  };

  useEffect(() => {
    if (openCreateCounter > 0) {
      openCreateModal();
    }
  }, [openCreateCounter]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const isEdit = Boolean(editingId);
      const url = isEdit ? `/api/keys/${editingId}` : "/api/keys";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          allowedCombo: allowedCombo || null,
          dailyTokenLimit: dailyTokenLimit ? Number(dailyTokenLimit) : null,
          monthlyUsdLimit: monthlyUsdLimit ? Number(monthlyUsdLimit) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Failed to save API key", "error");
        return;
      }
      if (!isEdit && data.rawKey) {
        setRevealedKey(data.rawKey);
      }
      setShowCreate(false);
      setEditingId(null);
      setName("");
      setAllowedCombo("");
      setDailyTokenLimit("");
      setMonthlyUsdLimit("");
      await onRefresh();
      onNotify(
        isEdit ? "API key updated." : "Gateway API key created.",
        "success"
      );
    } catch {
      onNotify("Network error saving key", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (k: GatewayApiKey) => {
    try {
      const res = await fetch(`/api/keys/${k.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !k.isActive }),
      });
      if (res.ok) await onRefresh();
    } catch {
      onNotify("Failed to update key state", "error");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        await onRefresh();
        onNotify("API key revoked.", "success");
      }
    } catch {
      onNotify("Failed to revoke key", "error");
    }
  };

  const copyRawKey = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-display text-lg font-semibold text-white">
            API Keys
          </h2>
          <code className="text-xs font-mono text-amber-400">
            {gatewayEndpoint}
          </code>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Create Key</span>
        </button>
      </div>

      {/* One-time Key Reveal Banner */}
      {revealedKey && (
        <div className="bg-[#111114] border border-emerald-500/40 rounded-lg p-5">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-emerald-400">
              Save API key now — shown once
            </h3>
            <button
              type="button"
              onClick={() => setRevealedKey(null)}
              className="text-[#A1A1AA] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-[#09090B] border border-[#222227] rounded-md font-mono text-xs text-white overflow-x-auto">
              {revealedKey}
            </code>
            <button
              type="button"
              onClick={copyRawKey}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-md whitespace-nowrap shrink-0"
            >
              {copiedKey ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Key</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-white">No API keys</p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-4 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap"
          >
            Create Key
          </button>
        </div>
      ) : (
        <div className="bg-[#111114] border border-[#222227] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#222227] text-xs text-[#A1A1AA]">
                  <th className="py-3 px-5 font-medium">Name & Prefix</th>
                  <th className="py-3 px-4 font-medium">Scope & Caps</th>
                  <th className="py-3 px-4 font-medium">State</th>
                  <th className="py-3 px-4 font-medium text-right">Requests</th>
                  <th className="py-3 px-4 font-medium text-right">Tokens</th>
                  <th className="py-3 px-4 font-medium text-right">Spend</th>
                  <th className="py-3 px-5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222227] text-sm">
                {keys.map((k) => (
                  <tr
                    key={k.id}
                    className="hover:bg-[#18181B]/50 transition-colors"
                  >
                    <td className="py-3 px-5">
                      <div className="font-medium text-white">{k.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-[#A1A1AA]">
                        {k.keyPrefix}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#A1A1AA] font-mono">
                      <div>
                        {k.allowedCombo ? `combo: ${k.allowedCombo}` : "All models"}
                      </div>
                      {(k.dailyTokenLimit || k.monthlyUsdLimit) && (
                        <div className="mt-0.5 tabular-nums">
                          {k.dailyTokenLimit
                            ? `${k.dailyTokenLimit.toLocaleString()} tok`
                            : "∞ tok"}
                          {" · "}
                          {k.monthlyUsdLimit
                            ? `$${k.monthlyUsdLimit.toFixed(2)} cap`
                            : "∞ $"}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium">
                      <span
                        className={
                          k.isActive ? "text-emerald-400" : "text-[#A1A1AA]"
                        }
                      >
                        {k.isActive ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-[#D4D4D8] tabular-nums">
                      {k.totalRequests.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-[#D4D4D8] tabular-nums">
                      {k.totalTokens.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-[#D4D4D8] tabular-nums">
                      ${k.totalCostUsd.toFixed(4)}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(k)}
                          title="Edit key"
                          className="p-1.5 text-[#A1A1AA] hover:text-amber-400 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggle(k)}
                          className="px-2.5 py-1.5 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#222227] rounded-md whitespace-nowrap"
                        >
                          {k.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(k.id)}
                          title="Revoke key"
                          className="p-1.5 text-[#A1A1AA] hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111114] border border-[#222227] rounded-xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[#222227]">
              <h3 className="font-display text-base font-semibold text-white">
                {editingId ? "Edit API Key" : "Create API Key"}
              </h3>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-[#A1A1AA] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Key Label
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Production Backend"
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Allowed Combo
                </label>
                <select
                  value={allowedCombo}
                  onChange={(e) => setAllowedCombo(e.target.value)}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                >
                  <option value="">All combos and models</option>
                  {combos.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Daily Token Limit
                  </label>
                  <input
                    type="number"
                    min={100}
                    value={dailyTokenLimit}
                    onChange={(e) => setDailyTokenLimit(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Monthly USD Cap
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0.1}
                    value={monthlyUsdLimit}
                    onChange={(e) => setMonthlyUsdLimit(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#222227] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#222227] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg whitespace-nowrap"
                >
                  {submitting
                    ? "Saving..."
                    : editingId
                      ? "Save Changes"
                      : "Create Key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
