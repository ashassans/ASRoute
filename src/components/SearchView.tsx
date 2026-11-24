import React, { useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  Plus,
  Search,
  Sparkles,
  Square,
  Terminal,
} from "lucide-react";
import { isSearchProvider } from "../shared/catalog.ts";
import { getProviderVisual } from "../lib/providerVisuals.ts";
import { ToggleSwitch } from "./ToggleSwitch.tsx";
import type {
  GatewayExtractResponse,
  GatewaySearchResponse,
  ProviderConnection,
  SearchEnginePreference,
} from "../types/gateway.ts";

interface SearchViewProps {
  connections: ProviderConnection[];
  gatewayEndpoint?: string;
  onConnectSearchProvider: () => void;
  onRefresh?: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

type SearchMode = "search" | "extract" | "sdk";
type ViewFormat = "formatted" | "json";
type SdkTab = "curl" | "ts" | "python";

const STARTER_QUERIES = [
  "Latest AI gateway routing and LLM fallback benchmarks 2026",
  "Tavily vs Brave vs Exa search API differences for AI agents",
  "TypeScript Node.js native fetch streaming SSE guide",
];

const STARTER_URLS = [
  "https://example.com",
  "https://en.wikipedia.org/wiki/Model_Context_Protocol",
].join("\n");

function safeExternalHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function splitDomains(input: string): string[] {
  return input
    .split(/[,\n\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SearchView({
  connections,
  gatewayEndpoint,
  onConnectSearchProvider,
  onRefresh,
  onNotify,
}: SearchViewProps) {
  const [mode, setMode] = useState<SearchMode>("search");
  const [viewFormat, setViewFormat] = useState<ViewFormat>("formatted");
  const [sdkTab, setSdkTab] = useState<SdkTab>("curl");

  // Search form state
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState<SearchEnginePreference>("auto");
  const [searchDepth, setSearchDepth] = useState<"basic" | "advanced">("basic");
  const [topic, setTopic] = useState<"general" | "news" | "finance">("general");
  const [maxResults, setMaxResults] = useState(5);
  const [timeRange, setTimeRange] = useState<
    "" | "day" | "week" | "month" | "year"
  >("");
  const [includeAnswer, setIncludeAnswer] = useState(true);
  const [includeRawContent, setIncludeRawContent] = useState(false);
  const [showDomainFilters, setShowDomainFilters] = useState(false);
  const [includeDomainsText, setIncludeDomainsText] = useState("");
  const [excludeDomainsText, setExcludeDomainsText] = useState("");

  // Extract form state
  const [extractUrlsText, setExtractUrlsText] = useState("");
  const [extractDepth, setExtractDepth] = useState<"basic" | "advanced">("basic");
  const [extractFormat, setExtractFormat] = useState<"markdown" | "text">(
    "markdown"
  );
  const [extractFocusQuery, setExtractFocusQuery] = useState("");
  const [extractEngine, setExtractEngine] = useState<
    "auto" | "tavily" | "exa" | "builtin"
  >("auto");

  // Execution & output state
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchResult, setSearchResult] =
    useState<GatewaySearchResponse | null>(null);
  const [extractResult, setExtractResult] =
    useState<GatewayExtractResponse | null>(null);
  const [expandedRawIdx, setExpandedRawIdx] = useState<Record<number, boolean>>(
    {}
  );
  const [showHops, setShowHops] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const searchConnections = useMemo(
    () =>
      connections.filter((c) => c.isActive && isSearchProvider(c.provider)),
    [connections]
  );

  const baseOriginUrl = useMemo(() => {
    const raw =
      gatewayEndpoint ||
      (typeof window !== "undefined"
        ? `${window.location.origin}/v1`
        : "https://your-gateway.example.com/v1");
    return raw.replace(/\/+$/, "");
  }, [gatewayEndpoint]);

  const copyText = async (id: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onNotify(`${label} copied.`, "success");
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1500);
    } catch {
      onNotify("Clipboard permission denied", "error");
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
  };

  const runSearch = async (overrideQuery?: string) => {
    const effectiveQuery = (overrideQuery ?? query).trim();
    if (!effectiveQuery) {
      onNotify("Enter a search query first.", "error");
      return;
    }
    if (overrideQuery !== undefined) {
      setQuery(overrideQuery);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setErrorMsg(null);
    setExpandedRawIdx({});
    setShowHops(false);

    try {
      const includeDomains = splitDomains(includeDomainsText);
      const excludeDomains = splitDomains(excludeDomainsText);
      const res = await fetch("/api/search/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          query: effectiveQuery,
          search_depth: searchDepth,
          topic,
          max_results: maxResults,
          include_answer: includeAnswer,
          include_raw_content: includeRawContent,
          include_domains: includeDomains.length > 0 ? includeDomains : undefined,
          exclude_domains: excludeDomains.length > 0 ? excludeDomains : undefined,
          time_range: timeRange || undefined,
          provider: engine,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Search failed (HTTP ${res.status})`);
      }
      setSearchResult(data as GatewaySearchResponse);
      if (onRefresh) void onRefresh();
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Search request failed";
      setErrorMsg(msg);
      onNotify(msg, "error");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  };

  const runExtract = async (overrideUrls?: string) => {
    const raw = (overrideUrls ?? extractUrlsText)
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter(Boolean);
    if (overrideUrls !== undefined) {
      setExtractUrlsText(overrideUrls);
    }
    if (raw.length === 0) {
      onNotify("Paste at least one http:// or https:// URL to extract.", "error");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setErrorMsg(null);
    setShowHops(false);

    try {
      const res = await fetch("/api/search/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          urls: raw,
          extract_depth: extractDepth,
          format: extractFormat,
          query: extractFocusQuery.trim() || undefined,
          provider: extractEngine,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || `URL extract failed (HTTP ${res.status})`
        );
      }
      setExtractResult(data as GatewayExtractResponse);
      if (onRefresh) void onRefresh();
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "URL extraction failed";
      setErrorMsg(msg);
      onNotify(msg, "error");
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  };

  const sdkSnippets: Record<SdkTab, string> = {
    curl: `# Web Search (Tavily-compatible payload + auto failover)
curl -X POST ${baseOriginUrl}/search \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-asr-YOUR_GATEWAY_KEY" \\
  -d '{
    "query": "Latest multi-model AI routing benchmarks 2026",
    "search_depth": "advanced",
    "max_results": 5,
    "include_answer": true,
    "include_raw_content": false
  }'

# URL Content Extraction (up to 20 URLs)
curl -X POST ${baseOriginUrl}/extract \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-asr-YOUR_GATEWAY_KEY" \\
  -d '{
    "urls": ["https://example.com"],
    "format": "markdown"
  }'`,
    ts: `const res = await fetch("${baseOriginUrl}/search", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-asr-YOUR_GATEWAY_KEY",
  },
  body: JSON.stringify({
    query: "TypeScript AI SDK streaming tools",
    search_depth: "basic",
    max_results: 5,
    include_answer: true,
  }),
});

const data = await res.json();
console.log(data.answer);
console.log(data.results);`,
    python: `import requests

resp = requests.post(
    "${baseOriginUrl}/search",
    headers={"Authorization": "Bearer sk-asr-YOUR_GATEWAY_KEY"},
    json={
        "query": "Model Context Protocol specification overview",
        "search_depth": "advanced",
        "max_results": 5,
        "include_answer": True,
    },
    timeout=30,
)
data = resp.json()
print("Engine:", data["x_asrouter"]["resolved_provider"])
print("Answer:", data.get("answer"))`,
  };

  const activeJsonPayload =
    mode === "search"
      ? searchResult
      : mode === "extract"
        ? extractResult
        : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            Web Search &amp; Extract
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>Tavily-compatible /v1/search &amp; /v1/extract</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {searchConnections.length > 0
                ? `${searchConnections.length} search provider${
                    searchConnections.length === 1 ? "" : "s"
                  } connected + Built-in fallback`
                : "Built-in search & scraper ready (zero external keys needed)"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onConnectSearchProvider}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-ink bg-surface hover:bg-elevated border border-hairline-strong rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5 text-indigo-400" />
          <span>Connect Tavily / Brave / Exa</span>
        </button>
      </div>

      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-surface border border-hairline rounded-lg">
          {(
            [
              { id: "search", label: "Web Search", icon: Search, accent: "#22D3EE" },
              { id: "extract", label: "URL Extract", icon: Link2, accent: "#C084FC" },
              { id: "sdk", label: "API & SDK", icon: Terminal, accent: "#34D399" },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setMode(item.id);
                  setErrorMsg(null);
                }}
                className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  active ? "text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="search-mode-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    className="absolute inset-0 bg-elevated border border-hairline-strong rounded-md"
                  />
                )}
                <Icon
                  className="w-3.5 h-3.5 relative z-10"
                  style={{ color: active ? item.accent : undefined }}
                />
                <span className="relative z-10">{item.label}</span>
              </button>
            );
          })}
        </div>

        {activeJsonPayload && mode !== "sdk" && (
          <div className="inline-flex items-center gap-1 p-1 bg-surface border border-hairline rounded-lg">
            <button
              type="button"
              onClick={() => setViewFormat("formatted")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewFormat === "formatted"
                  ? "bg-elevated text-ink"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              Formatted
            </button>
            <button
              type="button"
              onClick={() => setViewFormat("json")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewFormat === "json"
                  ? "bg-elevated text-ink"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              Raw JSON
            </button>
          </div>
        )}
      </div>

      {/* SEARCH MODE */}
      {mode === "search" && (
        <div className="space-y-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
            className="bg-surface border border-hairline rounded-xl p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-ink-dim absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask anything or search the live web..."
                  className="w-full bg-canvas border border-hairline rounded-lg pl-10 pr-4 py-2.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                />
              </div>

              {running ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold bg-gradient-to-r from-cyan-500 via-indigo-500 to-violet-500 hover:brightness-110 text-ink rounded-lg transition-all shadow-[0_6px_18px_rgba(34,211,238,0.2)] whitespace-nowrap shrink-0"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>Run Search</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Routing Engine
                </label>
                <select
                  value={engine}
                  onChange={(e) =>
                    setEngine(e.target.value as SearchEnginePreference)
                  }
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500"
                >
                  <option value="auto">Auto Failover</option>
                  <option value="builtin">Built-in Engine</option>
                  <option value="tavily">Tavily Only</option>
                  <option value="brave-search">Brave Search Only</option>
                  <option value="exa">Exa Only</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Search Depth
                </label>
                <select
                  value={searchDepth}
                  onChange={(e) =>
                    setSearchDepth(e.target.value as "basic" | "advanced")
                  }
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500"
                >
                  <option value="basic">Basic (Fast)</option>
                  <option value="advanced">Advanced (Deep)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Topic
                </label>
                <select
                  value={topic}
                  onChange={(e) =>
                    setTopic(e.target.value as "general" | "news" | "finance")
                  }
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500"
                >
                  <option value="general">General</option>
                  <option value="news">News</option>
                  <option value="finance">Finance</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Max Results
                </label>
                <select
                  value={maxResults}
                  onChange={(e) => setMaxResults(Number(e.target.value))}
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink tabular-nums focus:outline-none focus:border-indigo-500"
                >
                  <option value={3}>3 results</option>
                  <option value={5}>5 results</option>
                  <option value={10}>10 results</option>
                  <option value={15}>15 results</option>
                  <option value={20}>20 results</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Time Range
                </label>
                <select
                  value={timeRange}
                  onChange={(e) =>
                    setTimeRange(
                      e.target.value as "" | "day" | "week" | "month" | "year"
                    )
                  }
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Any time</option>
                  <option value="day">Past 24h</option>
                  <option value="week">Past week</option>
                  <option value="month">Past month</option>
                  <option value="year">Past year</option>
                </select>
              </div>
            </div>

            <div className="pt-2 border-t border-hairline flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-6">
                <ToggleSwitch
                  checked={includeAnswer}
                  onChange={setIncludeAnswer}
                  label="Include AI Answer"
                />
                <ToggleSwitch
                  checked={includeRawContent}
                  onChange={setIncludeRawContent}
                  label="Include Raw Markdown"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowDomainFilters((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors whitespace-nowrap"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${
                    showDomainFilters ? "rotate-180" : ""
                  }`}
                />
                <span>Domain Filters</span>
              </button>
            </div>

            {showDomainFilters && (
              <div className="pt-3 border-t border-hairline grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Include Domains (comma separated)
                  </label>
                  <input
                    type="text"
                    value={includeDomainsText}
                    onChange={(e) => setIncludeDomainsText(e.target.value)}
                    placeholder="github.com, docs.python.org"
                    className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink-muted mb-1">
                    Exclude Domains (comma separated)
                  </label>
                  <input
                    type="text"
                    value={excludeDomainsText}
                    onChange={(e) => setExcludeDomainsText(e.target.value)}
                    placeholder="pinterest.com, quora.com"
                    className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-xs font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            )}
          </form>

          {errorMsg && (
            <div className="px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {running && (
            <div className="space-y-3">
              <div className="h-28 bg-surface border border-hairline rounded-xl animate-pulse" />
              <div className="h-24 bg-surface border border-hairline rounded-xl animate-pulse" />
              <div className="h-24 bg-surface border border-hairline rounded-xl animate-pulse" />
            </div>
          )}

          {!running && !searchResult && !errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
              className="relative overflow-hidden bg-surface border border-hairline rounded-xl p-8 text-center space-y-4"
            >
              <span
                className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                style={{
                  background:
                    "linear-gradient(90deg, #22D3EE, #818CF8, #34D399, transparent)",
                }}
              />
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 via-indigo-500/20 to-emerald-500/20 border border-cyan-400/35 flex items-center justify-center mx-auto shadow-[0_0_20px_rgba(34,211,238,0.18)]">
                <Globe className="w-5 h-5 text-cyan-300" />
              </div>
              <div className="space-y-1">
                <h2 className="font-display text-base font-semibold text-ink">
                  Search live web pages or synthesize cited answers
                </h2>
                <p className="text-xs text-ink-muted max-w-lg mx-auto">
                  Routes across connected Tavily, Brave Search, and Exa keys
                  with automatic failover, or runs immediately using AS ROUTER’s
                  built-in search &amp; Markdown scraper.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {STARTER_QUERIES.map((q, idx) => {
                  const hoverBorders = [
                    "hover:border-cyan-400/50",
                    "hover:border-violet-400/50",
                    "hover:border-emerald-400/50",
                  ];
                  return (
                    <motion.button
                      key={q}
                      type="button"
                      whileHover={{ y: -1 }}
                      onClick={() => void runSearch(q)}
                      className={`px-3 py-1.5 text-xs text-ink-2 hover:text-ink bg-canvas hover:bg-elevated border border-hairline-strong ${hoverBorders[idx % hoverBorders.length]} rounded-lg transition-colors text-left`}
                    >
                      {q}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {!running && searchResult && viewFormat === "json" && (
            <div className="bg-surface border border-hairline rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-hairline flex items-center justify-between">
                <span className="font-mono text-xs text-ink-muted">
                  POST /v1/search response
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "search-json",
                      JSON.stringify(searchResult, null, 2),
                      "JSON"
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline-strong rounded-md"
                >
                  {copiedId === "search-json" ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-ink-2 overflow-x-auto max-h-[560px] leading-relaxed">
                {JSON.stringify(searchResult, null, 2)}
              </pre>
            </div>
          )}

          {!running && searchResult && viewFormat === "formatted" && (
            <div className="space-y-4">
              {/* Telemetry Summary Line */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-ink-muted">
                <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                  <span
                    className="font-semibold"
                    style={{
                      color: getProviderVisual(
                        searchResult.x_asrouter.resolved_provider
                      ).color,
                    }}
                  >
                    {searchResult.x_asrouter.resolved_provider}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{searchResult.x_asrouter.latency_ms}ms</span>
                  <span aria-hidden="true">·</span>
                  <span>{searchResult.results.length} results</span>
                  {searchResult.x_asrouter.answer_model && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        Answer: {searchResult.x_asrouter.answer_model}
                      </span>
                    </>
                  )}
                </div>

                {searchResult.x_asrouter.fallback_hops.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHops((v) => !v)}
                    className="text-xs font-mono text-indigo-400 hover:text-indigo-300"
                  >
                    {showHops ? "Hide" : "Inspect"} hops (
                    {searchResult.x_asrouter.fallback_hops.length})
                  </button>
                )}
              </div>

              {showHops && (
                <div className="bg-surface border border-hairline rounded-xl p-4 space-y-2">
                  {searchResult.x_asrouter.fallback_hops.map((hop, idx) => (
                    <div
                      key={`${hop.connectionId}-${idx}`}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono py-1.5 border-b border-hairline last:border-b-0"
                    >
                      <span className="text-ink">
                        {hop.connectionName} ({hop.provider})
                      </span>
                      <span
                        className={
                          hop.status === "success"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {hop.status} · {hop.latencyMs}ms · {hop.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* AI Answer */}
              {searchResult.answer && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28 }}
                  className="relative overflow-hidden bg-surface border border-indigo-500/35 rounded-xl p-5 space-y-2.5 shadow-[0_0_28px_rgba(99,102,241,0.08)]"
                >
                  <span
                    className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                    style={{
                      background:
                        "linear-gradient(90deg, #22D3EE 0%, #818CF8 50%, #34D399 100%)",
                    }}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-xs font-medium text-cyan-300">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                      <span>Synthesized Answer</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText("ai-answer", searchResult.answer || "", "Answer")
                      }
                      className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                    >
                      {copiedId === "ai-answer" ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>Copy</span>
                    </button>
                  </div>
                  <div className="text-sm text-ink-2 leading-relaxed whitespace-pre-wrap">
                    {searchResult.answer}
                  </div>
                </motion.div>
              )}

              {/* Ranked Search Results */}
              {searchResult.results.length === 0 ? (
                <div className="bg-surface border border-hairline rounded-xl p-8 text-center text-xs text-ink-muted">
                  No web results matched your query and domain filters.
                </div>
              ) : (
                <div className="divide-y divide-hairline bg-surface border border-hairline rounded-xl overflow-hidden">
                  {searchResult.results.map((item, idx) => {
                    const href = safeExternalHref(item.url);
                    const isExpanded = Boolean(expandedRawIdx[idx]);
                    return (
                      <motion.div
                        key={`${item.url}-${idx}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22, delay: Math.min(idx * 0.04, 0.2) }}
                        className="p-5 space-y-2 hover:bg-elevated/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-indigo-400 transition-colors"
                              >
                                <span className="truncate">{item.title}</span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-ink-dim" />
                              </a>
                            ) : (
                              <div className="text-sm font-semibold text-ink">
                                {item.title}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted font-mono tabular-nums">
                              <span>{getHostname(item.url)}</span>
                              <span aria-hidden="true">·</span>
                              <span>{Math.round(item.score * 100)}% relevance</span>
                              {item.published_date && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{item.published_date}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {item.raw_content && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedRawIdx((prev) => ({
                                  ...prev,
                                  [idx]: !prev[idx],
                                }))
                              }
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink bg-elevated border border-hairline-strong rounded-md whitespace-nowrap shrink-0"
                            >
                              <FileText className="w-3.5 h-3.5 text-indigo-400" />
                              <span>
                                {isExpanded ? "Hide Markdown" : "View Markdown"}
                              </span>
                            </button>
                          )}
                        </div>

                        <p className="text-sm text-ink-2 leading-relaxed">
                          {item.content}
                        </p>

                        {isExpanded && item.raw_content && (
                          <pre className="mt-2 p-3.5 bg-canvas border border-hairline rounded-lg text-xs font-mono text-ink-2 overflow-x-auto max-h-72 whitespace-pre-wrap leading-relaxed">
                            {item.raw_content}
                          </pre>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* EXTRACT MODE */}
      {mode === "extract" && (
        <div className="space-y-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runExtract();
            }}
            className="bg-surface border border-hairline rounded-xl p-5 space-y-4"
          >
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-ink-2">
                  Target URLs (one per line, up to 20)
                </label>
                <button
                  type="button"
                  onClick={() => setExtractUrlsText(STARTER_URLS)}
                  className="text-xs text-indigo-400 hover:text-indigo-300"
                >
                  Load sample URLs
                </button>
              </div>
              <textarea
                rows={4}
                value={extractUrlsText}
                onChange={(e) => setExtractUrlsText(e.target.value)}
                placeholder={"https://docs.example.com/guide\nhttps://example.com"}
                className="w-full bg-canvas border border-hairline rounded-lg px-3.5 py-2.5 text-xs font-mono text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Routing Engine
                </label>
                <select
                  value={extractEngine}
                  onChange={(e) =>
                    setExtractEngine(
                      e.target.value as "auto" | "tavily" | "exa" | "builtin"
                    )
                  }
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500"
                >
                  <option value="auto">Auto Failover</option>
                  <option value="builtin">Built-in Scraper</option>
                  <option value="tavily">Tavily Extract</option>
                  <option value="exa">Exa Contents</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Format
                </label>
                <select
                  value={extractFormat}
                  onChange={(e) =>
                    setExtractFormat(e.target.value as "markdown" | "text")
                  }
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500"
                >
                  <option value="markdown">Clean Markdown</option>
                  <option value="text">Plain Text</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Extract Depth
                </label>
                <select
                  value={extractDepth}
                  onChange={(e) =>
                    setExtractDepth(e.target.value as "basic" | "advanced")
                  }
                  className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-2 text-xs text-ink focus:outline-none focus:border-indigo-500"
                >
                  <option value="basic">Basic</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-ink-muted mb-1">
                  Focus Query (Optional)
                </label>
                <input
                  type="text"
                  value={extractFocusQuery}
                  onChange={(e) => setExtractFocusQuery(e.target.value)}
                  placeholder="Filter relevant chunks..."
                  className="w-full bg-canvas border border-hairline rounded-lg px-3 py-2 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              {running ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 rounded-lg whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Extract Pages</span>
                </button>
              )}
            </div>
          </form>

          {errorMsg && (
            <div className="px-4 py-3 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {running && (
            <div className="space-y-3">
              <div className="h-36 bg-surface border border-hairline rounded-xl animate-pulse" />
              <div className="h-36 bg-surface border border-hairline rounded-xl animate-pulse" />
            </div>
          )}

          {!running && extractResult && viewFormat === "json" && (
            <div className="bg-surface border border-hairline rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-hairline flex items-center justify-between">
                <span className="font-mono text-xs text-ink-muted">
                  POST /v1/extract response
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      "extract-json",
                      JSON.stringify(extractResult, null, 2),
                      "JSON"
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline-strong rounded-md"
                >
                  {copiedId === "extract-json" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>Copy JSON</span>
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-ink-2 overflow-x-auto max-h-[560px] leading-relaxed">
                {JSON.stringify(extractResult, null, 2)}
              </pre>
            </div>
          )}

          {!running && extractResult && viewFormat === "formatted" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-ink-muted font-mono tabular-nums">
                <span
                  className="font-semibold"
                  style={{
                    color: getProviderVisual(
                      extractResult.x_asrouter.resolved_provider
                    ).color,
                  }}
                >
                  {extractResult.x_asrouter.resolved_provider}
                </span>
                <span aria-hidden="true">·</span>
                <span>{extractResult.x_asrouter.latency_ms}ms</span>
                <span aria-hidden="true">·</span>
                <span>{extractResult.results.length} extracted</span>
                {extractResult.failed_results.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-red-400">
                      {extractResult.failed_results.length} failed
                    </span>
                  </>
                )}
              </div>

              {extractResult.results.map((item, idx) => {
                const href = safeExternalHref(item.url);
                return (
                  <div
                    key={`${item.url}-${idx}`}
                    className="bg-surface border border-hairline rounded-xl overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-hairline flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink truncate">
                          {item.title || getHostname(item.url)}
                        </div>
                        {href && (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-mono text-ink-muted hover:text-indigo-400 truncate max-w-full"
                          >
                            <span className="truncate">{item.url}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            `extract-${idx}`,
                            item.raw_content,
                            "Extracted content"
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink bg-elevated border border-hairline-strong rounded-md whitespace-nowrap shrink-0"
                      >
                        {copiedId === `extract-${idx}` ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="p-4 text-xs font-mono text-ink-2 overflow-x-auto max-h-80 whitespace-pre-wrap leading-relaxed bg-canvas">
                      {item.raw_content}
                    </pre>
                  </div>
                );
              })}

              {extractResult.failed_results.length > 0 && (
                <div className="bg-surface border border-red-500/30 rounded-xl p-4 space-y-2">
                  <div className="text-xs font-medium text-red-400">
                    Failed URLs
                  </div>
                  {extractResult.failed_results.map((fail, idx) => (
                    <div
                      key={`${fail.url}-${idx}`}
                      className="text-xs font-mono text-red-300 flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="truncate">{fail.url}</span>
                      <span className="text-ink-muted">{fail.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SDK MODE */}
      {mode === "sdk" && (
        <div className="bg-surface border border-hairline rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-hairline flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1">
              {(
                [
                  ["curl", "cURL"],
                  ["ts", "TypeScript"],
                  ["python", "Python"],
                ] as const
              ).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setSdkTab(tabId)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    sdkTab === tabId
                      ? "bg-elevated text-indigo-400"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                copyText("sdk-code", sdkSnippets[sdkTab], "Code snippet")
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink bg-canvas border border-hairline-strong rounded-md"
            >
              {copiedId === "sdk-code" ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-5 font-mono text-xs text-ink-2 overflow-x-auto leading-relaxed bg-canvas">
            {sdkSnippets[sdkTab]}
          </pre>
        </div>
      )}
    </div>
  );
}
