import React, { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  PROVIDER_CATALOG,
  ROUTING_STRATEGIES,
  getProviderSpec,
} from "../shared/catalog.ts";
import type {
  Combo,
  ProviderConnection,
  WildcardRoute,
} from "../types/gateway.ts";

interface CombosViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  wildcards: WildcardRoute[];
  onRefresh: () => Promise<void>;
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
  onNotify,
}: CombosViewProps) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [comboName, setComboName] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState("priority");
  const [compressPrompt, setCompressPrompt] = useState(false);
  const [tiers, setTiers] = useState<DraftTier[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    setTiers(
      firstConn
        ? [
            {
              connectionId: firstConn.id,
              upstreamModel:
                firstConn.defaultModel ||
                firstSpec.models[0]?.id ||
                "gemini-2.5-flash",
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
          conn.defaultModel || spec.models[0]?.id || "gpt-4o-mini",
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
      setShowBuilder(false);
      await onRefresh();
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
    try {
      const res = await fetch(`/api/combos/${combo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !combo.isActive }),
      });
      if (res.ok) await onRefresh();
    } catch {
      onNotify("Failed to update combo state", "error");
    }
  };

  const handleDeleteCombo = async (id: string) => {
    try {
      const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
      if (res.ok) {
        await onRefresh();
        onNotify("Combo deleted.", "success");
      }
    } catch {
      onNotify("Failed to delete combo", "error");
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
      if (res.ok) {
        setWcPattern("");
        await onRefresh();
        onNotify("Wildcard mapping added.", "success");
      }
    } catch {
      onNotify("Failed to save wildcard route", "error");
    }
  };

  const handleDeleteWildcard = async (id: string) => {
    try {
      const res = await fetch(`/api/wildcards/${id}`, { method: "DELETE" });
      if (res.ok) await onRefresh();
    } catch {
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

      {/* Combos List */}
      {combos.length === 0 ? (
        <div className="bg-[#111114] border border-[#222227] rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-white">No combos</p>
          {connections.length > 0 && (
            <button
              type="button"
              onClick={openCreateBuilder}
              className="mt-4 px-4 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg transition-colors whitespace-nowrap"
            >
              New Combo
            </button>
          )}
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
                    <div>
                      <div className="font-mono text-base font-semibold text-white">
                        {combo.name}
                      </div>
                      <div className="mt-1 text-xs text-[#A1A1AA]">
                        <span>{stratSpec?.label || combo.strategy}</span>
                        <span className="mx-1.5">·</span>
                        <span>{combo.tiers.length} tiers</span>
                        {combo.compressPrompt && (
                          <>
                            <span className="mx-1.5">·</span>
                            <span className="text-emerald-400">
                              Compression on
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditBuilder(combo)}
                        title="Edit combo"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-[#09090B] border border-[#222227] rounded-md text-[#D4D4D8] hover:text-white whitespace-nowrap"
                      >
                        <Pencil className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleCombo(combo)}
                        className="px-2.5 py-1 text-xs font-medium bg-[#09090B] border border-[#222227] rounded-md text-[#D4D4D8] hover:text-white whitespace-nowrap"
                      >
                        {combo.isActive ? "Active" : "Paused"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCombo(combo.id)}
                        className="p-1.5 text-[#A1A1AA] hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
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
              value={wcPattern}
              onChange={(e) => setWcPattern(e.target.value)}
              placeholder="gpt-4*"
              className="w-36 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
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
            <div className="flex gap-2">
              <input
                type="text"
                value={simModel}
                onChange={(e) => setSimModel(e.target.value)}
                placeholder={combos[0]?.name || "Enter combo or model name"}
                className="flex-1 bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                disabled={simRunning}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-amber-400 hover:bg-amber-300 text-[#09090B] rounded-lg whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{simRunning ? "Simulating..." : "Run Dry-Run"}</span>
              </button>
            </div>

            <input
              type="text"
              value={simPrompt}
              onChange={(e) => setSimPrompt(e.target.value)}
              placeholder="Sample prompt for intent_auto classifier..."
              className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
            />

            <div className="flex flex-wrap items-center gap-4 text-xs text-[#D4D4D8]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simHasTools}
                  onChange={(e) => setSimHasTools(e.target.checked)}
                  className="rounded border-[#222227] bg-[#09090B]"
                />
                <span>Includes tools[]</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={simHasImage}
                  onChange={(e) => setSimHasImage(e.target.checked)}
                  className="rounded border-[#222227] bg-[#09090B]"
                />
                <span>Includes image_url</span>
              </label>
            </div>
          </form>

          {connections.length > 0 && (
            <div>
              <div className="text-xs text-[#A1A1AA] mb-1.5">
                Inject simulated 429 rate-limit faults:
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
                      className={`px-2.5 py-1 text-xs rounded-md border transition-colors whitespace-nowrap ${
                        active
                          ? "bg-red-500/15 border-red-500/40 text-red-300"
                          : "bg-[#09090B] border-[#222227] text-[#A1A1AA] hover:text-white"
                      }`}
                    >
                      {active ? `429 Fault: ${c.name}` : c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {simResult && (
            <div className="pt-3 border-t border-[#222227] space-y-2">
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
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Combo Builder Modal with Drag-and-Drop Tiers */}
      {showBuilder && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#111114] border border-[#222227] rounded-xl p-6 max-h-[90vh] overflow-y-auto">
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
                    placeholder="e.g. smart-auto"
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
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
                  placeholder="Routes coding/reasoning to flagship tier and fast chat to lite tier"
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-sm text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs text-[#D4D4D8] cursor-pointer">
                <input
                  type="checkbox"
                  checked={compressPrompt}
                  onChange={(e) => setCompressPrompt(e.target.checked)}
                  className="rounded border-[#222227] bg-[#09090B]"
                />
                <span>
                  Enable whitespace & prompt compression to reduce input tokens
                </span>
              </label>

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
                            placeholder="Upstream model ID"
                            className="w-full bg-[#111114] border border-[#222227] rounded-md px-2.5 py-1.5 text-xs font-mono text-white"
                          />
                          <datalist id={`models-${idx}`}>
                            {conn?.defaultModel &&
                              !spec.models.some(
                                (m) => m.id === conn.defaultModel
                              ) && <option value={conn.defaultModel} />}
                            {spec.models.map((m) => (
                              <option key={m.id} value={m.id} />
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
          </div>
        </div>
      )}
    </div>
  );
}
