import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  GripVertical,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  PROVIDER_CATALOG,
  ROUTING_STRATEGIES,
  getProviderSpec,
} from "../shared/catalog.ts";
import { ToggleSwitch } from "./ToggleSwitch.tsx";
import type {
  BootstrapPayload,
  Combo,
  ProviderConnection,
  WildcardRoute,
} from "../types/gateway.ts";

interface CombosViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  wildcards: WildcardRoute[];
  onRefresh: () => Promise<void>;
  onUpdateWorkspace: React.Dispatch<React.SetStateAction<BootstrapPayload | null>>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

interface DraftTier {
  connectionId: string;
  upstreamModel: string;
  weight: number;
}

interface SimulationStep {
  order: number;
  connectionId: string;
  connectionName: string;
  provider: string;
  model: string;
  weight: number;
  decision: "selected" | "fallback_failed" | "skipped";
  reason: string;
}

export function CombosView({
  combos,
  connections,
  wildcards,
  onRefresh,
  onUpdateWorkspace,
  onNotify,
}: CombosViewProps) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [comboName, setComboName] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState("priority");
  const [compressPrompt, setCompressPrompt] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [enableCache, setEnableCache] = useState(false);
  const [buildingFreeAuto, setBuildingFreeAuto] = useState(false);
  const [tiers, setTiers] = useState<DraftTier[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedComboId, setCopiedComboId] = useState<string | null>(null);

  const handleCopyComboId = async (combo: Combo) => {
    try {
      await navigator.clipboard.writeText(combo.name);
      setCopiedComboId(combo.id);
      onNotify(`Copied ${combo.name}`, "success");
      setTimeout(() => {
        setCopiedComboId((prev) => (prev === combo.id ? null : prev));
      }, 1500);
    } catch {
      onNotify("Failed to copy Combo Model ID", "error");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showBuilder) setShowBuilder(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showBuilder]);

  // Wildcard form
  const [wcPattern, setWcPattern] = useState("");
  const [wcComboId, setWcComboId] = useState("");

  // Dry-run simulator
  const [simModel, setSimModel] = useState("");
  const [simPrompt, setSimPrompt] = useState(
    "Write a TypeScript binary search function with unit tests."
  );
  const [simHasTools, setSimHasTools] = useState(false);
  const [simHasImage, setSimHasImage] = useState(false);
  const [simFreeOnly, setSimFreeOnly] = useState(false);
  const [faultIds, setFaultIds] = useState<string[]>([]);
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<{
    requestedModel: string;
    matchedVia: string;
    comboName: string | null;
    strategy: string;
    detectedIntent?: string;
    winner: string | null;
    steps: SimulationStep[];
  } | null>(null);

  const connMap = new Map(connections.map((c) => [c.id, c]));

  const openCreateBuilder = () => {
    const firstConn = connections[0];
    const firstSpec = firstConn
      ? getProviderSpec(firstConn.provider)
      : PROVIDER_CATALOG[0];
    setEditingComboId(null);
    setComboName("");
    setDescription("");
    setStrategy("priority");
    setCompressPrompt(false);
    setFreeOnly(false);
    setEnableCache(false);
    setTiers(
      firstConn
        ? [
            {
              connectionId: firstConn.id,
              upstreamModel:
                firstConn.defaultModel ||
                firstSpec.models[0]?.id ||
                "gemini-4-hydrogen",
              weight: 100,
            },
          ]
        : []
    );
    setShowBuilder(true);
  };

  const openEditBuilder = (combo: Combo) => {
    setEditingComboId(combo.id);
    setComboName(combo.name);
    setDescription(combo.description || "");
    setStrategy(combo.strategy);
    setCompressPrompt(combo.compressPrompt);
    setFreeOnly(Boolean(combo.freeOnly));
    setEnableCache(Boolean(combo.enableCache));
    setTiers(
      combo.tiers.map((t) => ({
        connectionId: t.connectionId,
        upstreamModel: t.upstreamModel,
        weight: t.weight,
      }))
    );
    setShowBuilder(true);
  };

  const addDraftTier = () => {
    if (connections.length === 0) return;
    const conn = connections[tiers.length % connections.length];
    const spec = getProviderSpec(conn.provider);
    setTiers((prev) => [
      ...prev,
      {
        connectionId: conn.id,
        upstreamModel:
          conn.defaultModel || spec.models[0]?.id || "gpt-6-luna",
        weight: 50,
      },
    ]);
  };

  const updateTier = (idx: number, patch: Partial<DraftTier>) => {
    setTiers((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const reorderTiers = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= tiers.length) return;
    const next = [...tiers];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setTiers(next);
  };

  const handleSaveCombo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tiers.length === 0) {
      onNotify("Add at least one provider tier.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const url = editingComboId
        ? `/api/combos/${editingComboId}`
        : "/api/combos";
      const method = editingComboId ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: comboName.trim(),
          description: description.trim() || null,
          strategy,
          compressPrompt,
          freeOnly,
          enableCache,
          tiers: tiers.map((t, i) => ({
            ...t,
            priority: i,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Failed to save combo", "error");
        return;
      }
      const savedCombo = data.combo as Combo | undefined;
      if (savedCombo) {
        onUpdateWorkspace((prev) =>
          prev
            ? {
                ...prev,
                combos: editingComboId
                  ? prev.combos.map((c) => (c.id === savedCombo.id ? savedCombo : c))
                  : [savedCombo, ...prev.combos],
              }
            : prev
        );
      } else {
        await onRefresh();
      }
      setShowBuilder(false);
      onNotify(
        editingComboId
          ? `Combo "${comboName.trim()}" updated.`
          : `Combo "${comboName.trim()}" created.`,
        "success"
      );
    } catch {
      onNotify("Network error saving combo", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleCombo = async (combo: Combo) => {
    const nextActive = !combo.isActive;
    onUpdateWorkspace((prev) =>
      prev
        ? {
            ...prev,
            combos: prev.combos.map((c) =>
              c.id === combo.id ? { ...c, isActive: nextActive } : c
            ),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        await onRefresh();
        onNotify("Failed to update combo state", "error");
      }
    } catch {
      await onRefresh();
      onNotify("Failed to update combo state", "error");
    }
  };

  const handleDeleteCombo = async (id: string) => {
    setConfirmDeleteId(null);
    onUpdateWorkspace((prev) =>
      prev
        ? {
            ...prev,
            combos: prev.combos.filter((c) => c.id !== id),
            wildcards: prev.wildcards.filter((w) => w.comboId !== id),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        onNotify("Combo deleted.", "success");
      } else {
        await onRefresh();
        onNotify("Failed to delete combo", "error");
      }
    } catch {
      await onRefresh();
      onNotify("Failed to delete combo", "error");
    }
  };

  const handleAutoBuildFreeCombo = async () => {
    setBuildingFreeAuto(true);
    try {
      const res = await fetch("/api/combos/free-auto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Unable to build free-auto combo", "error");
        return;
      }
      const builtCombo = data.combo as Combo | undefined;
      if (builtCombo) {
        onUpdateWorkspace((prev) => {
          if (!prev) return prev;
          const exists = prev.combos.some((c) => c.id === builtCombo.id);
          return {
            ...prev,
            combos: exists
              ? prev.combos.map((c) => (c.id === builtCombo.id ? builtCombo : c))
              : [builtCombo, ...prev.combos],
          };
        });
      } else {
        await onRefresh();
      }
      onNotify(
        `Built "${data.combo?.name || "free-auto"}" with ${data.tierCount ?? 0} verified free tier(s).`,
        "success"
      );
    } catch {
      onNotify("Network error building free-auto combo", "error");
    } finally {
      setBuildingFreeAuto(false);
    }
  };

  const handleAddWildcard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wcPattern.trim() || !wcComboId) return;
    try {
      const res = await fetch("/api/wildcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: wcPattern.trim(),
          comboId: wcComboId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setWcPattern("");
        if (data.wildcard) {
          onUpdateWorkspace((prev) =>
            prev
              ? { ...prev, wildcards: [data.wildcard, ...prev.wildcards] }
              : prev
          );
        } else {
          await onRefresh();
        }
        onNotify("Wildcard mapping added.", "success");
      }
    } catch {
      onNotify("Failed to save wildcard route", "error");
    }
  };

  const handleDeleteWildcard = async (id: string) => {
    onUpdateWorkspace((prev) =>
      prev
        ? { ...prev, wildcards: prev.wildcards.filter((w) => w.id !== id) }
        : prev
    );
    try {
      const res = await fetch(`/api/wildcards/${id}`, { method: "DELETE" });
      if (!res.ok) {
        await onRefresh();
        onNotify("Failed to remove wildcard", "error");
      }
    } catch {
      await onRefresh();
      onNotify("Failed to remove wildcard", "error");
    }
  };

  const runDrySimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = simModel.trim() || combos[0]?.name || "";
    if (!target) {
      onNotify("Enter a combo name or model alias to simulate.", "error");
      return;
    }
    setSimRunning(true);
    try {
      const res = await fetch("/api/combos/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedModel: target,
          samplePrompt: simPrompt,
          hasTools: simHasTools,
          hasImage: simHasImage,
          freeOnly: simFreeOnly,
          simulatedFaultConnectionIds: faultIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Dry-run failed", "error");
        return;
      }
      setSimResult(data);
    } catch {
      onNotify("Failed to run dry-run simulation", "error");
    } finally {
      setSimRunning(false);
    }
  };

  const selectedStrategySpec = ROUTING_STRATEGIES.find(
    (s) => s.id === strategy
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="font-display text-lg font-semibold text-white">
          Combos
        </h2>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleAutoBuildFreeCombo}
            disabled={connections.length === 0 || buildingFreeAuto}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#111114] hover:bg-[#18181B] disabled:opacity-50 text-[#D4D4D8] hover:text-white border border-[#222227] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {buildingFreeAuto ? "Building..." : "Auto-Build Free"}
            </span>
          </button>
          <button
            type="button"
            onClick={openCreateBuilder}
            disabled={connections.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-[#09090B] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Combo</span>
          </button>
        </div>
      </div>

      {/* Combos List */}
      {combos.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-white">No combos yet</p>
          <p className="mt-1 text-xs text-[#71717A]">
            Create a routing combo or auto-build one from your connected free models.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {combos.map((combo) => {
            const stratSpec = ROUTING_STRATEGIES.find(
              (s) => s.id === combo.strategy
            );
            return (
              <div
                key={combo.id}
                className="bg-[#111114] border border-[#222227] rounded-lg p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-base font-semibold text-white truncate">
                          {combo.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyComboId(combo)}
                          title="Copy Combo Model ID"
                          aria-label={`Copy combo model ID ${combo.name}`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border transition-colors shrink-0 ${
                            copiedComboId === combo.id
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : "border-[#222227] bg-[#09090B] text-[#A1A1AA] hover:text-white hover:border-[#3F3F46]"
                          }`}
                        >
                          {copiedComboId === combo.id ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy ID</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="mt-1 text-xs text-[#A1A1AA] flex flex-wrap items-center gap-x-1.5">
                        <span>{stratSpec?.label || combo.strategy}</span>
                        <span>·</span>
                        <span>{combo.tiers.length} tiers</span>
                        {combo.compressPrompt && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-400">
                              Compression
                            </span>
                          </>
                        )}
                        {combo.freeOnly && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-400">Free-only</span>
                          </>
                        )}
                        {combo.enableCache && (
                          <>
                            <span>·</span>
                            <span className="text-sky-400">Cached</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditBuilder(combo)}
                        title="Edit combo"
                        className="p-1 text-[#A1A1AA] hover:text-white transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleCombo(combo)}
                        className={`text-xs font-medium transition-colors whitespace-nowrap ${
                          combo.isActive
                            ? "text-emerald-400 hover:text-emerald-300"
                            : "text-[#A1A1AA] hover:text-white"
                        }`}
                      >
                        {combo.isActive ? "Active" : "Paused"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDeleteId === combo.id) {
                            setConfirmDeleteId(null);
                            handleDeleteCombo(combo.id);
                          } else {
                            setConfirmDeleteId(combo.id);
                          }
                        }}
                        title="Delete combo"
                        className={`p-1 transition-colors ${
                          confirmDeleteId === combo.id
                            ? "text-xs font-medium text-red-300 underline underline-offset-2"
                            : "text-[#A1A1AA] hover:text-red-400"
                        }`}
                      >
                        {confirmDeleteId === combo.id ? (
                          <span>Confirm?</span>
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {combo.description && (
                    <p className="mt-2 text-xs text-[#A1A1AA]">
                      {combo.description}
                    </p>
                  )}

                  <div className="mt-4 border-t border-[#222227] divide-y divide-[#222227]">
                    {combo.tiers.map((tier, idx) => {
                      const conn = connMap.get(tier.connectionId);
                      return (
                        <div
                          key={tier.id}
                          className="py-2.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-[#A1A1AA] tabular-nums w-5">
                              #{idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="font-mono text-[#F3F4F6] truncate">
                                {tier.upstreamModel}
                              </div>
                              <div className="text-[#A1A1AA] truncate">
                                {conn?.name || "Unknown"} ·{" "}
                                {conn?.provider || "custom"}
                              </div>
                            </div>
                          </div>
                          <div className="font-mono text-[#A1A1AA] tabular-nums shrink-0 text-right">
                            <span>w:{tier.weight}</span>
                            <span className="mx-1.5">·</span>
                            <span>{tier.requestCount} reqs</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wildcards & Dry-Run Route Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Wildcard Model Mappings */}
        <div className="bg-[#111114] border border-[#222227] rounded-lg p-5">
          <h3 className="font-display text-base font-semibold text-white">
            Wildcard Routes
          </h3>

          <form onSubmit={handleAddWildcard} className="mt-4 flex gap-2">
            <input
              type="text"
              aria-label="Wildcard model pattern"
              value={wcPattern}
              onChange={(e) => setWcPattern(e.target.value)}
              className="w-36 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
            />
            <select
              value={wcComboId}
              onChange={(e) => setWcComboId(e.target.value)}
              className="flex-1 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
            >
              <option value="">Select target combo...</option>
              {combos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!wcPattern.trim() || !wcComboId}
              className="px-3.5 py-2 text-xs font-medium bg-[#18181B] hover:bg-[#1F2937] disabled:opacity-50 text-white border border-[#222227] rounded-lg whitespace-nowrap"
            >
              Add Rule
            </button>
          </form>

          <div className="mt-4 border-t border-[#222227] divide-y divide-[#222227]">
            {wildcards.length === 0 ? (
              <p className="py-5 text-xs text-[#A1A1AA] text-center">
                No wildcard mappings configured.
              </p>
            ) : (
              wildcards.map((wc) => {
                const target = combos.find((c) => c.id === wc.comboId);
                return (
                  <div
                    key={wc.id}
                    className="py-2.5 flex items-center justify-between text-xs"
                  >
                    <div className="font-mono">
                      <span className="text-white">{wc.pattern}</span>
                      <span className="mx-2 text-[#A1A1AA]">→</span>
                      <span className="text-amber-400">
                        {target?.name || "Deleted combo"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteWildcard(wc.id)}
                      className="text-[#A1A1AA] hover:text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Dry-Run Route Simulator */}
        <div className="bg-[#111114] border border-[#222227] rounded-lg p-5 space-y-3">
          <h3 className="font-display text-base font-semibold text-white">
            Dry-Run Simulator
          </h3>

          <form onSubmit={runDrySimulation} className="space-y-3">
            <div>
              <label className="block text-xs text-[#A1A1AA] mb-1.5">
                Combo or model alias
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={simModel}
                  onChange={(e) => setSimModel(e.target.value)}
                  className="flex-1 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={simRunning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#18181B] hover:bg-[#222227] border border-[#27272A] text-white rounded-lg whitespace-nowrap transition-colors"
                >
                  <Play className="w-3.5 h-3.5 text-amber-400" />
                  <span>{simRunning ? "Simulating..." : "Run"}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-[#A1A1AA] mb-1.5">
                Sample prompt
              </label>
              <input
                type="text"
                value={simPrompt}
                onChange={(e) => setSimPrompt(e.target.value)}
                className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSimHasTools((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  simHasTools
                    ? "bg-[#18181B] border-amber-400/50 text-amber-300"
                    : "bg-[#09090B] border-[#222227] text-[#A1A1AA] hover:text-white"
                }`}
              >
                Tools
              </button>
              <button
                type="button"
                onClick={() => setSimHasImage((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  simHasImage
                    ? "bg-[#18181B] border-amber-400/50 text-amber-300"
                    : "bg-[#09090B] border-[#222227] text-[#A1A1AA] hover:text-white"
                }`}
              >
                Image
              </button>
              <button
                type="button"
                onClick={() => setSimFreeOnly((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  simFreeOnly
                    ? "bg-[#18181B] border-emerald-500/50 text-emerald-300"
                    : "bg-[#09090B] border-[#222227] text-[#A1A1AA] hover:text-white"
                }`}
              >
                Free only
              </button>
            </div>
          </form>

          {connections.length > 0 && (
            <div className="pt-1">
              <div className="text-xs text-[#A1A1AA] mb-1.5">
                Simulate 429 faults:
              </div>
              <div className="flex flex-wrap gap-2">
                {connections.map((c) => {
                  const active = faultIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setFaultIds((prev) =>
                          active
                            ? prev.filter((id) => id !== c.id)
                            : [...prev, c.id]
                        )
                      }
                      className={`px-2.5 py-1 text-xs rounded-lg border transition-colors whitespace-nowrap ${
                        active
                          ? "bg-red-500/15 border-red-500/40 text-red-300"
                          : "bg-[#09090B] border-[#222227] text-[#A1A1AA] hover:text-white"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <AnimatePresence>
            {simResult && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="pt-3 border-t border-[#222227] space-y-2"
              >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-[#A1A1AA]">
                  Strategy{" "}
                  <span className="text-white font-mono">
                    {simResult.strategy}
                  </span>
                  {simResult.detectedIntent && (
                    <>
                      {" · Intent "}
                      <span className="text-emerald-400 font-mono">
                        {simResult.detectedIntent}
                      </span>
                    </>
                  )}
                </span>
                <span
                  className={
                    simResult.winner ? "text-emerald-400" : "text-red-400"
                  }
                >
                  {simResult.winner
                    ? `Winner: ${simResult.winner}`
                    : "No eligible tier"}
                </span>
              </div>
              <div className="divide-y divide-[#222227] border border-[#222227] rounded-lg bg-[#09090B]">
                {simResult.steps.map((step) => (
                  <div
                    key={`${step.order}-${step.connectionId}-${step.model}`}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="font-mono text-[#D4D4D8] truncate">
                      #{step.order} {step.connectionName} → {step.model}
                    </div>
                    <div
                      className={`font-mono shrink-0 ${
                        step.decision === "selected"
                          ? "text-emerald-400"
                          : step.decision === "fallback_failed"
                            ? "text-amber-400"
                            : "text-[#A1A1AA]"
                      }`}
                    >
                      {step.reason}
                    </div>
                  </div>
                ))}
              </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Create / Edit Combo Builder Modal with Drag-and-Drop Tiers */}
      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={() => setShowBuilder(false)}
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-[#111114] border border-[#222227] rounded-xl p-6 max-h-[90vh] overflow-y-auto"
            >
            <div className="flex items-center justify-between pb-4 border-b border-[#222227]">
              <h3 className="font-display text-base font-semibold text-white">
                {editingComboId
                  ? "Edit Routing Combo"
                  : "Create Routing Combo"}
              </h3>
              <button
                type="button"
                onClick={() => setShowBuilder(false)}
                className="text-[#A1A1AA] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCombo} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Virtual Model Alias
                  </label>
                  <input
                    type="text"
                    required
                    value={comboName}
                    onChange={(e) => setComboName(e.target.value)}
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                    Balancing Strategy
                  </label>
                  <select
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value)}
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                  >
                    {ROUTING_STRATEGIES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedStrategySpec && (
                <p className="text-xs text-[#A1A1AA]">
                  {selectedStrategySpec.description}
                </p>
              )}

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="divide-y divide-[#1D1D22] border-y border-[#1D1D22] py-1">
                <ToggleSwitch
                  checked={compressPrompt}
                  onChange={setCompressPrompt}
                  label="Prompt compression"
                  hint="Trim redundant whitespace to reduce input tokens"
                />
                <ToggleSwitch
                  checked={freeOnly}
                  onChange={setFreeOnly}
                  label="Strict Free-Only Lock"
                  hint="Block paid models even on fallback"
                />
                <ToggleSwitch
                  checked={enableCache}
                  onChange={setEnableCache}
                  label="Response caching"
                  hint="Cache identical requests for 10m to save quota"
                />
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-[#D4D4D8]">
                    Provider Tiers (Drag handles to reorder fallback priority)
                  </span>
                  <button
                    type="button"
                    onClick={addDraftTier}
                    className="text-xs font-medium text-amber-400 hover:text-amber-300"
                  >
                    + Add Tier
                  </button>
                </div>

                <div className="space-y-2.5">
                  {tiers.map((tier, idx) => {
                    const conn = connMap.get(tier.connectionId);
                    const spec = getProviderSpec(conn?.provider || "custom");
                    const isDragged = dragIndex === idx;
                    const isDropTarget =
                      dragOverIndex === idx && dragIndex !== idx;

                    return (
                      <div
                        key={idx}
                        draggable
                        onDragStart={() => setDragIndex(idx)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (dragOverIndex !== idx) setDragOverIndex(idx);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null) {
                            reorderTiers(dragIndex, idx);
                          }
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        className={`p-3 bg-[#09090B] border rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center transition-colors ${
                          isDropTarget
                            ? "border-amber-400"
                            : isDragged
                              ? "border-[#374151] opacity-60"
                              : "border-[#222227]"
                        }`}
                      >
                        <div className="sm:col-span-1 flex items-center gap-1.5 text-[#A1A1AA] cursor-grab active:cursor-grabbing">
                          <GripVertical className="w-4 h-4 shrink-0" />
                          <span className="font-mono text-xs tabular-nums">
                            {idx + 1}
                          </span>
                        </div>

                        <div className="sm:col-span-4">
                          <select
                            value={tier.connectionId}
                            onChange={(e) => {
                              const nextConn = connMap.get(e.target.value);
                              const nextSpec = getProviderSpec(
                                nextConn?.provider || "custom"
                              );
                              updateTier(idx, {
                                connectionId: e.target.value,
                                upstreamModel:
                                  nextConn?.defaultModel ||
                                  nextSpec.models[0]?.id ||
                                  tier.upstreamModel,
                              });
                            }}
                            className="w-full bg-[#111114] border border-[#222227] rounded-md px-2.5 py-1.5 text-xs text-white"
                          >
                            {connections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.provider})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            list={`models-${idx}`}
                            value={tier.upstreamModel}
                            onChange={(e) =>
                              updateTier(idx, { upstreamModel: e.target.value })
                            }
                            className="w-full bg-[#111114] border border-[#222227] rounded-md px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                          <datalist id={`models-${idx}`}>
                            {Array.from(
                              new Set([
                                ...(conn?.defaultModel ? [conn.defaultModel] : []),
                                ...(conn?.availableModels || []),
                                ...spec.models.map((m) => m.id),
                              ])
                            ).map((modelId) => (
                              <option key={modelId} value={modelId} />
                            ))}
                          </datalist>
                        </div>

                        <div className="sm:col-span-1">
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={tier.weight}
                            onChange={(e) =>
                              updateTier(idx, {
                                weight: Number(e.target.value) || 1,
                              })
                            }
                            title="Weight"
                            className="w-full bg-[#111114] border border-[#222227] rounded-md px-2 py-1.5 text-xs font-mono text-white text-center"
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => reorderTiers(idx, idx - 1)}
                            disabled={idx === 0}
                            className="p-1 text-[#A1A1AA] hover:text-white disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => reorderTiers(idx, idx + 1)}
                            disabled={idx === tiers.length - 1}
                            className="p-1 text-[#A1A1AA] hover:text-white disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setTiers((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            disabled={tiers.length <= 1}
                            className="p-1 text-[#A1A1AA] hover:text-red-400 disabled:opacity-30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-[#222227] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowBuilder(false)}
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
                    ? editingComboId
                      ? "Saving Changes..."
                      : "Creating..."
                    : editingComboId
                      ? "Save Changes"
                      : "Create Combo"}
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
