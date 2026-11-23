import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Pencil, Plus, Trash2, X } from "lucide-react";
import { ToggleSwitch } from "./ToggleSwitch.tsx";
import type { BootstrapPayload, Combo, GatewayApiKey } from "../types/gateway.ts";

const KEY_DOT_COLORS = [
  "#38BDF8",
  "#2DD4BF",
  "#F472B6",
  "#A855F7",
  "#FB923C",
];

interface ApiKeysViewProps {
  keys: GatewayApiKey[];
  combos: Combo[];
  openCreateCounter: number;
  onRefresh: () => Promise<void>;
  onUpdateWorkspace: React.Dispatch<React.SetStateAction<BootstrapPayload | null>>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function ApiKeysView({
  keys,
  combos,
  openCreateCounter,
  onRefresh,
  onUpdateWorkspace,
  onNotify,
}: ApiKeysViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [allowedCombo, setAllowedCombo] = useState("");
  const [dailyTokenLimit, setDailyTokenLimit] = useState("");
  const [monthlyUsdLimit, setMonthlyUsdLimit] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCreate) setShowCreate(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCreate]);

  const openCreateModal = () => {
    setEditingId(null);
    setName("");
    setAllowedCombo("");
    setDailyTokenLimit("");
    setMonthlyUsdLimit("");
    setFreeOnly(false);
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
    setFreeOnly(Boolean(k.freeOnly));
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
          freeOnly,
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
      const savedKey = data.key as GatewayApiKey | undefined;
      if (savedKey) {
        onUpdateWorkspace((prev) => {
          if (!prev) return prev;
          const exists = prev.keys.some((k) => k.id === savedKey.id);
          return {
            ...prev,
            keys: exists
              ? prev.keys.map((k) => (k.id === savedKey.id ? savedKey : k))
              : [savedKey, ...prev.keys],
          };
        });
      } else {
        await onRefresh();
      }
      setShowCreate(false);
      setEditingId(null);
      setName("");
      setAllowedCombo("");
      setDailyTokenLimit("");
      setMonthlyUsdLimit("");
      setFreeOnly(false);
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
    const nextActive = !k.isActive;
    onUpdateWorkspace((prev) =>
      prev
        ? {
            ...prev,
            keys: prev.keys.map((item) =>
              item.id === k.id ? { ...item, isActive: nextActive } : item
            ),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/keys/${k.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        await onRefresh();
        onNotify("Failed to update key state", "error");
      }
    } catch {
      await onRefresh();
      onNotify("Failed to update key state", "error");
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    onUpdateWorkspace((prev) =>
      prev ? { ...prev, keys: prev.keys.filter((k) => k.id !== id) } : prev
    );
    try {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        onNotify("API key revoked.", "success");
      } else {
        await onRefresh();
        onNotify("Failed to revoke key", "error");
      }
    } catch {
      await onRefresh();
      onNotify("Failed to revoke key", "error");
    }
  };

  const copyRawKey = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      onNotify("Clipboard access denied", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            API Keys
          </h2>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create Key</span>
        </button>
      </div>

      {/* One-time Key Reveal Banner */}
      <AnimatePresence>
        {revealedKey && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="bg-[#171C2E] border border-emerald-500/40 rounded-lg p-5"
          >
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
              <code className="flex-1 px-3 py-2 bg-[#101422] border border-[#2B334E] rounded-md font-mono text-xs text-white overflow-x-auto">
                {revealedKey}
              </code>
              <button
                type="button"
                onClick={copyRawKey}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-md whitespace-nowrap shrink-0"
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
          </motion.div>
        )}
      </AnimatePresence>

      {keys.length === 0 ? (
        <div className="bg-[#171C2E] border border-[#2B334E] rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-white">No API keys yet</p>
          <p className="mt-1 text-xs text-[#8B8B95]">
            Create a gateway key to call OpenAI- or Anthropic-compatible endpoints.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Create Key</span>
          </button>
        </div>
      ) : (
        <>
          <div className="md:hidden space-y-3">
            {keys.map((k, idx) => {
              const dotColor = KEY_DOT_COLORS[idx % KEY_DOT_COLORS.length];
              return (
              <motion.div
                key={k.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.2) }}
                className="bg-[#171C2E] border border-[#2B334E] rounded-lg p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: dotColor }}
                      />
                      <span className="font-medium text-white truncate">
                        {k.name}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-[#A1A1AA] truncate">
                      {k.keyPrefix}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium shrink-0 ${
                      k.isActive ? "text-emerald-400" : "text-[#A1A1AA]"
                    }`}
                  >
                    {k.isActive ? "Active" : "Disabled"}
                  </span>
                </div>

                <div className="text-xs font-mono text-[#A1A1AA] space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>
                      {k.allowedCombo ? `combo: ${k.allowedCombo}` : "All models"}
                    </span>
                    {k.freeOnly && (
                      <span className="text-emerald-400">· Free-only</span>
                    )}
                  </div>
                  <div className="text-[#8B8B95] tabular-nums">
                    {k.totalRequests.toLocaleString()} req ·{" "}
                    {k.totalTokens.toLocaleString()} tok · $
                    {k.totalCostUsd.toFixed(4)}
                  </div>
                  {(k.dailyTokenLimit || k.monthlyUsdLimit) && (
                    <div className="text-[#71717A] tabular-nums">
                      Cap:{" "}
                      {k.dailyTokenLimit
                        ? `${k.dailyTokenLimit.toLocaleString()} tok/d`
                        : "∞ tok/d"}{" "}
                      ·{" "}
                      {k.monthlyUsdLimit
                        ? `$${k.monthlyUsdLimit.toFixed(2)}/mo`
                        : "∞ $/mo"}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-[#28304A] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(k)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D4D4D8] hover:text-indigo-400"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => handleToggle(k)}
                      className="text-xs font-medium text-[#A1A1AA] hover:text-white"
                    >
                      {k.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirmDeleteId === k.id) {
                          setConfirmDeleteId(null);
                          handleDelete(k.id);
                        } else {
                          setConfirmDeleteId(k.id);
                        }
                      }}
                      className={`text-xs font-medium ${
                        confirmDeleteId === k.id
                          ? "text-red-300 underline underline-offset-2"
                          : "text-red-400 hover:text-red-300"
                      }`}
                    >
                      {confirmDeleteId === k.id ? "Revoke?" : "Revoke"}
                    </button>
                  </div>
                </div>
              </motion.div>
              );
            })}
          </div>

          <div className="hidden md:block bg-[#171C2E] border border-[#2B334E] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#2B334E] text-xs text-[#A1A1AA]">
                  <th className="py-3 px-5 font-medium">Name & Prefix</th>
                  <th className="py-3 px-4 font-medium">Scope & Caps</th>
                  <th className="py-3 px-4 font-medium">State</th>
                  <th className="py-3 px-4 font-medium text-right">Requests</th>
                  <th className="py-3 px-4 font-medium text-right">Tokens</th>
                  <th className="py-3 px-4 font-medium text-right">Spend</th>
                  <th className="py-3 px-5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2B334E] text-sm">
                {keys.map((k, idx) => {
                  const dotColor = KEY_DOT_COLORS[idx % KEY_DOT_COLORS.length];
                  return (
                  <tr
                    key={k.id}
                    className="hover:bg-[#1F263D]/50 transition-colors"
                  >
                    <td className="py-3 px-5">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                        <span className="font-medium text-white">{k.name}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-xs text-[#A1A1AA]">
                        {k.keyPrefix}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#A1A1AA] font-mono">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>
                          {k.allowedCombo ? `combo: ${k.allowedCombo}` : "All models"}
                        </span>
                        {k.freeOnly && (
                          <span className="text-emerald-400">· Free-only</span>
                        )}
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
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openEditModal(k)}
                          title="Edit key"
                          className="p-1 text-[#A1A1AA] hover:text-indigo-400 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggle(k)}
                          className="text-xs font-medium text-[#A1A1AA] hover:text-white transition-colors whitespace-nowrap"
                        >
                          {k.isActive ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirmDeleteId === k.id) {
                              setConfirmDeleteId(null);
                              handleDelete(k.id);
                            } else {
                              setConfirmDeleteId(k.id);
                            }
                          }}
                          title="Revoke key"
                          className={`p-1 transition-colors ${
                            confirmDeleteId === k.id
                              ? "text-xs font-medium text-red-300 underline underline-offset-2"
                              : "text-[#A1A1AA] hover:text-red-400"
                          }`}
                        >
                          {confirmDeleteId === k.id ? (
                            <span>Revoke?</span>
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
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
        </>
      )}

      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={() => setShowCreate(false)}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-[#171C2E] border border-[#2B334E] rounded-xl p-6"
            >
            <div className="flex items-center justify-between pb-4 border-b border-[#2B334E]">
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
                  className="w-full bg-[#101422] border border-[#2B334E] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Allowed Combo
                </label>
                <select
                  value={allowedCombo}
                  onChange={(e) => setAllowedCombo(e.target.value)}
                  className="w-full bg-[#101422] border border-[#2B334E] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
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
                    className="w-full bg-[#101422] border border-[#2B334E] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
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
                    className="w-full bg-[#101422] border border-[#2B334E] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="border-t border-[#28304A] pt-2">
                <ToggleSwitch
                  checked={freeOnly}
                  onChange={setFreeOnly}
                  label="Strict Free-Only Lock"
                  hint="Block paid models and allow $0 routes only"
                />
              </div>

              <div className="pt-3 border-t border-[#2B334E] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#101422] border border-[#2B334E] rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg whitespace-nowrap"
                >
                  {submitting
                    ? "Saving..."
                    : editingId
                      ? "Save Changes"
                      : "Create Key"}
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
