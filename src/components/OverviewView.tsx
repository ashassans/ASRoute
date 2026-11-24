import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Network,
} from "lucide-react";
import {
  PROVIDER_CATALOG,
  getConnectionPrefix,
  getProviderSpec,
  isSearchProvider,
} from "../shared/catalog.ts";
import { getProviderVisual } from "../lib/providerVisuals.ts";
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
      | "provider-list"
      | "provider-connected"
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
  "#38BDF8", // sky
  "#2DD4BF", // teal
  "#F472B6", // pink
  "#A855F7", // violet
  "#FB923C", // orange
];

const MODEL_SERIES_COLORS = [
  "#FB923C", // orange
  "#F472B6", // pink
  "#38BDF8", // sky
  "#10B981", // emerald
  "#A855F7", // violet
  "#FBBF24", // amber
];

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
      <div className="mt-2.5 text-xs text-ink-dim tabular-nums">
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
      <span className="text-ink-dim">vs prev period</span>
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
  const [endpointMode, setEndpointMode] = useState<"openai" | "anthropic">(
    "openai"
  );
  const [copiedChart, setCopiedChart] = useState(false);

  // Interactive landing showcase states
  const [previewComboIdx, setPreviewComboIdx] = useState(0);
  const [localCompress, setLocalCompress] = useState(false);
  const [localCache, setLocalCache] = useState(false);
  const [localStrategy, setLocalStrategy] = useState<string>("intent_auto");
  const [savingPolicy, setSavingPolicy] = useState(false);

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
      setLocalCache(activeCombo.enableCache);
      setLocalStrategy(activeCombo.strategy || "priority");
    }
  }, [
    activeCombo?.id,
    activeCombo?.compressPrompt,
    activeCombo?.enableCache,
    activeCombo?.strategy,
  ]);

  const updateGatewayPolicy = async (patch: {
    compressPrompt?: boolean;
    enableCache?: boolean;
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
    const prevCache = localCache;
    const prevStrategy = localStrategy;
    if (patch.compressPrompt !== undefined) {
      setLocalCompress(patch.compressPrompt);
    }
    if (patch.enableCache !== undefined) {
      setLocalCache(patch.enableCache);
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
        setLocalCache(prevCache);
        setLocalStrategy(prevStrategy);
        onNotify?.("Failed to update combo policy.", "error");
      }
    } catch {
      setLocalCompress(prevCompress);
      setLocalCache(prevCache);
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

  const firstActiveLlmConn = connections.find(
    (c) => c.isActive && !isSearchProvider(c.provider)
  );
  const firstActiveModelId = firstActiveLlmConn
    ? firstActiveLlmConn.defaultModel ||
      firstActiveLlmConn.availableModels?.[0] ||
      getProviderSpec(firstActiveLlmConn.provider).models[0]?.id
    : null;
  const defaultModelAlias =
    combos.find((c) => c.isActive)?.name ||
    combos[0]?.name ||
    (firstActiveLlmConn && firstActiveModelId
      ? `${getConnectionPrefix(firstActiveLlmConn)}/${firstActiveModelId}`
      : "YOUR_PROVIDER/MODEL");
  const snippetApiKeyPlaceholder = "sk-asr-YOUR_GATEWAY_API_KEY";
  const openaiCurlSnippet = `curl ${environment.gatewayEndpoint}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${snippetApiKeyPlaceholder}" \\
  -d '{
    "model": "${defaultModelAlias}",
    "messages": [{"role": "user", "content": "Hello from AS ROUTER"}]
  }'`;

  const anthropicBaseOrigin = environment.gatewayEndpoint.replace(/\/v1\/?$/, "");
  const anthropicCurlSnippet = `# Claude Code / Anthropic SDK env
export ANTHROPIC_BASE_URL="${anthropicBaseOrigin}"
export ANTHROPIC_API_KEY="${snippetApiKeyPlaceholder}"

curl ${environment.gatewayEndpoint}/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${snippetApiKeyPlaceholder}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "${defaultModelAlias}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello from AS ROUTER"}]
  }'`;

  const activeSnippet =
    endpointMode === "anthropic" ? anthropicCurlSnippet : openaiCurlSnippet;

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(activeSnippet);
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
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xl font-semibold text-ink tracking-tight">
            Overview
          </h2>
          {loadingAnalytics && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-ink-muted">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
              <span>Updating...</span>
            </span>
          )}
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-surface border border-hairline-strong rounded-lg self-start">
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
                  ? "text-ink"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {range === value && (
                <motion.span
                  layoutId="overview-range-pill"
                  transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  className="absolute inset-0 bg-elevated rounded-md"
                />
              )}
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Top 5 Multi-Color Sparkline KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0 }}
          whileHover={{ y: -2 }}
          className="relative overflow-hidden bg-surface border border-hairline hover:border-emerald-500/40 rounded-xl p-4 flex flex-col justify-between transition-colors"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-emerald-400/80 via-teal-400/40 to-transparent" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-ink-muted leading-snug">
                Total spend
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-ink tabular-nums tracking-tight">
                {formatUsdSmart(totalCostUsd)}
              </div>
            </div>
            <MiniSparkline values={spendSeries} stroke="#10B981" />
          </div>
          <DeltaLabel pct={deltas?.spendPct} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          whileHover={{ y: -2 }}
          className="relative overflow-hidden bg-surface border border-hairline hover:border-sky-500/40 rounded-xl p-4 flex flex-col justify-between transition-colors"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-sky-400/80 via-cyan-400/40 to-transparent" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-ink-muted leading-snug">
                Requests
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-ink tabular-nums tracking-tight">
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
                  : "#38BDF8"
              }
            />
          </div>
          <DeltaLabel pct={deltas?.requestsPct} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          whileHover={{ y: -2 }}
          className="relative overflow-hidden bg-surface border border-hairline hover:border-purple-500/40 rounded-xl p-4 flex flex-col justify-between transition-colors"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-purple-400/80 via-fuchsia-400/40 to-transparent" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-ink-muted leading-snug">
                Token volume
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-ink tabular-nums tracking-tight">
                {formatCompactNumber(totalTokens)}
              </div>
            </div>
            <MiniSparkline values={tokensSeries} stroke="#C084FC" />
          </div>
          <DeltaLabel pct={deltas?.tokensPct} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          whileHover={{ y: -2 }}
          className="relative overflow-hidden bg-surface border border-hairline hover:border-teal-500/40 rounded-xl p-4 flex flex-col justify-between transition-colors"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-teal-400/80 via-emerald-400/40 to-transparent" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-ink-muted leading-snug">
                Success rate
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-ink tabular-nums tracking-tight">
                {successRate.toFixed(1)}%
              </div>
            </div>
            <MiniSparkline values={successSeries} stroke="#2DD4BF" />
          </div>
          <DeltaLabel
            pct={deltas?.successRatePct}
            fallbackText={`${fallbackRecovered} fallback recovered`}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          whileHover={{ y: -2 }}
          className="relative overflow-hidden bg-surface border border-hairline hover:border-orange-500/40 rounded-xl p-4 flex flex-col justify-between transition-colors"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-orange-400/80 via-amber-400/40 to-transparent" />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-ink-muted leading-snug">
                Blended $/1M
              </div>
              <div className="mt-2 font-display text-2xl font-semibold text-ink tabular-nums tracking-tight">
                {formatUsdSmart(blendedCostPer1M)}
              </div>
            </div>
            <MiniSparkline values={blendedSeries} stroke="#FB923C" />
          </div>
          <DeltaLabel pct={deltas?.blendedPct} invertNegativeColor />
        </motion.div>
      </div>

      {/* Usage by model Stacked Bar Chart (Above the Fold) */}
      <div className="bg-surface border border-hairline rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-display text-sm font-semibold text-ink">
              Usage by model
            </h3>
            {hoveredBucket && (
              <span className="text-xs font-mono text-ink-muted tabular-nums">
                {hoveredBucket.label} · {hoveredBucket.total} reqs ·{" "}
                {formatUsdSmart(hoveredBucket.costUsd)} ·{" "}
                {formatCompactNumber(hoveredBucket.tokens)} tok
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-0.5 p-0.5 bg-canvas border border-hairline-strong rounded-md">
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
                      ? "text-ink"
                      : "text-ink-muted hover:text-ink-2"
                  }`}
                >
                  {chartMetric === m && (
                    <motion.span
                      layoutId="overview-metric-pill"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="absolute inset-0 bg-elevated rounded"
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onNavigate("logs")}
              className="inline-flex items-center gap-0.5 text-xs text-ink-muted hover:text-ink transition-colors whitespace-nowrap shrink-0"
            >
              <span className="underline underline-offset-4 decoration-hairline-strong">
                Explore
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div
          className={`relative transition-opacity duration-200 ${
            loadingAnalytics ? "opacity-60" : "opacity-100"
          }`}
        >
          <div className="flex gap-3">
            <div className="w-14 h-52 flex flex-col justify-between text-right pr-1 font-mono text-[11px] text-ink-muted tabular-nums shrink-0">
              {yTicks.map((tick, i) => (
                <span key={i}>{formatYAxisTick(tick, chartMetric)}</span>
              ))}
            </div>

            <div className="flex-1 h-52 relative border-b border-l border-hairline">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                {[0, 1, 2, 3, 4].map((row) => (
                  <div
                    key={row}
                    className={`w-full ${
                      row === 4 ? "" : "border-t border-dashed border-hairline"
                    }`}
                  />
                ))}
              </div>

              {bucketTotals.every((v) => v === 0) && !loadingAnalytics && (
                <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                  <span className="px-3 py-1.5 rounded-lg bg-canvas/90 border border-hairline text-xs text-ink-muted">
                    No usage recorded for this timeframe yet
                  </span>
                </div>
              )}

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
                  const isHovered = hoveredBucketIdx === bIdx;
                  const alignRight = bIdx >= buckets.length - 3;

                  return (
                    <div
                      key={`${bucket.label}-${bIdx}`}
                      onMouseEnter={() => setHoveredBucketIdx(bIdx)}
                      onMouseLeave={() => setHoveredBucketIdx(null)}
                      onClick={() =>
                        setHoveredBucketIdx((prev) => (prev === bIdx ? null : bIdx))
                      }
                      className={`flex-1 h-full flex items-end justify-center border-r border-dashed border-hairline last:border-r-0 group relative cursor-pointer ${
                        isHovered ? "bg-elevated/35" : ""
                      }`}
                    >
                      {isHovered && (
                        <div
                          className={`pointer-events-none absolute top-2 z-30 min-w-[168px] max-w-[220px] rounded-lg bg-surface border border-hairline-strong px-3 py-2 shadow-xl text-[11px] ${
                            alignRight ? "right-1" : "left-1"
                          }`}
                        >
                          <div className="font-mono font-semibold text-ink border-b border-hairline pb-1 mb-1.5">
                            {bucket.label}
                          </div>
                          <div className="space-y-0.5 font-mono tabular-nums text-ink-2">
                            <div className="flex justify-between gap-3">
                              <span className="text-ink-muted">Spend</span>
                              <span>{formatUsdSmart(bucket.costUsd)}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-ink-muted">Tokens</span>
                              <span>{formatCompactNumber(bucket.tokens)}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-ink-muted">Reqs</span>
                              <span>{bucket.total}</span>
                            </div>
                          </div>
                          {segments.length > 0 && (
                            <div className="mt-1.5 pt-1.5 border-t border-hairline space-y-1">
                              {segments.slice(0, 3).map((seg) => (
                                <div
                                  key={seg.model}
                                  className="flex items-center justify-between gap-2 text-[10px] font-mono"
                                >
                                  <span className="flex items-center gap-1.5 min-w-0">
                                    <span
                                      className="w-2 h-2 rounded-sm shrink-0"
                                      style={{ backgroundColor: seg.color }}
                                    />
                                    <span className="truncate text-ink-2">
                                      {seg.model}
                                    </span>
                                  </span>
                                  <span className="text-ink-muted shrink-0">
                                    {chartMetric === "spend"
                                      ? formatUsdSmart(seg.val)
                                      : formatCompactNumber(seg.val)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {heightPct > 0 && segTotal > 0 ? (
                        <motion.div
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={{
                            duration: 0.4,
                            delay: Math.min(bIdx * 0.015, 0.25),
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          style={{ height: `${heightPct}%` }}
                          className="w-[74%] max-w-[26px] origin-bottom flex flex-col-reverse rounded-t-[2px] overflow-hidden group-hover:brightness-110 opacity-95"
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
                        </motion.div>
                      ) : totalMetric > 0 ? (
                        <motion.div
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                          transition={{
                            duration: 0.4,
                            delay: Math.min(bIdx * 0.015, 0.25),
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          style={{ height: `${heightPct}%` }}
                          className="w-[74%] max-w-[26px] origin-bottom bg-gradient-to-t from-indigo-500 via-sky-400 to-cyan-300 rounded-t-[2px]"
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
            <div className="flex-1 flex items-center justify-between font-mono text-[11px] text-ink-muted tabular-nums px-1">
              {xLabelIndices.map((idx) => (
                <span key={idx}>{buckets[idx]?.label || ""}</span>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-wrap text-xs text-ink-2">
              {modelNames.length === 0 ? (
                <span className="text-ink-muted">No usage data</span>
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
                    <span className="font-mono text-xs text-ink-2">
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
              aria-label="Copy chart usage JSON"
              className="p-1.5 text-ink-muted hover:text-ink transition-colors rounded"
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

      {/* ANALYTICS LEADERBOARDS: Top API Keys & Top Combos / Models */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface border border-hairline rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-display text-sm font-semibold text-ink">
              Top API Keys
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("keys")}
              className="inline-flex items-center gap-0.5 text-xs text-ink-muted hover:text-ink transition-colors whitespace-nowrap shrink-0"
            >
              <span className="underline underline-offset-4 decoration-hairline-strong">
                Explore
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {topApiKeys.length === 0 ? (
            <div className="py-10 text-center text-xs text-ink-muted">
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
                    <span className="w-4 text-xs font-mono text-ink-muted tabular-nums shrink-0">
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
                      <div className="text-sm font-medium text-ink truncate">
                        {k.name}
                      </div>
                      <div className="text-xs font-mono text-ink-muted truncate">
                        {k.keyPrefix}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-sm text-ink tabular-nums whitespace-nowrap shrink-0">
                    {formatCompactNumber(k.tokens)}{" "}
                    <span className="text-xs text-ink-muted">tok</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-surface border border-hairline rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-display text-sm font-semibold text-ink">
              Top Combos & Models
            </h3>
            <button
              type="button"
              onClick={() => onNavigate("combos")}
              className="inline-flex items-center gap-0.5 text-xs text-ink-muted hover:text-ink transition-colors whitespace-nowrap shrink-0"
            >
              <span className="underline underline-offset-4 decoration-hairline-strong">
                Explore
              </span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {topRoutes.length === 0 ? (
            <div className="py-10 text-center text-xs text-ink-muted">
              No traffic recorded
            </div>
          ) : (
            <div className="space-y-3.5">
              {topRoutes.map((route, idx) => {
                const routeBadge = getProviderVisual(route.provider);
                return (
                <div
                  key={`${route.name}-${idx}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-4 text-xs font-mono text-ink-muted tabular-nums shrink-0">
                      {idx + 1}
                    </span>
                    <div
                      className="w-6 h-6 rounded-md border flex items-center justify-center font-mono text-[10px] font-bold uppercase shrink-0"
                      style={{
                        color: routeBadge.color,
                        backgroundColor: routeBadge.softBg,
                        borderColor: routeBadge.border,
                      }}
                    >
                      {routeBadge.short}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {route.name}
                      </div>
                      <div className="text-xs text-ink-muted truncate">
                        {route.subtitle}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-sm text-ink tabular-nums whitespace-nowrap shrink-0">
                    {formatCompactNumber(route.tokens)}{" "}
                    <span className="text-xs text-ink-muted">tok</span>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Live Routing Topology & Gateway Policy Quick Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Live Topology */}
        <div className="lg:col-span-7 bg-surface border border-hairline rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-hairline flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-xs font-semibold text-ink whitespace-nowrap">
                Live Provider Topology
              </span>
              {isLiveActive && (
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{activeRoutes.length} active</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-ink-muted shrink-0">
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
              <button
                type="button"
                onClick={() => onNavigate("combos")}
                className="text-indigo-400 hover:text-indigo-300 font-medium ml-1"
              >
                Combos →
              </button>
            </div>
          </div>

          <div className="px-5 py-5 relative min-h-[220px] flex-1 flex items-center">
            {topologyNodes.length === 0 ? (
              <div className="w-full py-10 flex flex-col items-center justify-center gap-2 text-ink-muted">
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
                <div className="col-span-4 sm:col-span-5 relative h-[190px]">
                  <svg
                    viewBox="0 0 260 200"
                    className="w-full h-full overflow-visible"
                    preserveAspectRatio="none"
                  >
                    <path
                      id="ov-in-path"
                      d="M 0 100 L 58 100"
                      fill="none"
                      stroke={
                        isLiveActive ? "rgba(16,185,129,0.55)" : "var(--border-strong)"
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

                    {branchYs.map((ty, idx) => {
                      const node = topologyNodes[idx];
                      const pid = `ov-branch-${idx}`;
                      const nodeVisual = getProviderVisual(
                        node?.provider || "custom"
                      );
                      const strokeColor =
                        node?.status === "active"
                          ? nodeVisual.color
                          : node?.status === "error"
                            ? "rgba(244,63,94,0.45)"
                            : nodeVisual.border;
                      return (
                        <g key={pid}>
                          <path
                            id={pid}
                            d={`M 82 100 C 145 100, 175 ${ty}, 256 ${ty}`}
                            fill="none"
                            stroke={strokeColor}
                            strokeOpacity={node?.status === "active" ? 0.72 : 0.48}
                            strokeWidth={node?.status === "active" ? "1.8" : "1.25"}
                          />
                          {node?.status === "active" && (
                            <circle r="3.4" fill={nodeVisual.color}>
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
                    className={`absolute top-1/2 -translate-y-1/2 left-[42px] w-9 h-8 flex items-center justify-center transition-all ${
                      isLiveActive
                        ? "drop-shadow-[0_0_16px_rgba(56,189,248,0.45)]"
                        : "drop-shadow-[0_0_10px_rgba(99,102,241,0.28)]"
                    }`}
                    title="AS ROUTER Engine"
                  >
                    <img
                      src="/assets/as-logo.png"
                      alt="AS ROUTER"
                      className="w-7 h-auto object-contain"
                    />
                  </motion.div>
                </div>

                {/* Right Active / Recent Provider + Model Nodes */}
                <div className="col-span-8 sm:col-span-7 h-[190px] flex flex-col justify-center gap-3 py-1">
                  {topologyNodes.map((node, idx) => {
                    const badge = getProviderVisual(node.provider);
                    const borderTone =
                      node.status === "active"
                        ? "border-emerald-400/60 shadow-[0_0_14px_rgba(16,185,129,0.14)]"
                        : node.status === "error"
                          ? "border-rose-500/40"
                          : "border-hairline-strong";
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
                          className={`flex items-center gap-2 px-3 py-1.5 bg-elevated border rounded-full min-w-0 flex-1 ${borderTone}`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${dotTone}`}
                          />
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center font-mono text-[10px] font-bold shrink-0"
                            style={{
                              color: badge.color,
                              backgroundColor: badge.softBg,
                            }}
                          >
                            {badge.short}
                          </span>
                          <span className="font-mono text-xs text-ink truncate">
                            {node.provider}/{node.model}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-[11px] tabular-nums shrink-0 ${
                            node.status === "active"
                              ? "text-emerald-400 font-semibold"
                              : node.status === "error"
                                ? "text-rose-400"
                                : "text-ink-muted"
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

          <div className="px-5 py-3 border-t border-hairline flex items-center justify-between gap-3 text-xs">
            <span className="text-ink-muted truncate font-mono">
              {isLiveActive
                ? `Active: ${activeRoutes[0].provider}/${activeRoutes[0].model}`
                : recentNodes.length > 0
                  ? `Recent: ${recentNodes[0].provider}/${recentNodes[0].model}`
                  : "Idle"}
            </span>
            <span className="font-mono font-semibold text-indigo-400 tabular-nums whitespace-nowrap shrink-0">
              {formatCompactNumber(totalTokens)} tok · {formatUsdSmart(totalCostUsd)}
            </span>
          </div>
        </div>

        {/* Gateway Policy Quick Controls */}
        <div className="lg:col-span-5 bg-surface border border-hairline rounded-xl overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-5 py-3 border-b border-hairline flex items-center justify-between gap-3 text-xs">
              {combos.length > 1 ? (
                <div className="flex items-center gap-2 min-w-0">
                  <label
                    htmlFor="overview-policy-combo"
                    className="text-ink-muted shrink-0"
                  >
                    Policy:
                  </label>
                  <select
                    id="overview-policy-combo"
                    value={previewComboIdx % combos.length}
                    onChange={(e) => setPreviewComboIdx(Number(e.target.value))}
                    className="bg-canvas border border-hairline-strong rounded-md px-2 py-1 text-xs font-mono text-ink focus:outline-none focus:border-indigo-400 truncate max-w-[175px]"
                  >
                    {combos.map((c, idx) => (
                      <option key={c.id} value={idx}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : activeCombo ? (
                <span className="font-mono font-medium text-ink truncate">
                  Policy: {activeCombo.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate("combos")}
                  className="font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  + Create a combo for policies
                </button>
              )}
              <span className="text-ink-muted shrink-0">
                {savingPolicy ? "Saving..." : "Combo controls"}
              </span>
            </div>

            <div className="divide-y divide-hairline">
              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <span className="text-xs sm:text-sm text-ink-2">
                  Prompt compression
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Prompt compression"
                  aria-checked={localCompress}
                  disabled={savingPolicy || !activeCombo}
                  onClick={() =>
                    updateGatewayPolicy({ compressPrompt: !localCompress })
                  }
                  className={`w-10 h-5.5 rounded-full p-0.5 transition-colors flex items-center shrink-0 disabled:opacity-50 ${
                    localCompress ? "bg-indigo-500" : "bg-subtle"
                  }`}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    className={`w-4.5 h-4.5 rounded-full bg-white ${
                      localCompress ? "ml-auto" : "mr-auto"
                    }`}
                  />
                </button>
              </div>

              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <span className="text-xs sm:text-sm text-ink-2">
                  Response caching (10m)
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-label="Response caching"
                  aria-checked={localCache}
                  disabled={savingPolicy || !activeCombo}
                  onClick={() =>
                    updateGatewayPolicy({ enableCache: !localCache })
                  }
                  className={`w-10 h-5.5 rounded-full p-0.5 transition-colors flex items-center shrink-0 disabled:opacity-50 ${
                    localCache ? "bg-indigo-500" : "bg-subtle"
                  }`}
                >
                  <motion.span
                    layout
                    transition={{ type: "spring", stiffness: 500, damping: 32 }}
                    className={`w-4.5 h-4.5 rounded-full bg-white ${
                      localCache ? "ml-auto" : "mr-auto"
                    }`}
                  />
                </button>
              </div>

              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <span className="text-xs sm:text-sm text-ink-2">
                  Routing mode
                </span>
                <div className="inline-flex items-center p-0.5 bg-canvas border border-hairline-strong rounded-md">
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
                      disabled={savingPolicy || !activeCombo}
                      onClick={() => updateGatewayPolicy({ strategy: modeId })}
                      className={`relative px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap disabled:opacity-50 ${
                        localStrategy === modeId
                          ? "text-indigo-400"
                          : "text-ink-muted hover:text-ink-2"
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
                          className="absolute inset-0 bg-elevated rounded"
                        />
                      )}
                      <span className="relative z-10">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-5 py-3.5 flex items-center justify-between gap-4">
                <span className="text-xs sm:text-sm text-ink-2 whitespace-nowrap">
                  Providers
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate("provider-connected")}
                  className="flex items-center gap-1.5 flex-wrap justify-end"
                  title="Manage connected providers"
                >
                  {PROVIDER_CATALOG.filter((spec) => spec.id !== "custom").map((spec) => {
                    const active = connectedProviderSet.has(spec.id);
                    const badge = getProviderVisual(spec.id);
                    return (
                      <span
                        key={spec.id}
                        className={`w-6 h-6 rounded-full border flex items-center justify-center font-mono text-[10px] font-bold transition-all ${
                          active ? "opacity-100 scale-105" : "border-hairline opacity-35"
                        }`}
                        style={{
                          color: active ? badge.color : "var(--text-muted)",
                          backgroundColor: active ? badge.softBg : "var(--bg-canvas)",
                          borderColor: active ? badge.border : undefined,
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

          <div className="px-5 py-3 border-t border-hairline flex items-center justify-between text-xs text-ink-muted">
            <span>Guardrails & scoped keys</span>
            <button
              type="button"
              onClick={() => onNavigate("keys")}
              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-medium"
            >
              <span>Manage API Keys</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Failover Uptime Matrix */}
      <div className="bg-surface border border-hairline rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-hairline flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-ink">
              Failover & Uptime Matrix
            </span>
            <span className="text-xs font-mono text-ink-muted tabular-nums">
              {fallbackRecovered} failover recoveries
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("logs")}
            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap"
          >
            <span>See live failover traces</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {failoverRows.rows.length === 0 ? (
            <div className="py-4 text-xs text-ink-muted">
              Connect providers to visualize real-time failover uptime blocks.
            </div>
          ) : (
            failoverRows.rows.map((row) => {
              const badge = getProviderVisual(row.provider);
              return (
                <div key={row.id} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-5 h-5 rounded flex items-center justify-center font-mono text-[10px] font-bold shrink-0"
                        style={{
                          color: badge.color,
                          backgroundColor: badge.softBg,
                        }}
                      >
                        {badge.short}
                      </span>
                      <span className="text-ink-2 font-medium truncate">
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
                        className={`h-3 flex-1 rounded-[2px] ${
                          state === "ok"
                            ? "bg-[#10B981]"
                            : state === "fail"
                              ? "bg-rose-500"
                              : state === "amber"
                                ? "bg-amber-400"
                                : "bg-subtle"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {/* Aggregated Through AS ROUTER strip */}
          <div className="pt-3.5 border-t border-hairline space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">
                Through AS ROUTER
              </span>
              <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                {successRate.toFixed(1)}% uptime · p50 {p50}ms / p95 {p95}ms
              </span>
            </div>
            <div className="flex items-center gap-1">
              {failoverRows.gatewaySlots.map((state, sIdx) => (
                <div
                  key={sIdx}
                  className={`h-3 flex-1 rounded-[2px] ${
                    state === "ok"
                      ? "bg-[#10B981]"
                      : state === "fail"
                        ? "bg-rose-500"
                        : "bg-subtle"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Gateway Endpoint & Quick cURL Onboarding */}
      <div className="bg-surface border border-hairline rounded-xl p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-ink">
              {endpointMode === "anthropic"
                ? "Anthropic-Compatible Endpoint (/v1/messages)"
                : "OpenAI-Compatible Gateway Endpoint (/v1/chat/completions)"}
            </h3>
            <div className="mt-1 font-mono text-xs text-indigo-400 truncate">
              {endpointMode === "anthropic"
                ? `${environment.gatewayEndpoint}/messages`
                : `${environment.gatewayEndpoint}/chat/completions`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <div className="inline-flex items-center rounded-md bg-canvas border border-hairline-strong p-0.5">
              <button
                type="button"
                onClick={() => setEndpointMode("openai")}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  endpointMode === "openai"
                    ? "bg-elevated text-indigo-300"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                OpenAI
              </button>
              <button
                type="button"
                onClick={() => setEndpointMode("anthropic")}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                  endpointMode === "anthropic"
                    ? "bg-elevated text-indigo-300"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                /v1/messages
              </button>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("playground")}
              className="px-3 py-1.5 text-xs font-medium text-ink bg-elevated hover:bg-subtle border border-hairline-strong rounded-md transition-colors whitespace-nowrap"
            >
              Open Playground
            </button>
            <button
              type="button"
              onClick={copyCurl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline-strong rounded-md transition-colors whitespace-nowrap"
            >
              {copiedCurl ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Snippet</span>
                </>
              )}
            </button>
          </div>
        </div>

        <pre className="p-3.5 bg-canvas border border-hairline-strong rounded-lg font-mono text-xs text-ink-2 overflow-x-auto leading-relaxed">
          {activeSnippet}
        </pre>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
          <span>
            {keys.length > 0
              ? `Replace ${snippetApiKeyPlaceholder} with your full secret from API Keys (prefix ${keys[0].keyPrefix} is masked).`
              : "Create a gateway API key first, then paste the generated sk-asr-... token."}
          </span>
          <button
            type="button"
            onClick={() => onNavigate("keys")}
            className="text-indigo-400 hover:text-indigo-300 font-medium whitespace-nowrap"
          >
            {keys.length > 0 ? "Manage API Keys →" : "Create API Key →"}
          </button>
        </div>
      </div>
    </div>
  );
}
