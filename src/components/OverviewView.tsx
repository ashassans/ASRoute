import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Network,
} from "lucide-react";
import { PROVIDER_CATALOG } from "../shared/catalog.ts";
import type {
  AnalyticsSummary,
  Combo,
  GatewayApiKey,
  GatewayEnvironment,
  LiveRouteActivity,
  ProviderConnection,
  RequestLog,
} from "../types/gateway.ts";

interface OverviewViewProps {
  environment: GatewayEnvironment;
  keys: GatewayApiKey[];
  connections: ProviderConnection[];
  combos: Combo[];
  logs: RequestLog[];
  activeRoutes?: LiveRouteActivity[];
  onNavigate: (
    tab:
      | "overview"
      | "providers"
      | "models"
      | "combos"
      | "keys"
      | "logs"
      | "playground"
  ) => void;
  onRefresh?: () => Promise<void>;
  onNotify?: (msg: string, tone?: "success" | "error") => void;
}

const KEY_DOT_COLORS = [
  "#3B82F6", // blue
  "#2DD4BF", // teal
  "#F472B6", // pink
  "#FBBF24", // existing yellow/amber
  "#84CC16", // lime
];

const MODEL_SERIES_COLORS = [
  "#F97316", // orange
  "#EC4899", // coral pink
  "#3B82F6", // blue
  "#10B981", // emerald
  "#84CC16", // lime
  "#FBBF24", // existing yellow/amber
];

const PROVIDER_BADGE_MAP: Record<
  string,
  { short: string; color: string; bg: string }
> = {
  gemini: { short: "G", color: "#60A5FA", bg: "rgba(59,130,246,0.14)" },
  openai: { short: "O", color: "#FAFAFA", bg: "rgba(255,255,255,0.10)" },
  anthropic: { short: "A", color: "#F59E0B", bg: "rgba(245,158,11,0.14)" },
  groq: { short: "Q", color: "#F97316", bg: "rgba(249,115,22,0.14)" },
  deepseek: { short: "D", color: "#38BDF8", bg: "rgba(56,189,248,0.14)" },
  mistral: { short: "M", color: "#FBBF24", bg: "rgba(251,191,36,0.14)" },
  openrouter: { short: "R", color: "#EC4899", bg: "rgba(236,72,153,0.14)" },
  xai: { short: "X", color: "#E4E4E7", bg: "rgba(228,228,231,0.12)" },
  cerebras: { short: "Cb", color: "#22D3EE", bg: "rgba(34,211,238,0.14)" },
  together: { short: "T", color: "#818CF8", bg: "rgba(129,140,248,0.14)" },
  fireworks: { short: "Fw", color: "#FB923C", bg: "rgba(251,146,60,0.14)" },
  perplexity: { short: "Px", color: "#2DD4BF", bg: "rgba(45,212,191,0.14)" },
  custom: { short: "C", color: "#10B981", bg: "rgba(16,185,129,0.14)" },
};

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

function formatUsdSmart(value: number): string {
  if (value === 0) return "$0.00";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value >= 0.0001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

function formatYAxisTick(
  value: number,
  metric: "spend" | "tokens" | "requests"
): string {
  if (value === 0) return metric === "spend" ? "$0" : "0";
  if (metric === "spend") {
    if (value >= 1) return `$${value.toFixed(2)}`;
    if (value >= 0.01) return `$${value.toFixed(2)}`;
    if (value >= 0.001) return `$${value.toFixed(3)}`;
    return `$${value.toFixed(4)}`;
  }
  return formatCompactNumber(value);
}

function MiniSparkline({
  values,
  stroke,
}: {
  values: number[];
  stroke: string;
}) {
  const width = 92;
  const height = 34;
  const pad = 2;

  const points = useMemo(() => {
    const safe = values.length > 1 ? values : [0, ...values, 0];
    const maxVal = Math.max(...safe, 0);
    const minVal = Math.min(...safe, 0);
    const span = maxVal - minVal;

    return safe
      .map((val, idx) => {
        const x =
          pad + (idx / Math.max(1, safe.length - 1)) * (width - pad * 2);
        const norm = span > 0 ? (val - minVal) / span : 0.1;
        const y = height - pad - norm * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-[84px] h-[34px] shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function DeltaLabel({
  pct,
  invertNegativeColor = false,
  fallbackText,
}: {
  pct: number | null | undefined;
  invertNegativeColor?: boolean;
  fallbackText?: string;
}) {
  if (pct === null || pct === undefined) {
    return (
      <div className="mt-2.5 text-xs text-[#71717A] tabular-nums">
        {fallbackText || "— vs prev period"}
      </div>
    );
  }
  const isUp = pct >= 0;
  const isPositiveTone = invertNegativeColor ? !isUp : isUp;
  return (
    <div className="mt-2.5 flex items-center gap-1.5 text-xs tabular-nums">
      <span className={isPositiveTone ? "text-emerald-400" : "text-rose-400"}>
        {isUp ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
      </span>
      <span className="text-[#71717A]">vs prev period</span>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function OverviewView({
  environment,
  keys,
  connections,
  combos,
  logs,
  activeRoutes = [],
  onNavigate,
  onRefresh,
  onNotify,
}: OverviewViewProps) {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const [chartMetric, setChartMetric] = useState<
    "spend" | "tokens" | "requests"
  >("spend");
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [hoveredBucketIdx, setHoveredBucketIdx] = useState<number | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copiedChart, setCopiedChart] = useState(false);

  // Interactive landing showcase states
  const [previewComboIdx, setPreviewComboIdx] = useState(0);
  const [localCompress, setLocalCompress] = useState(false);
  const [localStrategy, setLocalStrategy] = useState<
    "priority" | "intent_auto" | "cost_optimized"
  >("intent_auto");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [pulseCursor, setPulseCursor] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPulseCursor((prev) => (prev + 1) % 26);
    }, 1100);
    return () => window.clearInterval(id);
  }, []);

  const loadAnalytics = useCallback(
    async (selectedRange: "24h" | "7d" | "30d") => {
      setLoadingAnalytics(true);
      try {
        const res = await fetch(`/api/analytics?range=${selectedRange}`);
        if (res.ok) {
          const data = (await res.json()) as AnalyticsSummary;
          setAnalytics(data);
        }
      } catch {
        // retain previous state
      } finally {
        setLoadingAnalytics(false);
      }
    },
    []
  );

  const latestLogId = logs[0]?.id ?? "";
  const mountedRef = useRef(false);

  useEffect(() => {
    loadAnalytics(range);
  }, [range, loadAnalytics]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      loadAnalytics(range);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [latestLogId, logs.length, range, loadAnalytics]);

  const activeCombo = combos.length
    ? combos[previewComboIdx % combos.length]
    : null;

  useEffect(() => {
    if (activeCombo) {
      setLocalCompress(activeCombo.compressPrompt);
      if (
        activeCombo.strategy === "priority" ||
        activeCombo.strategy === "intent_auto" ||
        activeCombo.strategy === "cost_optimized"
      ) {
        setLocalStrategy(activeCombo.strategy);
      }
    }
  }, [activeCombo?.id, activeCombo?.compressPrompt, activeCombo?.strategy]);

  const updateGatewayPolicy = async (patch: {
    compressPrompt?: boolean;
    strategy?: "priority" | "intent_auto" | "cost_optimized";
  }) => {
    if (!activeCombo) {
      onNotify?.(
        "Create a combo first to save routing policies.",
        "error"
      );
      return;
    }

    const prevCompress = localCompress;
    const prevStrategy = localStrategy;
    if (patch.compressPrompt !== undefined) {
      setLocalCompress(patch.compressPrompt);
    }
    if (patch.strategy !== undefined) {
      setLocalStrategy(patch.strategy);
    }

    setSavingPolicy(true);
    try {
      const res = await fetch(`/api/combos/${activeCombo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        await onRefresh?.();
        onNotify?.(
          `Updated policy for "${activeCombo.name}".`,
          "success"
        );
      } else {
        setLocalCompress(prevCompress);
        setLocalStrategy(prevStrategy);
        onNotify?.("Failed to update combo policy.", "error");
      }
    } catch {
      setLocalCompress(prevCompress);
      setLocalStrategy(prevStrategy);
      onNotify?.("Network error updating gateway policy.", "error");
    } finally {
      setSavingPolicy(false);
    }
  };

  const totalRequests = analytics?.totalRequests ?? logs.length;
  const totalCostUsd = analytics?.totalCostUsd ?? 0;
  const totalTokens = analytics?.totalTokens ?? 0;
  const successRate = analytics?.successRate ?? 100;
  const blendedCostPer1M = analytics?.blendedCostPer1M ?? 0;
  const fallbackRecovered = analytics?.fallbackRecovered ?? 0;
  const p50 = analytics?.p50 ?? 0;
  const p95 = analytics?.p95 ?? 0;
  const buckets = analytics?.buckets ?? [];
  const topApiKeys = analytics?.topApiKeys ?? [];
  const topRoutes = analytics?.topRoutes ?? [];
  const models = analytics?.models ?? [];
  const deltas = analytics?.deltas;

  const spendSeries = useMemo(() => buckets.map((b) => b.costUsd), [buckets]);
  const requestsSeries = useMemo(() => buckets.map((b) => b.total), [buckets]);
  const tokensSeries = useMemo(() => buckets.map((b) => b.tokens), [buckets]);
  const successSeries = useMemo(
    () => buckets.map((b) => b.successRate),
    [buckets]
  );
  const blendedSeries = useMemo(
    () => buckets.map((b) => b.blendedPer1M),
    [buckets]
  );

  const isLiveActive = activeRoutes.length > 0;

  const recentNodes = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{
      id: string;
      provider: string;
      model: string;
      connectionName: string;
      status: "recent" | "error";
      meta: string;
    }> = [];

    for (const log of logs) {
      if (!log.resolvedProvider || log.resolvedProvider === "none") continue;
      const key = `${log.resolvedProvider}:${log.resolvedModel}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isErr =
        log.outcome === "error" || log.outcome === "rate_limited";
      list.push({
        id: log.id,
        provider: log.resolvedProvider,
        model: log.resolvedModel,
        connectionName: log.connectionName || log.resolvedProvider,
        status: isErr ? "error" : "recent",
        meta: formatRelativeTime(log.createdAt),
      });
      if (list.length >= 4) break;
    }

    return list;
  }, [logs]);

  const topologyNodes = useMemo(() => {
    if (activeRoutes.length > 0) {
      return activeRoutes.slice(0, 4).map((r) => ({
        id: r.requestId,
        provider: r.provider,
        model: r.model,
        connectionName: r.connectionName || r.provider,
        status: "active" as const,
        meta: "LIVE",
      }));
    }
    return recentNodes;
  }, [activeRoutes, recentNodes]);

  // Build Failover Matrix slots (26 blocks per provider) from real logs + circuit state
  const failoverRows = useMemo(() => {
    const SLOT_COUNT = 26;
    const recentLogs = logs.slice(0, SLOT_COUNT).reverse();

    const rows = connections.slice(0, 3).map((conn) => {
      const connLogs = recentLogs.filter(
        (l) =>
          l.connectionName === conn.name || l.resolvedProvider === conn.provider
      );
      const startOffset = Math.max(0, SLOT_COUNT - connLogs.length);
      const slots: Array<"ok" | "fail" | "amber" | "idle"> = Array.from(
        { length: SLOT_COUNT },
        (_, idx) => {
          if (idx >= startOffset) {
            const log = connLogs[idx - startOffset];
            if (log.outcome === "error" || log.outcome === "rate_limited") {
              return "fail";
            }
            if (log.outcome === "fallback_success") return "amber";
            return "ok";
          }
          if (conn.circuitStatus === "open" && idx >= SLOT_COUNT - 5) {
            return "fail";
          }
          if (conn.circuitStatus === "half_open" && idx >= SLOT_COUNT - 3) {
            return "amber";
          }
          return "idle";
        }
      );
      return {
        id: conn.id,
        name: conn.name,
        provider: conn.provider,
        isHealthy: conn.isActive && conn.circuitStatus === "healthy",
        slots,
      };
    });

    const gwOffset = Math.max(0, SLOT_COUNT - recentLogs.length);
    const gatewaySlots: Array<"ok" | "fail" | "amber" | "idle"> = Array.from(
      { length: SLOT_COUNT },
      (_, idx) => {
        if (idx >= gwOffset) {
          const l = recentLogs[idx - gwOffset];
          if (l.outcome === "error" || l.outcome === "rate_limited") return "fail";
          if (l.outcome === "fallback_success") return "amber";
          return "ok";
        }
        return "idle";
      }
    );

    return { rows, gatewaySlots };
  }, [connections, logs]);

  const connectedProviderSet = useMemo(
    () => new Set(connections.filter((c) => c.isActive).map((c) => c.provider)),
    [connections]
  );

  // Stacked model bar calculations
  const modelNames = useMemo(() => {
    if (models.length > 0) return models.map((m) => m.model);
    const found = new Set<string>();
    for (const b of buckets) {
      Object.keys(b.byModel || {}).forEach((m) => found.add(m));
    }
    return Array.from(found).slice(0, 6);
  }, [models, buckets]);

  const modelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    modelNames.forEach((name, idx) => {
      map.set(name, MODEL_SERIES_COLORS[idx % MODEL_SERIES_COLORS.length]);
    });
    return map;
  }, [modelNames]);

  const bucketTotals = useMemo(() => {
    return buckets.map((b) => {
      if (chartMetric === "spend") return b.costUsd;
      if (chartMetric === "tokens") return b.tokens;
      return b.total;
    });
  }, [buckets, chartMetric]);

  const maxChartVal = useMemo(() => {
    const rawMax = Math.max(0, ...bucketTotals);
    if (rawMax === 0) {
      return chartMetric === "spend" ? 0.08 : chartMetric === "tokens" ? 1000 : 10;
    }
    return rawMax * 1.12;
  }, [bucketTotals, chartMetric]);

  const yTicks = useMemo(() => {
    return [1, 0.75, 0.5, 0.25, 0].map((ratio) => maxChartVal * ratio);
  }, [maxChartVal]);

  const xLabelIndices = useMemo(() => {
    if (buckets.length <= 8) return buckets.map((_, i) => i);
    const step = Math.max(2, Math.ceil(buckets.length / 10));
    const indices: number[] = [];
    for (let i = 0; i < buckets.length; i += step) {
      indices.push(i);
    }
    if (indices[indices.length - 1] !== buckets.length - 1) {
      indices.push(buckets.length - 1);
    }
    return indices;
  }, [buckets]);

  const defaultModelAlias = combos[0]?.name || "gemini-4-hydrogen";
  const curlSnippet = `curl ${environment.gatewayEndpoint}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${keys[0]?.keyPrefix || "sk-asr-YOUR_KEY"}" \\
  -d '{
    "model": "${defaultModelAlias}",
    "messages": [{"role": "user", "content": "Hello from AS ROUTER"}]
  }'`;

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlSnippet);
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 1800);
    } catch {
      onNotify?.("Clipboard access denied", "error");
    }
  };

  const copyChartSummary = async () => {
    const payload = {
      range,
      metric: chartMetric,
      models,
      buckets: buckets.map((b) => ({
        label: b.label,
        total: b.total,
        tokens: b.tokens,
        costUsd: b.costUsd,
        byModel: b.byModel,
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedChart(true);
      setTimeout(() => setCopiedChart(false), 1800);
    } catch {
      onNotify?.("Clipboard access denied", "error");
    }
  };

  const hoveredBucket =
    hoveredBucketIdx !== null ? buckets[hoveredBucketIdx] : null;

  // SVG bezier Y coordinates for up to 4 target nodes (centered within viewBox height 200)
  const branchYs = useMemo(() => {
    const count = topologyNodes.length;
    if (count <= 1) return [100];
    if (count === 2) return [64, 136];
    if (count === 3) return [42, 100, 158];
    return [26, 75, 125, 174];
  }, [topologyNodes.length]);

  return (
    <div className="space-y-8">
      {/* Header & Time Range Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-[#FAFAFA] tracking-tight">
          Overview
        </h2>

        <div className="inline-flex items-center gap-1 p-1 bg-[#111114] border border-[#27272A] rounded-lg self-start">
          {(
            [
              ["24h", "24 Hours"],
              ["7d", "7 Days"],
              ["30d", "30 Days"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRange(value)}
              className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                range === value
                  ? "text-[#FAFAFA]"
                  : "text-[#A1A1AA] hover:text-[#FAFAFA]"
              }`}
            >
              {range === value && (
                <motion.span
                  layoutId="overview-range-pill"
                  transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  className="absolute inset-0 bg-[#18181B] rounded-md"
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Top 5 OpenRouter-Style Sparkline KPI Cards */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5"
      >
        <div className="bg-[#111114] border border-[#222227] rounded-xl p-4 flex flex-col justify-between hover:border-[#303038] transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-[#A1A1AA] leading-snug">
                Total spend
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-[#FAFAFA] tabular-nums tracking-tight">
                {formatUsdSmart(totalCostUsd)}
              </div>
            </div>
            <MiniSparkline values={spendSeries} stroke="#10B981" />
          </div>
          <DeltaLabel pct={deltas?.spendPct} />
        </div>

        <div className="bg-[#111114] border border-[#222227] rounded-xl p-4 flex flex-col justify-between hover:border-[#303038] transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-[#A1A1AA] leading-snug">
                Requests
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-[#FAFAFA] tabular-nums tracking-tight">
                {formatCompactNumber(totalRequests)}
              </div>
            </div>
            <MiniSparkline
              values={requestsSeries}
              stroke={
                deltas?.requestsPct !== null &&
                deltas?.requestsPct !== undefined &&
                deltas.requestsPct < 0
                  ? "#F43F5E"
                  : "#10B981"
              }
            />
          </div>
          <DeltaLabel pct={deltas?.requestsPct} />
        </div>

        <div className="bg-[#111114] border border-[#222227] rounded-xl p-4 flex flex-col justify-between hover:border-[#303038] transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-[#A1A1AA] leading-snug">
                Token volume
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-[#FAFAFA] tabular-nums tracking-tight">
                {formatCompactNumber(totalTokens)}
              </div>
            </div>
            <MiniSparkline values={tokensSeries} stroke="#10B981" />
          </div>
          <DeltaLabel pct={deltas?.tokensPct} />
        </div>

        <div className="bg-[#111114] border border-[#222227] rounded-xl p-4 flex flex-col justify-between hover:border-[#303038] transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-[#A1A1AA] leading-snug">
                Success rate
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-[#FAFAFA] tabular-nums tracking-tight">
                {successRate.toFixed(1)}%
              </div>
            </div>
            <MiniSparkline values={successSeries} stroke="#10B981" />
          </div>
          <DeltaLabel
            pct={deltas?.successRatePct}
            fallbackText={`${fallbackRecovered} fallback recovered`}
          />
        </div>

        <div className="bg-[#111114] border border-[#222227] rounded-xl p-4 flex flex-col justify-between hover:border-[#303038] transition-colors">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-[#A1A1AA] leading-snug">
                Blended $/1M
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-[#FAFAFA] tabular-nums tracking-tight">
                {formatUsdSmart(blendedCostPer1M)}
              </div>
            </div>
            <MiniSparkline values={blendedSeries} stroke="#10B981" />
          </div>
          <DeltaLabel pct={deltas?.blendedPct} invertNegativeColor />
        </div>
      </motion.div>

      {/* SECTION 1 (Landing-Style Animated): Better, faster, cheaper. Route smarter. */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06 }}
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-2"
      >
        <div className="lg:col-span-5 space-y-4">
          <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA] leading-[1.15]">
            Better, faster, cheaper. Route all three.
          </h3>
          <button
            type="button"
            onClick={() => onNavigate("combos")}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap"
          >
            <span>Configure combos & routing</span>
            <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
          </button>
        </div>

        <div className="lg:col-span-7 bg-[#111114] border border-[#222227] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#222227] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xs font-medium text-[#FAFAFA] whitespace-nowrap">
                Provider Topology
              </span>
              {isLiveActive && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{activeRoutes.length} active</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-[#A1A1AA] shrink-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Active</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Recent</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>Error</span>
              </span>
            </div>
          </div>

          <div className="px-5 py-5 relative min-h-[240px] flex items-center">
            {topologyNodes.length === 0 ? (
              <div className="w-full py-10 flex flex-col items-center justify-center gap-2 text-[#71717A]">
                <Network className="w-5 h-5 opacity-70" />
                <span className="text-xs">
                  {connections.length === 0
                    ? "No providers connected yet"
                    : "No recent traffic"}
                </span>
              </div>
            ) : (
              <div className="w-full grid grid-cols-12 items-center gap-2">
                {/* Left Hub + SVG Curves */}
                <div className="col-span-4 sm:col-span-5 relative h-[200px]">
                  <svg
                    viewBox="0 0 260 200"
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                  >
                    {/* Incoming line */}
                    <path
                      id="ov-in-path"
                      d="M 0 100 L 58 100"
                      fill="none"
                      stroke={
                        isLiveActive ? "rgba(16,185,129,0.55)" : "#27272A"
                      }
                      strokeWidth={isLiveActive ? "1.6" : "1.25"}
                    />
                    {isLiveActive && (
                      <circle r="3" fill="#10B981">
                        <animateMotion dur="0.9s" repeatCount="indefinite">
                          <mpath href="#ov-in-path" />
                        </animateMotion>
                      </circle>
                    )}

                    {/* Fan-out Bezier Paths */}
                    {branchYs.map((ty, idx) => {
                      const node = topologyNodes[idx];
                      const pid = `ov-branch-${idx}`;
                      const strokeColor =
                        node?.status === "active"
                          ? "rgba(16,185,129,0.65)"
                          : node?.status === "error"
                            ? "rgba(244,63,94,0.38)"
                            : "rgba(251,191,36,0.28)";
                      return (
                        <g key={pid}>
                          <path
                            id={pid}
                            d={`M 82 100 C 145 100, 175 ${ty}, 256 ${ty}`}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={node?.status === "active" ? "1.75" : "1.2"}
                          />
                          {node?.status === "active" && (
                            <circle r="3.2" fill="#10B981">
                              <animateMotion
                                dur={`${1.05 + idx * 0.2}s`}
                                repeatCount="indefinite"
                                begin={`${idx * 0.15}s`}
                              >
                                <mpath href={`#${pid}`} />
                              </animateMotion>
                            </circle>
                          )}
                        </g>
                      );
                    })}
                  </svg>

                  {/* Central AS ROUTER Node */}
                  <motion.div
                    animate={
                      isLiveActive ? { scale: [1, 1.08, 1] } : { scale: 1 }
                    }
                    transition={
                      isLiveActive
                        ? {
                            duration: 1.4,
                            repeat: Infinity,
                            ease: "easeInOut",
                          }
                        : { duration: 0.25 }
                    }
                    className={`absolute top-1/2 -translate-y-1/2 left-[48px] w-10 h-10 rounded-full bg-[#09090B] border flex items-center justify-center transition-all ${
                      isLiveActive
                        ? "border-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.35)]"
                        : "border-[#27272A]"
                    }`}
                    title="AS ROUTER Engine"
                  >
                    <span
                      className={`font-display text-xs font-bold ${
                        isLiveActive ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      AS
                    </span>
                  </motion.div>
                </div>

                {/* Right Active / Recent Provider + Model Nodes */}
                <div className="col-span-8 sm:col-span-7 h-[200px] flex flex-col justify-center gap-3 py-1">
                  {topologyNodes.map((node, idx) => {
                    const badge =
                      PROVIDER_BADGE_MAP[node.provider] ||
                      PROVIDER_BADGE_MAP.custom;
                    const borderTone =
                      node.status === "active"
                        ? "border-emerald-400/60 shadow-[0_0_14px_rgba(16,185,129,0.14)]"
                        : node.status === "error"
                          ? "border-rose-500/40"
                          : "border-[#27272A]";
                    const dotTone =
                      node.status === "active"
                        ? "bg-emerald-400 animate-pulse"
                        : node.status === "error"
                          ? "bg-rose-500"
                          : "bg-amber-400";

                    return (
                      <motion.div
                        key={`${node.id}-${idx}`}
                        initial={{ opacity: 0.6, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.2, delay: idx * 0.04 }}
                        className="flex items-center justify-between gap-2.5"
                      >
                        <div
                          className={`flex items-center gap-2 px-3 py-1.5 bg-[#18181B] border rounded-full min-w-0 flex-1 ${borderTone}`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${dotTone}`}
                          />
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center font-mono text-[10px] font-bold shrink-0"
                            style={{
                              color: badge.color,
                              backgroundColor: badge.bg,
                            }}
                          >
                            {badge.short}
                          </span>
                          <span className="font-mono text-xs text-[#FAFAFA] truncate">
                            {node.provider}/{node.model}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-[11px] tabular-nums shrink-0 ${
                            node.status === "active"
                              ? "text-emerald-400 font-semibold"
                              : node.status === "error"
                                ? "text-rose-400"
                                : "text-[#71717A]"
                          }`}
                        >
                          {node.meta}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-[#222227] flex items-center justify-between gap-3 text-xs">
            <span className="text-[#A1A1AA] truncate font-mono">
              {isLiveActive
                ? `Active: ${activeRoutes[0].provider}/${activeRoutes[0].model}`
                : recentNodes.length > 0
                  ? `Recent: ${recentNodes[0].provider}/${recentNodes[0].model}`
                  : "Idle"}
            </span>
            <span className="font-mono font-semibold text-amber-400 tabular-nums whitespace-nowrap shrink-0">
              {formatCompactNumber(totalTokens)} tok · {formatUsdSmart(totalCostUsd)}
            </span>
          </div>
        </div>
      </motion.section>

      {/* SECTION 2 (Landing-Style Animated): Stay up through outages and rate limits */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.4 }}
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-2"
      >
        <div className="lg:col-span-7 bg-[#111114] border border-[#222227] rounded-xl overflow-hidden order-2 lg:order-1">
          <div className="px-5 py-3 border-b border-[#222227] flex items-center justify-between">
            <span className="text-xs font-medium text-[#A1A1AA]">
              Providers
            </span>
            <span className="text-xs font-mono text-[#71717A] tabular-nums">
              {fallbackRecovered} failover recoveries
            </span>
          </div>

          <div className="p-5 space-y-4">
            {failoverRows.rows.length === 0 ? (
              <div className="py-4 text-xs text-[#71717A]">
                Connect providers to visualize real-time failover uptime blocks.
              </div>
            ) : (
              failoverRows.rows.map((row) => {
                const badge =
                  PROVIDER_BADGE_MAP[row.provider] ||
                  PROVIDER_BADGE_MAP.custom;
                return (
                  <div key={row.id} className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-5 h-5 rounded flex items-center justify-center font-mono text-[10px] font-bold shrink-0"
                          style={{
                            color: badge.color,
                            backgroundColor: badge.bg,
                          }}
                        >
                          {badge.short}
                        </span>
                        <span className="text-[#D4D4D8] font-medium truncate">
                          {row.name}
                        </span>
                      </div>
                      <span
                        className={`font-mono text-[11px] ${
                          row.isHealthy ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {row.isHealthy ? "healthy" : "degraded"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {row.slots.map((state, sIdx) => (
                        <div
                          key={sIdx}
                          className={`h-3.5 flex-1 rounded-[2px] transition-all duration-300 ${
                            sIdx === pulseCursor ? "brightness-125 scale-y-110" : ""
                          } ${
                            state === "ok"
                              ? "bg-[#10B981]"
                              : state === "fail"
                                ? "bg-rose-500"
                                : state === "amber"
                                  ? "bg-amber-400"
                                  : "bg-[#1C1C21]"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}

            {/* Aggregated Through AS ROUTER strip */}
            <div className="pt-3.5 border-t border-[#222227] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#FAFAFA]">
                  Through AS ROUTER
                </span>
                <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                  {successRate.toFixed(1)}% uptime
                </span>
              </div>
              <div className="flex items-center gap-1">
                {failoverRows.gatewaySlots.map((state, sIdx) => (
                  <div
                    key={sIdx}
                    className={`h-3.5 flex-1 rounded-[2px] transition-all duration-300 ${
                      sIdx === pulseCursor ? "brightness-125 scale-y-110" : ""
                    } ${
                      state === "ok"
                        ? "bg-[#10B981]"
                        : state === "fail"
                          ? "bg-rose-500"
                          : "bg-[#1C1C21]"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 space-y-4 order-1 lg:order-2">
          <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA] leading-[1.15]">
            Stay up through outages and rate limits
          </h3>
          <button
            type="button"
            onClick={() => onNavigate("logs")}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap"
          >
            <span>See live failover traces</span>
            <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
          </button>
        </div>
      </motion.section>

      {/* SECTION 3 (Landing-Style Animated): Your gateway, your policies */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.4 }}
        className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-2"
      >
        <div className="lg:col-span-6 bg-[#111114] border border-[#222227] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#222227] flex items-center justify-between text-xs">
            <span className="font-medium text-[#FAFAFA]">
              {activeCombo?.name || "Production"}
            </span>
            <span className="text-[#71717A]">
              {savingPolicy ? "Saving policy..." : "Gateway policy"}
            </span>
          </div>

          <div className="divide-y divide-[#1C1C21]">
            {/* Row 1: Prompt Compression Toggle */}
            <div className="px-5 py-3.5 flex items-center justify-between gap-4">
              <span className="text-xs sm:text-sm text-[#D4D4D8]">
                Prompt compression
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={localCompress}
                disabled={savingPolicy}
                onClick={() =>
                  updateGatewayPolicy({ compressPrompt: !localCompress })
                }
                className={`w-10 h-5.5 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                  localCompress ? "bg-amber-400" : "bg-[#27272A]"
                }`}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  className={`w-4.5 h-4.5 rounded-full bg-[#09090B] ${
                    localCompress ? "ml-auto" : "mr-auto"
                  }`}
                />
              </button>
            </div>

            {/* Row 2: Intent Auto-Routing Toggle */}
            <div className="px-5 py-3.5 flex items-center justify-between gap-4">
              <span className="text-xs sm:text-sm text-[#D4D4D8]">
                Intent-based smart auto-routing
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={localStrategy === "intent_auto"}
                disabled={savingPolicy}
                onClick={() =>
                  updateGatewayPolicy({
                    strategy:
                      localStrategy === "intent_auto"
                        ? "priority"
                        : "intent_auto",
                  })
                }
                className={`w-10 h-5.5 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                  localStrategy === "intent_auto"
                    ? "bg-amber-400"
                    : "bg-[#27272A]"
                }`}
              >
                <motion.span
                  layout
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  className={`w-4.5 h-4.5 rounded-full bg-[#09090B] ${
                    localStrategy === "intent_auto" ? "ml-auto" : "mr-auto"
                  }`}
                />
              </button>
            </div>

            {/* Row 3: Routing Strategy Mode Segmented Switch */}
            <div className="px-5 py-3.5 flex items-center justify-between gap-4">
              <span className="text-xs sm:text-sm text-[#D4D4D8]">
                Routing mode
              </span>
              <div className="inline-flex items-center p-0.5 bg-[#09090B] border border-[#27272A] rounded-md">
                {(
                  [
                    ["priority", "Priority"],
                    ["intent_auto", "Intent"],
                    ["cost_optimized", "Cost"],
                  ] as const
                ).map(([modeId, label]) => (
                  <button
                    key={modeId}
                    type="button"
                    disabled={savingPolicy}
                    onClick={() => updateGatewayPolicy({ strategy: modeId })}
                    className={`relative px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                      localStrategy === modeId
                        ? "text-amber-400"
                        : "text-[#71717A] hover:text-[#D4D4D8]"
                    }`}
                  >
                    {localStrategy === modeId && (
                      <motion.span
                        layoutId="overview-policy-mode"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 32,
                        }}
                        className="absolute inset-0 bg-[#18181B] rounded"
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Row 4: Allowed Providers Strip */}
            <div className="px-5 py-3.5 flex items-center justify-between gap-4">
              <span className="text-xs sm:text-sm text-[#D4D4D8] whitespace-nowrap">
                Connected providers
              </span>
              <button
                type="button"
                onClick={() => onNavigate("providers")}
                className="flex items-center gap-1.5 flex-wrap justify-end"
                title="Manage connected providers"
              >
                {PROVIDER_CATALOG.filter((spec) => spec.id !== "custom").map((spec) => {
                  const active = connectedProviderSet.has(spec.id);
                  const badge =
                    PROVIDER_BADGE_MAP[spec.id] || PROVIDER_BADGE_MAP.custom;
                  return (
                    <span
                      key={spec.id}
                      className={`w-6 h-6 rounded-full border flex items-center justify-center font-mono text-[10px] font-bold transition-opacity ${
                        active
                          ? "border-[#3F3F46] opacity-100"
                          : "border-[#222227] opacity-35"
                      }`}
                      style={{
                        color: active ? badge.color : "#71717A",
                        backgroundColor: active ? badge.bg : "#09090B",
                      }}
                    >
                      {badge.short}
                    </span>
                  );
                })}
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-5">
          <h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#FAFAFA] leading-[1.15]">
            Your gateway, your policies
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-xs sm:text-sm text-[#D4D4D8]">
            {[
              "Encrypted provider vault",
              "Scoped gateway API keys",
              "Daily token & USD budgets",
              "Intent-based smart routing",
              "Tool calling & vision translation",
              "Real-time telemetry logs",
              "Automatic health probes",
              "Cloud workspace persistence",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onNavigate("keys")}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#D4D4D8] hover:text-[#FAFAFA] transition-colors whitespace-nowrap"
          >
            <span>Manage API keys & guardrails</span>
            <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
          </button>
        </div>
      </motion.section>

      {/* ANALYTICS LEADERBOARDS: Top API Keys & Top Combos / Models */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
        <div className="bg-[#111114] border border-[#222227] rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-display text-sm font-semibold text-[#FAFAFA]">
              Top API Keys
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("keys")}
              className="inline-flex items-center gap-0.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
            >
              <span className="underline underline-offset-4 decoration-[#3F3F46]">
                Explore
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {topApiKeys.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#71717A]">
              No active keys
            </div>
          ) : (
            <div className="space-y-3.5">
              {topApiKeys.map((k, idx) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-4 text-xs font-mono text-[#71717A] tabular-nums shrink-0">
                      {idx + 1}
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          KEY_DOT_COLORS[idx % KEY_DOT_COLORS.length],
                      }}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#FAFAFA] truncate">
                        {k.name}
                      </div>
                      <div className="text-xs font-mono text-[#71717A] truncate">
                        {k.keyPrefix}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-sm text-[#FAFAFA] tabular-nums whitespace-nowrap shrink-0">
                    {formatCompactNumber(k.tokens)}{" "}
                    <span className="text-xs text-[#71717A]">tok</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#111114] border border-[#222227] rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-display text-sm font-semibold text-[#FAFAFA]">
              Top Combos & Models
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("combos")}
              className="inline-flex items-center gap-0.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
            >
              <span className="underline underline-offset-4 decoration-[#3F3F46]">
                Explore
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {topRoutes.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#71717A]">
              No traffic recorded
            </div>
          ) : (
            <div className="space-y-3.5">
              {topRoutes.map((route, idx) => (
                <div
                  key={`${route.name}-${idx}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-4 text-xs font-mono text-[#71717A] tabular-nums shrink-0">
                      {idx + 1}
                    </span>
                    <div className="w-6 h-6 rounded-md bg-[#18181B] border border-[#27272A] flex items-center justify-center font-mono text-[11px] font-semibold text-[#D4D4D8] uppercase shrink-0">
                      {route.provider.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#FAFAFA] truncate">
                        {route.name}
                      </div>
                      <div className="text-xs text-[#71717A] truncate">
                        {route.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-sm text-[#FAFAFA] tabular-nums whitespace-nowrap shrink-0">
                    {formatCompactNumber(route.tokens)}{" "}
                    <span className="text-xs text-[#71717A]">tok</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full-Width Stacked Bar Chart: Usage by model */}
      <div className="bg-[#111114] border border-[#222227] rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <h3 className="font-display text-sm font-semibold text-[#FAFAFA]">
              Usage by model
            </h3>
            {hoveredBucket && (
              <span className="text-xs font-mono text-[#A1A1AA] tabular-nums">
                {hoveredBucket.label} · {hoveredBucket.total} reqs ·{" "}
                {formatUsdSmart(hoveredBucket.costUsd)} ·{" "}
                {formatCompactNumber(hoveredBucket.tokens)} tok
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-[#09090B] border border-[#27272A] rounded-md">
              {(
                [
                  ["spend", "Spend"],
                  ["tokens", "Tokens"],
                  ["requests", "Reqs"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setChartMetric(m)}
                  className={`relative px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                    chartMetric === m
                      ? "text-[#FAFAFA]"
                      : "text-[#8B8B95] hover:text-[#D4D4D8]"
                  }`}
                >
                  {chartMetric === m && (
                    <motion.span
                      layoutId="overview-metric-pill"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="absolute inset-0 bg-[#18181B] rounded"
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onNavigate("logs")}
              className="inline-flex items-center gap-0.5 text-xs text-[#A1A1AA] hover:text-[#FAFAFA] transition-colors whitespace-nowrap shrink-0"
            >
              <span className="underline underline-offset-4 decoration-[#3F3F46]">
                Explore
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="relative">
          <div className="flex gap-3">
            <div className="w-14 h-52 flex flex-col justify-between text-right pr-1 font-mono text-[11px] text-[#71717A] tabular-nums shrink-0">
              {yTicks.map((tick, i) => (
                <span key={i}>{formatYAxisTick(tick, chartMetric)}</span>
              ))}
            </div>

            <div className="flex-1 h-52 relative border-b border-l border-[#222227]">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                {[0, 1, 2, 3, 4].map((row) => (
                  <div
                    key={row}
                    className={`w-full ${
                      row === 4 ? "" : "border-t border-dashed border-[#1F1F24]"
                    }`}
                  />
                ))}
              </div>

              <div className="relative z-10 h-full flex items-end gap-1 px-1.5">
                {buckets.map((bucket, bIdx) => {
                  const totalMetric = bucketTotals[bIdx] || 0;
                  const heightPct =
                    totalMetric > 0
                      ? Math.max(
                          4,
                          Math.min(100, (totalMetric / maxChartVal) * 100)
                        )
                      : 0;

                  const segments = modelNames
                    .map((mName) => {
                      const mData = bucket.byModel?.[mName];
                      if (!mData) return null;
                      const val =
                        chartMetric === "spend"
                          ? mData.costUsd
                          : chartMetric === "tokens"
                            ? mData.tokens
                            : mData.requests;
                      if (val <= 0) return null;
                      return {
                        model: mName,
                        val,
                        color: modelColorMap.get(mName) || "#10B981",
                      };
                    })
                    .filter(Boolean) as Array<{
                    model: string;
                    val: number;
                    color: string;
                  }>;

                  const segTotal = segments.reduce((acc, s) => acc + s.val, 0);

                  return (
                    <div
                      key={`${bucket.label}-${bIdx}`}
                      onMouseEnter={() => setHoveredBucketIdx(bIdx)}
                      onMouseLeave={() => setHoveredBucketIdx(null)}
                      onClick={() =>
                        setHoveredBucketIdx((prev) => (prev === bIdx ? null : bIdx))
                      }
                      className="flex-1 h-full flex items-end justify-center border-r border-dashed border-[#1B1B20] last:border-r-0 group relative cursor-pointer"
                    >
                      {heightPct > 0 && segTotal > 0 ? (
                        <div
                          style={{ height: `${heightPct}%` }}
                          className="w-[74%] max-w-[26px] flex flex-col-reverse rounded-t-[2px] overflow-hidden transition-[height,opacity] duration-300 ease-out group-hover:opacity-100 opacity-95"
                        >
                          {segments.map((seg) => (
                            <div
                              key={seg.model}
                              style={{
                                height: `${Math.max(
                                  4,
                                  (seg.val / segTotal) * 100
                                )}%`,
                                backgroundColor: seg.color,
                              }}
                              className="w-full"
                            />
                          ))}
                        </div>
                      ) : totalMetric > 0 ? (
                        <div
                          style={{ height: `${heightPct}%` }}
                          className="w-[74%] max-w-[26px] bg-amber-400 rounded-t-[2px] transition-[height] duration-300 ease-out"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-2">
            <div className="w-14 shrink-0" />
            <div className="flex-1 flex items-center justify-between font-mono text-[11px] text-[#71717A] tabular-nums px-1">
              {xLabelIndices.map((idx) => (
                <span key={idx}>{buckets[idx]?.label || ""}</span>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-[#1C1C21] flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap text-xs text-[#D4D4D8]">
              {modelNames.length === 0 ? (
                <span className="text-[#71717A]">No usage data</span>
              ) : (
                modelNames.map((mName) => (
                  <div key={mName} className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{
                        backgroundColor:
                          modelColorMap.get(mName) || "#10B981",
                      }}
                    />
                    <span className="font-mono text-xs text-[#D4D4D8]">
                      {mName}
                    </span>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={copyChartSummary}
              title="Copy chart usage JSON"
              className="p-1.5 text-[#71717A] hover:text-[#FAFAFA] transition-colors rounded"
            >
              {copiedChart ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Gateway Endpoint & Quick cURL Onboarding */}
      <div className="bg-[#111114] border border-[#222227] rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="font-display text-sm font-semibold text-[#FAFAFA]">
              OpenAI-Compatible Gateway Endpoint
            </h3>
            <div className="mt-1 font-mono text-xs text-amber-400 truncate">
              {environment.gatewayEndpoint}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate("playground")}
              className="px-3 py-1.5 text-xs font-medium text-[#FAFAFA] bg-[#18181B] hover:bg-[#27272A] border border-[#27272A] rounded-md transition-colors whitespace-nowrap"
            >
              Open Playground
            </button>
            <button
              type="button"
              onClick={copyCurl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#D4D4D8] hover:text-white bg-[#09090B] border border-[#27272A] rounded-md transition-colors whitespace-nowrap"
            >
              {copiedCurl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy cURL</span>
                </>
              )}
            </button>
          </div>
        </div>

        <pre className="p-3.5 bg-[#09090B] border border-[#27272A] rounded-lg font-mono text-xs text-[#D4D4D8] overflow-x-auto leading-relaxed">
          {curlSnippet}
        </pre>
      </div>
    </div>
  );
}
