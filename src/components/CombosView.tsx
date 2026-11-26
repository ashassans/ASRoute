import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
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
  READY_MADE_COMBO_PRESETS,
  type ReadyMadeComboPreset,
  ROUTING_STRATEGIES,
  getConnectionPrefix,
  getProviderSpec,
  isSearchProvider,
} from "../shared/catalog.ts";
import { ToggleSwitch } from "./ToggleSwitch.tsx";
import { getComboAccent, getProviderVisual } from "../lib/providerVisuals.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
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
  maxRetries: number;
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

interface ComboboxOption {
  value: string;
  label?: string;
  group?: string;
}

function ModelCombobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  inputClassName = "w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  ariaLabel?: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (showAll || !q) return options;
    return options.filter(
      (opt) =>
        opt.value.toLowerCase().includes(q) ||
        (opt.label && opt.label.toLowerCase().includes(q)) ||
        (opt.group && opt.group.toLowerCase().includes(q))
    );
  }, [options, value, showAll]);

  useEffect(() => {
    setHighlighted(0);
  }, [filtered.length, open]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      setShowAll(true);
      e.preventDefault();
      return;
    }
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) {
        setHighlighted((prev) => (prev + 1) % filtered.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) {
        setHighlighted((prev) => (prev - 1 + filtered.length) % filtered.length);
      }
    } else if (e.key === "Enter" && filtered[highlighted]) {
      e.preventDefault();
      onChange(filtered[highlighted].value);
      setOpen(false);
      setShowAll(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setShowAll(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setShowAll(false);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className={`${inputClassName} pr-7`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Toggle model suggestions"
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) setShowAll(true);
            return next;
          });
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-ink-dim hover:text-ink transition-colors"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && filtered.length > 0 && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-canvas border border-hairline rounded-lg shadow-2xl z-40 py-1 divide-y divide-hairline"
        >
          {filtered.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === highlighted;
            return (
              <button
                key={`${opt.group || "opt"}-${opt.value}-${idx}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlighted(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value);
                  setOpen(false);
                  setShowAll(false);
                }}
                className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between gap-2 transition-colors ${
                  isSelected
                    ? "bg-indigo-500/15 text-indigo-300"
                    : isActive
                      ? "bg-elevated text-ink"
                      : "text-ink-2 hover:bg-surface"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs truncate">{opt.value}</div>
                  {opt.label && opt.label !== opt.value && (
                    <div className="text-[10px] text-ink-dim truncate">
                      {opt.label}
                    </div>
                  )}
                </div>
                {opt.group && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-hairline text-ink-muted shrink-0">
                    {opt.group}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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
  const builderModalRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(builderModalRef, showBuilder);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [comboName, setComboName] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState("priority");
  const [compressPrompt, setCompressPrompt] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [enableCache, setEnableCache] = useState(false);
  const [buildingFreeAuto, setBuildingFreeAuto] = useState(false);
  const [creatingPresetId, setCreatingPresetId] = useState<string | null>(null);
  const [creatingAllPresets, setCreatingAllPresets] = useState(false);
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

  const llmConnections = connections.filter(
    (c) => !isSearchProvider(c.provider)
  );
  const connMap = new Map(connections.map((c) => [c.id, c]));

  const simulatorOptions = useMemo<ComboboxOption[]>(() => {
    const seen = new Set<string>();
    const opts: ComboboxOption[] = [];
    const push = (value: string, label?: string, group?: string) => {
      const v = value.trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      opts.push({ value: v, label, group });
    };

    if (llmConnections.some((c) => c.isActive)) {
      push("auto", "Built-in smart intent router", "Built-in");
      push("claude", "Built-in always-best model router", "Built-in");
    }

    for (const c of combos) {
      push(c.name, `${c.strategy} · ${c.tiers.length} tiers`, "Combo");
    }
    for (const wc of wildcards) {
      if (wc.isActive) {
        const target = combos.find((c) => c.id === wc.comboId);
        push(
          wc.pattern.replace(/\*+$/, "mini"),
          target ? `Matches ${wc.pattern} → ${target.name}` : wc.pattern,
          "Wildcard"
        );
      }
    }
    for (const conn of llmConnections) {
      if (!conn.isActive) continue;
      const spec = getProviderSpec(conn.provider);
      const prefix = getConnectionPrefix(conn);
      if (conn.defaultModel) {
        push(`${prefix}/${conn.defaultModel}`, conn.name, spec.label);
      }
      for (const m of conn.availableModels || []) {
        push(`${prefix}/${m}`, conn.name, spec.label);
      }
      for (const m of spec.models) {
        push(`${prefix}/${m.id}`, m.label, spec.label);
      }
    }
    return opts;
  }, [combos, wildcards, llmConnections]);

  const openCreateBuilder = () => {
    const firstConn = llmConnections[0];
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
              maxRetries: 1,
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
      combo.tiers
        .filter((t) => {
          const c = connMap.get(t.connectionId);
          return !c || !isSearchProvider(c.provider);
        })
        .map((t) => ({
          connectionId: t.connectionId,
          upstreamModel: t.upstreamModel,
          weight: t.weight,
          maxRetries: t.maxRetries ?? 1,
        }))
    );
    setShowBuilder(true);
  };

  const addDraftTier = () => {
    if (llmConnections.length === 0) return;
    const conn = llmConnections[tiers.length % llmConnections.length];
    const spec = getProviderSpec(conn.provider);
    setTiers((prev) => [
      ...prev,
      {
        connectionId: conn.id,
        upstreamModel:
          conn.defaultModel || spec.models[0]?.id || "gpt-6-luna",
        weight: 50,
        maxRetries: 1,
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
      onNotify("Add at least one AI provider tier.", "error");
      return;
    }
    const hasSearchTier = tiers.some((t) => {
      const conn = connMap.get(t.connectionId);
      return conn ? isSearchProvider(conn.provider) : false;
    });
    if (hasSearchTier) {
      onNotify(
        "Web search providers cannot be combined into AI combos.",
        "error"
      );
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
        onUpdateWorkspace((prev) => {
          if (!prev) return prev;
          const exists = prev.combos.some((c) => c.id === savedCombo.id);
          return {
            ...prev,
            combos: exists
              ? prev.combos.map((c) => (c.id === savedCombo.id ? savedCombo : c))
              : [savedCombo, ...prev.combos],
          };
        });
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

  const handleBuildPresetCombo = async (
    preset: ReadyMadeComboPreset,
    silent = false
  ): Promise<boolean> => {
    setCreatingPresetId(preset.id);
    try {
      const res = await fetch("/api/combos/preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId: preset.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (!silent) {
          onNotify(
            data.error || `Unable to build "${preset.name}" combo`,
            "error"
          );
        }
        return false;
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
      if (!silent) {
        onNotify(
          `${data.updated ? "Synced" : "Created"} "${preset.name}" with ${data.tierCount ?? 0} tier(s).`,
          "success"
        );
      }
      return true;
    } catch {
      if (!silent) {
        onNotify(`Network error building "${preset.name}" combo`, "error");
      }
      return false;
    } finally {
      setCreatingPresetId(null);
    }
  };

  const handleBuildAllPresetCombos = async () => {
    setCreatingAllPresets(true);
    let createdCount = 0;
    try {
      for (const preset of READY_MADE_COMBO_PRESETS) {
        const ok = await handleBuildPresetCombo(preset, true);
        if (ok) createdCount += 1;
      }
      if (createdCount > 0) {
        onNotify(
          `Synced ${createdCount} ready-made combo(s) from your connected providers.`,
          "success"
        );
      } else {
        onNotify(
          "No active provider models available to build combos.",
          "error"
        );
      }
    } finally {
      setCreatingAllPresets(false);
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
          const savedWc = data.wildcard as WildcardRoute;
          onUpdateWorkspace((prev) => {
            if (!prev) return prev;
            const exists = prev.wildcards.some((w) => w.id === savedWc.id);
            return {
              ...prev,
              wildcards: exists
                ? prev.wildcards.map((w) => (w.id === savedWc.id ? savedWc : w))
                : [savedWc, ...prev.wildcards],
            };
          });
        } else {
          await onRefresh();
        }
        onNotify("Wildcard mapping added.", "success");
      }
    } catch {
      onNotify("Failed to save wildcard route", "error");
    }
  };

  const handleToggleWildcard = async (wc: WildcardRoute) => {
    const nextActive = !wc.isActive;
    onUpdateWorkspace((prev) =>
      prev
        ? {
            ...prev,
            wildcards: prev.wildcards.map((item) =>
              item.id === wc.id ? { ...item, isActive: nextActive } : item
            ),
          }
        : prev
    );
    try {
      const res = await fetch(`/api/wildcards/${wc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        await onRefresh();
        onNotify("Failed to update wildcard state", "error");
      }
    } catch {
      await onRefresh();
      onNotify("Failed to update wildcard state", "error");
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
        <h2 className="font-display text-lg font-semibold text-ink">
          Combos
        </h2>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleAutoBuildFreeCombo}
            disabled={llmConnections.length === 0 || buildingFreeAuto}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-surface hover:bg-elevated disabled:opacity-50 text-ink-2 hover:text-ink border border-hairline rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>
              {buildingFreeAuto ? "Building..." : "Auto-Build Free"}
            </span>
          </button>
          <button
            type="button"
            onClick={openCreateBuilder}
            disabled={llmConnections.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Combo</span>
          </button>
        </div>
      </div>

      {llmConnections.length === 0 && connections.some((c) => isSearchProvider(c.provider)) && (
        <div className="bg-surface border border-hairline rounded-lg px-4 py-3 text-xs text-ink-muted">
          Web Search providers (Tavily, Brave Search, Exa) are kept separate in the <span className="text-ink font-medium">Search</span> tab and cannot be combined with AI models. Connect at least one AI model provider to build combos.
        </div>
      )}

      {/* Ready-Made Combo Templates */}
      <section className="bg-surface border border-hairline rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-sm font-semibold text-ink">
                Ready-Made Combos
              </h3>
              <span className="px-2 py-0.5 text-[11px] font-mono rounded bg-elevated border border-hairline-strong text-ink-muted">
                {READY_MADE_COMBO_PRESETS.length} presets
              </span>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              1-click auto-configured failover combos built from your connected providers.
            </p>
          </div>
          <button
            type="button"
            onClick={handleBuildAllPresetCombos}
            disabled={llmConnections.length === 0 || creatingAllPresets}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-elevated hover:bg-subtle disabled:opacity-50 text-ink border border-hairline-strong rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              {creatingAllPresets ? "Building All..." : "Create All"}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {READY_MADE_COMBO_PRESETS.map((preset) => {
            const existingCombo = combos.find(
              (c) => c.name.trim().toLowerCase() === preset.name.toLowerCase()
            );
            const stratSpec = ROUTING_STRATEGIES.find(
              (s) => s.id === preset.strategy
            );
            const isBusy =
              creatingPresetId === preset.id || creatingAllPresets;
            const comboAccent = getComboAccent(preset.name);

            return (
              <motion.div
                key={preset.id}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.2 }}
                className="relative overflow-hidden bg-canvas border border-hairline hover:border-hairline-strong rounded-lg p-3.5 flex flex-col justify-between gap-3 transition-colors"
              >
                <span
                  className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-80"
                  style={{
                    background: `linear-gradient(90deg, ${comboAccent.color}, transparent 75%)`,
                  }}
                />
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border shrink-0"
                        style={{
                          color: comboAccent.color,
                          backgroundColor: comboAccent.softBg,
                          borderColor: comboAccent.border,
                        }}
                      >
                        {preset.badge}
                      </span>
                      <span className="font-mono text-xs font-semibold text-ink truncate">
                        {preset.name}
                      </span>
                    </div>
                    {existingCombo && (
                      <span className="text-[11px] font-medium text-emerald-400 shrink-0">
                        {existingCombo.tiers.length} tiers
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted leading-relaxed">
                    {preset.description}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-hairline">
                  <span className="text-[11px] text-ink-dim truncate">
                    {stratSpec?.label.split(" ")[0] || preset.strategy}
                    {preset.freeOnly ? " · Free-only" : ""}
                    {preset.enableCache ? " · Cached" : ""}
                  </span>
                  <button
                    type="button"
                    disabled={llmConnections.length === 0 || isBusy}
                    onClick={() => handleBuildPresetCombo(preset)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap shrink-0 disabled:opacity-50 ${
                      existingCombo
                        ? "bg-elevated hover:bg-subtle text-ink-2 border border-hairline-strong"
                        : "bg-gradient-to-r from-indigo-500 to-sky-500 hover:brightness-110 text-white"
                    }`}
                  >
                    {creatingPresetId === preset.id
                      ? "Building..."
                      : existingCombo
                        ? "Sync Tiers"
                        : "Create"}
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Combos List */}
      {combos.length === 0 ? (
        <div className="bg-surface border border-hairline rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-ink">No combos yet</p>
          <p className="mt-1 text-xs text-ink-dim">
            Pick any Ready-Made Combo above or create a custom failover combo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {combos.map((combo) => {
            const stratSpec = ROUTING_STRATEGIES.find(
              (s) => s.id === combo.strategy
            );
            const comboAccent = getComboAccent(combo.name);
            return (
              <motion.div
                key={combo.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="relative overflow-hidden bg-surface border border-hairline rounded-lg p-5 flex flex-col justify-between"
              >
                <span
                  className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-80"
                  style={{
                    background: `linear-gradient(90deg, ${comboAccent.color}, transparent 70%)`,
                  }}
                />
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-base font-semibold text-ink truncate">
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
                              : "border-hairline bg-canvas text-ink-muted hover:text-ink hover:border-hairline-strong"
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
                      <div className="mt-1 text-xs text-ink-muted flex flex-wrap items-center gap-x-1.5">
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
                        className="p-1 text-ink-muted hover:text-ink transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleCombo(combo)}
                        className={`text-xs font-medium transition-colors whitespace-nowrap ${
                          combo.isActive
                            ? "text-emerald-400 hover:text-emerald-300"
                            : "text-ink-muted hover:text-ink"
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
                            : "text-ink-muted hover:text-red-400"
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
                    <p className="mt-2 text-xs text-ink-muted">
                      {combo.description}
                    </p>
                  )}

                  <div className="mt-4 border-t border-hairline divide-y divide-hairline">
                    {combo.tiers.map((tier, idx) => {
                      const conn = connMap.get(tier.connectionId);
                      const tierVisual = getProviderVisual(
                        conn?.provider || "custom"
                      );
                      return (
                        <div
                          key={tier.id}
                          className="py-2.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="font-mono text-ink-muted tabular-nums w-5">
                              #{idx + 1}
                            </span>
                            <span
                              className="w-5 h-5 rounded border flex items-center justify-center font-mono text-[10px] font-bold shrink-0"
                              style={{
                                color: tierVisual.color,
                                backgroundColor: tierVisual.softBg,
                                borderColor: tierVisual.border,
                              }}
                            >
                              {tierVisual.short}
                            </span>
                            <div className="min-w-0">
                              <div className="font-mono text-ink truncate">
                                {tier.upstreamModel}
                              </div>
                              <div className="text-ink-muted truncate">
                                {conn?.name || "Unknown"} ·{" "}
                                <span style={{ color: tierVisual.color }}>
                                  {conn ? getConnectionPrefix(conn) : "custom"}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="font-mono text-ink-muted tabular-nums shrink-0 text-right">
                            <span>w:{tier.weight}</span>
                            <span className="mx-1.5">·</span>
                            <span>{tier.requestCount} reqs</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Wildcards & Dry-Run Route Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Wildcard Model Mappings */}
        <div className="bg-surface border border-hairline rounded-lg p-5">
          <h3 className="font-display text-base font-semibold text-ink">
            Wildcard Routes
          </h3>

          <form onSubmit={handleAddWildcard} className="mt-4 flex flex-wrap sm:flex-nowrap gap-2">
            <input
              type="text"
              aria-label="Wildcard model pattern"
              placeholder="e.g. gpt-4*"
              value={wcPattern}
              onChange={(e) => setWcPattern(e.target.value)}
              className="w-full sm:w-40 bg-canvas border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
            />
            <select
              value={wcComboId}
              onChange={(e) => setWcComboId(e.target.value)}
              disabled={combos.length === 0}
              className="flex-1 bg-canvas border border-hairline rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500 disabled:opacity-50"
            >
              <option value="">
                {combos.length === 0 ? "Create a combo first..." : "Select target combo..."}
              </option>
              {combos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!wcPattern.trim() || !wcComboId || combos.length === 0}
              className="px-3.5 py-2 text-xs font-medium bg-elevated hover:bg-elevated disabled:opacity-50 text-ink border border-hairline rounded-lg whitespace-nowrap"
            >
              Add Rule
            </button>
          </form>
          {combos.length === 0 && (
            <p className="mt-2 text-[11px] text-ink-muted">
              Wildcard rules redirect matching model aliases to a Combo. Create a combo above first.
            </p>
          )}

          <div className="mt-4 border-t border-hairline divide-y divide-hairline">
            {wildcards.length === 0 ? (
              <p className="py-5 text-xs text-ink-muted text-center">
                No wildcard mappings configured.
              </p>
            ) : (
              wildcards.map((wc) => {
                const target = combos.find((c) => c.id === wc.comboId);
                return (
                  <div
                    key={wc.id}
                    className="py-2.5 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="font-mono min-w-0 truncate">
                      <span
                        className={
                          wc.isActive ? "text-ink" : "text-ink-dim line-through"
                        }
                      >
                        {wc.pattern}
                      </span>
                      <span className="mx-2 text-ink-muted">→</span>
                      <span className="text-indigo-400">
                        {target?.name || "Deleted combo"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleWildcard(wc)}
                        className={`text-xs font-medium transition-colors ${
                          wc.isActive
                            ? "text-emerald-400 hover:text-emerald-300"
                            : "text-ink-muted hover:text-ink"
                        }`}
                      >
                        {wc.isActive ? "Active" : "Paused"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteWildcard(wc.id)}
                        className="text-ink-muted hover:text-red-400"
                        title="Delete wildcard"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Dry-Run Route Simulator */}
        <div className="bg-surface border border-hairline rounded-lg p-5 space-y-3">
          <h3 className="font-display text-base font-semibold text-ink">
            Dry-Run Simulator
          </h3>

          <form onSubmit={runDrySimulation} className="space-y-3">
            <div>
              <label
                htmlFor="combo-sim-model"
                className="block text-xs text-ink-muted mb-1.5"
              >
                Combo or model alias
              </label>
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <ModelCombobox
                    id="combo-sim-model"
                    ariaLabel="Combo or model alias"
                    placeholder="e.g. production-chat or gpt-4o"
                    value={simModel}
                    onChange={setSimModel}
                    options={simulatorOptions}
                  />
                </div>
                <button
                  type="submit"
                  disabled={simRunning}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-elevated hover:bg-subtle border border-hairline-strong text-ink rounded-lg whitespace-nowrap transition-colors shrink-0"
                >
                  <Play className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{simRunning ? "Simulating..." : "Run"}</span>
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="combo-sim-prompt"
                className="block text-xs text-ink-muted mb-1.5"
              >
                Sample prompt
              </label>
              <input
                id="combo-sim-prompt"
                type="text"
                placeholder="Enter a test prompt to inspect intent & tier order..."
                value={simPrompt}
                onChange={(e) => setSimPrompt(e.target.value)}
                className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSimHasTools((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  simHasTools
                    ? "bg-elevated border-indigo-500/50 text-indigo-300"
                    : "bg-canvas border-hairline text-ink-muted hover:text-ink"
                }`}
              >
                Tools
              </button>
              <button
                type="button"
                onClick={() => setSimHasImage((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  simHasImage
                    ? "bg-elevated border-indigo-500/50 text-indigo-300"
                    : "bg-canvas border-hairline text-ink-muted hover:text-ink"
                }`}
              >
                Image
              </button>
              <button
                type="button"
                onClick={() => setSimFreeOnly((v) => !v)}
                className={`px-3 py-1.5 rounded-lg border transition-colors ${
                  simFreeOnly
                    ? "bg-elevated border-emerald-500/50 text-emerald-300"
                    : "bg-canvas border-hairline text-ink-muted hover:text-ink"
                }`}
              >
                Free only
              </button>
            </div>
          </form>

          {llmConnections.length > 0 && (
            <div className="pt-1">
              <div className="text-xs text-ink-muted mb-1.5">
                Simulate 429 faults:
              </div>
              <div className="flex flex-wrap gap-2">
                {llmConnections.map((c) => {
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
                          : "bg-canvas border-hairline text-ink-muted hover:text-ink"
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
                className="pt-3 border-t border-hairline space-y-2"
              >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-ink-muted">
                  Strategy{" "}
                  <span className="text-ink font-mono">
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
              <div className="divide-y divide-hairline border border-hairline rounded-lg bg-canvas">
                {simResult.steps.map((step) => (
                  <div
                    key={`${step.order}-${step.connectionId}-${step.model}`}
                    className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="font-mono text-ink-2 truncate">
                      #{step.order} {step.connectionName} → {step.model}
                    </div>
                    <div
                      className={`font-mono shrink-0 ${
                        step.decision === "selected"
                          ? "text-emerald-400"
                          : step.decision === "fallback_failed"
                            ? "text-amber-400"
                            : "text-ink-muted"
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
              ref={builderModalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="combo-builder-title"
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-surface border border-hairline rounded-xl p-6 max-h-[90vh] overflow-y-auto outline-none"
            >
            <div className="flex items-center justify-between pb-4 border-b border-hairline">
              <h3
                id="combo-builder-title"
                className="font-display text-base font-semibold text-ink"
              >
                {editingComboId
                  ? "Edit Routing Combo"
                  : "Create Routing Combo"}
              </h3>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowBuilder(false)}
                className="text-ink-muted hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCombo} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="combo-alias-input"
                    className="block text-xs font-medium text-ink-2 mb-1.5"
                  >
                    Virtual Model Alias
                  </label>
                  <input
                    id="combo-alias-input"
                    type="text"
                    required
                    placeholder="e.g. production-chat"
                    value={comboName}
                    onChange={(e) => setComboName(e.target.value)}
                    className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-sm font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="combo-strategy-select"
                    className="block text-xs font-medium text-ink-2 mb-1.5"
                  >
                    Balancing Strategy
                  </label>
                  <select
                    id="combo-strategy-select"
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value)}
                    className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-indigo-500"
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
                <p className="text-xs text-ink-muted">
                  {selectedStrategySpec.description}
                </p>
              )}

              <div>
                <label
                  htmlFor="combo-description-input"
                  className="block text-xs font-medium text-ink-2 mb-1.5"
                >
                  Description (Optional)
                </label>
                <input
                  id="combo-description-input"
                  type="text"
                  placeholder="e.g. Primary fast model with paid fallback"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="divide-y divide-hairline border-y border-hairline py-1">
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
                  <span className="text-xs font-medium text-ink-2">
                    AI Provider Tiers (Drag handles to reorder fallback · Search providers excluded)
                  </span>
                  <button
                    type="button"
                    onClick={addDraftTier}
                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
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
                        className={`p-3 bg-canvas border rounded-lg grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center transition-colors ${
                          isDropTarget
                            ? "border-indigo-500"
                            : isDragged
                              ? "border-hairline-strong opacity-60"
                              : "border-hairline"
                        }`}
                      >
                        <div className="sm:col-span-1 flex items-center gap-1.5 text-ink-muted cursor-grab active:cursor-grabbing">
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
                            className="w-full bg-surface border border-hairline rounded-md px-2.5 py-1.5 text-xs text-ink"
                          >
                            {llmConnections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name} ({c.provider})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <ModelCombobox
                            ariaLabel={`Tier ${idx + 1} model ID`}
                            placeholder="e.g. gpt-4o-mini"
                            value={tier.upstreamModel}
                            onChange={(val) =>
                              updateTier(idx, { upstreamModel: val })
                            }
                            inputClassName="w-full bg-surface border border-hairline rounded-md px-2.5 py-1.5 text-xs font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                            options={Array.from(
                              new Map<string, ComboboxOption>([
                                ...(conn?.defaultModel
                                  ? [
                                      [
                                        conn.defaultModel,
                                        {
                                          value: conn.defaultModel,
                                          label: "Default model",
                                          group: "Default",
                                        },
                                      ] as const,
                                    ]
                                  : []),
                                ...(conn?.availableModels || []).map(
                                  (mId) =>
                                    [
                                      mId,
                                      { value: mId, group: "Synced" },
                                    ] as const
                                ),
                                ...spec.models.map(
                                  (m) =>
                                    [
                                      m.id,
                                      {
                                        value: m.id,
                                        label: m.label,
                                        group: spec.label,
                                      },
                                    ] as const
                                ),
                              ]).values()
                            )}
                          />
                        </div>

                        <div className="sm:col-span-2 flex items-center gap-1.5">
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
                            className="w-1/2 bg-surface border border-hairline rounded-md px-1.5 py-1.5 text-xs font-mono text-ink text-center"
                          />
                          <select
                            value={tier.maxRetries}
                            onChange={(e) =>
                              updateTier(idx, {
                                maxRetries: Number(e.target.value) || 1,
                              })
                            }
                            title="Retries per request"
                            aria-label="Tier max retries"
                            className="w-1/2 bg-surface border border-hairline rounded-md px-1 py-1.5 text-xs font-mono text-ink-2"
                          >
                            <option value={1}>1x</option>
                            <option value={2}>2x</option>
                            <option value={3}>3x</option>
                          </select>
                        </div>

                        <div className="sm:col-span-2 flex items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label={`Move tier ${idx + 1} up`}
                            onClick={() => reorderTiers(idx, idx - 1)}
                            disabled={idx === 0}
                            className="p-1 text-ink-muted hover:text-ink disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move tier ${idx + 1} down`}
                            onClick={() => reorderTiers(idx, idx + 1)}
                            disabled={idx === tiers.length - 1}
                            className="p-1 text-ink-muted hover:text-ink disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove tier ${idx + 1}`}
                            onClick={() =>
                              setTiers((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            disabled={tiers.length <= 1}
                            className="p-1 text-ink-muted hover:text-red-400 disabled:opacity-30"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-hairline flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowBuilder(false)}
                  className="px-4 py-2 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline rounded-lg whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg whitespace-nowrap"
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
