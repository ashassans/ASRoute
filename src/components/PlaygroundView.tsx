import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Check,
  Copy,
  ImagePlus,
  RefreshCw,
  SlidersHorizontal,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import { getProviderSpec, isSearchProvider } from "../shared/catalog.ts";
import { ToggleSwitch } from "./ToggleSwitch.tsx";
import type {
  Combo,
  FallbackHop,
  ProviderConnection,
} from "../types/gateway.ts";

interface PlaygroundViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  onRefresh?: () => Promise<void>;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  imageDataUrl?: string | null;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  meta?: {
    resolvedProvider: string;
    resolvedModel: string;
    detectedIntent?: string;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    latencyMs: number;
    cached?: boolean;
    fallbackAttempts: FallbackHop[];
  };
  isError?: boolean;
}

const DEFAULT_TOOLS_JSON = JSON.stringify(
  [
    {
      type: "function",
      function: {
        name: "get_server_metrics",
        description: "Fetch live latency and health status for a service region.",
        parameters: {
          type: "object",
          properties: {
            region: {
              type: "string",
              description: "Cloud region code, e.g. us-east-1 or asia-east1",
            },
          },
          required: ["region"],
        },
      },
    },
  ],
  null,
  2
);

const STARTER_PROMPTS = [
  "Explain how fallback routing keeps AI apps online in 3 concise bullets.",
  "Write a TypeScript debounce hook with cleanup and strict types.",
  "Draft a crisp JSON API error response schema for rate limits.",
];

function AssistantMessageBody({
  content,
  isError,
  onNotify,
}: {
  content: string;
  isError?: boolean;
  onNotify?: (msg: string, tone?: "success" | "error") => void;
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  if (isError) {
    return (
      <div className="text-sm whitespace-pre-wrap leading-7 text-red-300">
        {content}
      </div>
    );
  }

  const segments = content.split(/(```[\s\S]*?```)/g);
  return (
    <div className="space-y-3 text-sm leading-7 text-[#E4E4E7]">
      {segments.map((seg, idx) => {
        if (seg.startsWith("```") && seg.endsWith("```")) {
          const inner = seg.slice(3, -3);
          const firstNewline = inner.indexOf("\n");
          const lang =
            firstNewline !== -1 ? inner.slice(0, firstNewline).trim() : "";
          const code =
            firstNewline !== -1
              ? inner.slice(firstNewline + 1).replace(/\n$/, "")
              : inner;
          return (
            <div
              key={idx}
              className="rounded-xl border border-[#27272A] bg-[#09090B] overflow-hidden"
            >
              <div className="px-3.5 py-1.5 border-b border-[#1D1D22] flex items-center justify-between text-[11px] font-mono text-[#8B8B95]">
                <span>{lang || "code"}</span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(code);
                      setCopiedIdx(idx);
                      setTimeout(
                        () => setCopiedIdx((c) => (c === idx ? null : c)),
                        1600
                      );
                    } catch {
                      onNotify?.("Clipboard access denied", "error");
                    }
                  }}
                  className="inline-flex items-center gap-1 hover:text-white transition-colors"
                >
                  {copiedIdx === idx ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3.5 text-xs font-mono text-[#F4F4F5] overflow-x-auto leading-relaxed">
                {code}
              </pre>
            </div>
          );
        }
        if (!seg) return null;
        return (
          <div key={idx} className="whitespace-pre-wrap">
            {seg.replace(/^\n+|\n+$/g, "")}
          </div>
        );
      })}
    </div>
  );
}

export function PlaygroundView({
  combos,
  connections,
  onRefresh,
  onNotify,
}: PlaygroundViewProps) {
  const modelOptions = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    for (const c of combos) {
      if (c.isActive) {
        list.push({ value: c.name, label: `Combo: ${c.name}` });
      }
    }
    const seen = new Set<string>();
    for (const conn of connections) {
      if (!conn.isActive || isSearchProvider(conn.provider)) continue;
      const spec = getProviderSpec(conn.provider);
      const connModels = Array.from(
        new Set([
          ...(conn.defaultModel ? [conn.defaultModel] : []),
          ...(conn.availableModels || []),
        ])
      );
      for (const m of connModels) {
        const key = `${conn.provider}/${m}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            value: key,
            label: `${conn.name} — ${m}`,
          });
        }
      }
      for (const m of spec.models) {
        const key = `${conn.provider}/${m.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({ value: key, label: `${spec.label} — ${m.id}` });
        }
      }
    }
    return list;
  }, [combos, connections]);

  const [selectedModel, setSelectedModel] = useState(
    modelOptions[0]?.value || "gemini/gemini-4-hydrogen"
  );
  const [syncingModels, setSyncingModels] = useState(false);

  useEffect(() => {
    if (
      modelOptions.length > 0 &&
      !modelOptions.some((opt) => opt.value === selectedModel)
    ) {
      setSelectedModel(modelOptions[0].value);
    }
  }, [modelOptions, selectedModel]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a concise, helpful AI assistant."
  );
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [enableTools, setEnableTools] = useState(false);
  const [toolsJson, setToolsJson] = useState(DEFAULT_TOOLS_JSON);
  const [freeOnly, setFreeOnly] = useState(false);
  const [useCache, setUseCache] = useState(false);
  const [streamResponse, setStreamResponse] = useState(true);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState("2048");
  const [clearingCache, setClearingCache] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [running, setRunning] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toolReplyDrafts, setToolReplyDrafts] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showSettings) setShowSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSettings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, running]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputText]);

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onNotify("Image must be under 5MB.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setImageDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSyncAllModels = async (onlyFree = false) => {
    const activeConns = connections.filter((c) => c.isActive);
    if (activeConns.length === 0) {
      onNotify("No active provider connections to sync.", "error");
      return;
    }
    setSyncingModels(true);
    let syncedCount = 0;
    let totalModels = 0;
    try {
      for (const conn of activeConns) {
        try {
          const res = await fetch("/api/providers/fetch-models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ connectionId: conn.id, freeOnly: onlyFree }),
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.models)) {
              syncedCount += 1;
              totalModels += data.models.length;
            }
          }
        } catch {
          // continue syncing remaining connections
        }
      }
      if (onRefresh) {
        await onRefresh();
      }
      if (syncedCount > 0) {
        onNotify(
          `Synced ${totalModels}${onlyFree ? " free" : ""} models across ${syncedCount} provider${syncedCount === 1 ? "" : "s"}.`,
          "success"
        );
      } else {
        onNotify("Unable to fetch models from active providers.", "error");
      }
    } finally {
      setSyncingModels(false);
    }
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const res = await fetch("/api/cache/clear", { method: "POST" });
      if (res.ok) {
        onNotify("Response cache cleared.", "success");
      } else {
        onNotify("Failed to clear response cache.", "error");
      }
    } catch {
      onNotify("Network error clearing cache.", "error");
    } finally {
      setClearingCache(false);
    }
  };

  const sendMessage = async (overrideText?: string) => {
    const promptText = (overrideText ?? inputText).trim();
    if ((!promptText && !imageDataUrl) || running) return;
    if (connections.length === 0) {
      onNotify("Add an active provider first.", "error");
      return;
    }

    let parsedTools: unknown = undefined;
    if (enableTools) {
      try {
        parsedTools = JSON.parse(toolsJson);
        if (!Array.isArray(parsedTools)) {
          onNotify("Tools JSON must be an array of function definitions.", "error");
          return;
        }
      } catch {
        onNotify("Invalid JSON in Tools definition.", "error");
        return;
      }
    }

    const attachedImage = imageDataUrl;
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: "user",
      content: promptText,
      imageDataUrl: attachedImage,
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (overrideText === undefined) {
      setInputText("");
    }
    setImageDataUrl(null);
    await executeTurn(nextHistory, parsedTools);
  };

  const handleSubmitToolOutput = async (
    toolCallId: string,
    toolName: string
  ) => {
    if (running) return;
    const rawOutput = (
      toolReplyDrafts[toolCallId] ?? '{"status":"ok"}'
    ).trim();
    let parsedTools: unknown = undefined;
    if (enableTools) {
      try {
        parsedTools = JSON.parse(toolsJson);
      } catch {
        parsedTools = undefined;
      }
    }
    const toolMsg: ChatMessage = {
      id: `t_${Date.now()}`,
      role: "tool",
      toolCallId,
      toolName,
      content: rawOutput || '{"status":"ok"}',
    };
    const nextHistory = [...messages, toolMsg];
    setMessages(nextHistory);
    await executeTurn(nextHistory, parsedTools);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };
  const executeTurn = async (nextHistory: ChatMessage[], parsedTools?: unknown) => {
    setRunning(true);
    const assistantId = `a_${Date.now()}`;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const apiMessages = [
        ...(systemPrompt.trim()
          ? [{ role: "system", content: systemPrompt.trim() }]
          : []),
        ...nextHistory
          .filter((m) => !m.isError)
          .map((m) => {
            if (m.role === "user" && m.imageDataUrl) {
              return {
                role: "user",
                content: [
                  ...(m.content ? [{ type: "text", text: m.content }] : []),
                  { type: "image_url", image_url: { url: m.imageDataUrl } },
                ],
              };
            }
            if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
              return {
                role: "assistant",
                content: m.content || null,
                tool_calls: m.toolCalls,
              };
            }
            if (m.role === "tool") {
              return {
                role: "tool",
                tool_call_id: m.toolCallId,
                name: m.toolName,
                content: m.content,
              };
            }
            return { role: m.role, content: m.content };
          }),
      ];

      const parsedMaxTokens = Number(maxTokens);
      const res = await fetch("/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: selectedModel,
          messages: apiMessages,
          temperature,
          max_tokens:
            Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0
              ? Math.round(parsedMaxTokens)
              : undefined,
          tools: parsedTools,
          freeOnly,
          useCache,
          stream: streamResponse,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (streamResponse && res.ok && contentType.includes("text/event-stream") && res.body) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "",
          },
        ]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "message";
        let streamedText = "";

        const processLine = (rawLine: string) => {
          const line = rawLine.replace(/\r$/, "");
          if (!line) {
            eventName = "message";
            return;
          }
          if (line.startsWith(":")) return;
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
            return;
          }
          if (!line.startsWith("data:")) return;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr) return;

          try {
            const payload = JSON.parse(payloadStr);
            if (eventName === "delta") {
              if (typeof payload.content === "string" && payload.content) {
                streamedText += payload.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: streamedText } : m
                  )
                );
              }
            } else if (eventName === "result") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: payload.content || streamedText,
                        toolCalls: payload.toolCalls,
                        meta: {
                          resolvedProvider: payload.resolvedProvider,
                          resolvedModel: payload.resolvedModel,
                          detectedIntent: payload.detectedIntent,
                          promptTokens: payload.promptTokens,
                          completionTokens: payload.completionTokens,
                          estimatedCostUsd: payload.estimatedCostUsd,
                          latencyMs: payload.latencyMs,
                          cached: payload.cached,
                          fallbackAttempts: payload.fallbackAttempts || [],
                        },
                      }
                    : m
                )
              );
            } else if (eventName === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: streamedText
                          ? `${streamedText}\n\n[Stream error: ${payload.error || "Stream failed"}]`
                          : payload.error || "Stream failed",
                        isError: !streamedText,
                      }
                    : m
                )
              );
            }
          } catch {
            // ignore partial/malformed SSE chunk
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            processLine(line);
          }
        }
        if (buffer.trim()) {
          processLine(buffer);
        }
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        const errText = data.error || "Request failed";
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: errText,
            isError: true,
          },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: data.content || "",
          toolCalls: data.toolCalls,
          meta: {
            resolvedProvider: data.resolvedProvider,
            resolvedModel: data.resolvedModel,
            detectedIntent: data.detectedIntent,
            promptTokens: data.promptTokens,
            completionTokens: data.completionTokens,
            estimatedCostUsd: data.estimatedCostUsd,
            latencyMs: data.latencyMs,
            cached: data.cached,
            fallbackAttempts: data.fallbackAttempts || [],
          },
        },
      ]);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setMessages((prev) => {
        const hasAssistant = prev.some((m) => m.id === assistantId);
        if (hasAssistant) {
          return prev.map((m) =>
            m.id === assistantId && !m.content
              ? { ...m, content: "Network error reaching the gateway.", isError: true }
              : m
          );
        }
        return [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "Network error reaching the gateway.",
            isError: true,
          },
        ];
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setRunning(false);
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    const textToCopy =
      msg.content ||
      (msg.toolCalls ? JSON.stringify(msg.toolCalls, null, 2) : "");
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId((id) => (id === msg.id ? null : id)), 1800);
    } catch {
      onNotify("Clipboard access denied", "error");
    }
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInputText("");
    setImageDataUrl(null);
    textareaRef.current?.focus();
  };

  return (
    <div className="h-[calc(100dvh-7.5rem)] min-h-[420px] flex flex-col max-w-4xl mx-auto">
      {/* Chat Header: Model Selector + Settings Popover + New Chat */}
      <div className="flex items-center justify-between gap-2 sm:gap-3 pb-3 relative">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            aria-label="Select model or combo"
            className="flex-1 min-w-0 sm:flex-none sm:max-w-[360px] truncate bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400 transition-colors"
          >
            {modelOptions.length === 0 ? (
              <option value="gemini/gemini-4-hydrogen">
                No active providers configured
              </option>
            ) : (
              modelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )}
          </select>

          {freeOnly && (
            <span className="text-[11px] font-medium text-emerald-400 whitespace-nowrap hidden sm:inline">
              Free-only
            </span>
          )}
          {useCache && (
            <span className="text-[11px] font-medium text-sky-400 whitespace-nowrap hidden sm:inline">
              Cached
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
              showSettings
                ? "bg-[#18181B] border-[#3F3F46] text-white"
                : "bg-[#111114] hover:bg-[#18181B] border-[#222227] text-[#D4D4D8] hover:text-white"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Options</span>
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#111114] hover:bg-[#18181B] border border-[#222227] rounded-xl text-[#D4D4D8] hover:text-white transition-colors whitespace-nowrap"
            >
              <SquarePen className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New chat</span>
            </button>
          )}
        </div>

        {/* Clean Floating Chat Options Panel */}
        <AnimatePresence>
          {showSettings && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-20"
                onClick={() => setShowSettings(false)}
                aria-hidden="true"
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 top-11 z-30 w-80 sm:w-96 bg-[#111114] border border-[#27272A] rounded-2xl shadow-2xl p-4 space-y-4 origin-top-right"
              >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  Chat Options
                </span>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="text-[#71717A] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  System Instruction
                </label>
                <textarea
                  rows={2}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-[#D4D4D8] mb-1">
                    <span>Temperature</span>
                    <span className="font-mono text-amber-400">
                      {temperature.toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-full accent-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#D4D4D8] mb-1">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    min={64}
                    max={32768}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-2.5 py-1 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div className="divide-y divide-[#1D1D22] border-y border-[#1D1D22] py-1">
                <ToggleSwitch
                  checked={streamResponse}
                  onChange={setStreamResponse}
                  label="Live Streaming"
                  hint="Stream tokens chunk-by-chunk"
                />
                <ToggleSwitch
                  checked={freeOnly}
                  onChange={setFreeOnly}
                  label="Free-Only Lock"
                  hint="Block paid models and force $0 routes"
                />
                <ToggleSwitch
                  checked={useCache}
                  onChange={setUseCache}
                  label="Response Cache"
                  hint="Reuse identical answers for 10m"
                />
                <ToggleSwitch
                  checked={enableTools}
                  onChange={setEnableTools}
                  label="Function Tools JSON"
                  hint="Attach OpenAI tool definitions"
                />
              </div>

              <AnimatePresence initial={false}>
                {enableTools && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <textarea
                      rows={5}
                      value={toolsJson}
                      onChange={(e) => setToolsJson(e.target.value)}
                      className="w-full bg-[#09090B] border border-[#222227] rounded-xl px-3 py-2 text-[11px] font-mono text-[#E5E7EB] focus:outline-none focus:border-amber-400"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center justify-between gap-2 text-xs text-[#A1A1AA]">
                {connections.some((c) => c.isActive) ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSyncAllModels(true)}
                      disabled={syncingModels}
                      className="hover:text-white transition-colors"
                    >
                      Sync free
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => handleSyncAllModels(false)}
                      disabled={syncingModels}
                      className="inline-flex items-center gap-1 hover:text-white transition-colors"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${syncingModels ? "animate-spin" : ""}`}
                      />
                      <span>{syncingModels ? "Syncing..." : "Sync all"}</span>
                    </button>
                  </div>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={handleClearCache}
                  disabled={clearingCache}
                  className="hover:text-white transition-colors"
                >
                  {clearingCache ? "Clearing..." : "Clear cache"}
                </button>
              </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Scrollable Chat Conversation Area */}
      <div className="flex-1 overflow-y-auto px-1 py-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-10 h-10 rounded-full bg-[#111114] border border-[#27272A] flex items-center justify-center font-display text-sm font-bold text-amber-400 mb-4">
              AS
            </div>
            <h2 className="font-display text-xl sm:text-2xl font-semibold text-white tracking-tight">
              {connections.length === 0
                ? "Connect a provider to start chatting"
                : "What would you like to ask?"}
            </h2>
            <p className="mt-1.5 text-xs text-[#71717A] font-mono">
              {selectedModel}
            </p>

            {connections.length > 0 && (
              <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-w-2xl w-full text-left">
                {STARTER_PROMPTS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => sendMessage(starter)}
                    className="p-3.5 rounded-xl bg-[#111114] hover:bg-[#18181B] border border-[#222227] hover:border-[#303038] text-xs text-[#D4D4D8] hover:text-white transition-colors leading-relaxed"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto w-full pb-2">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="flex justify-end"
                >
                  <div className="max-w-[82%] bg-[#18181B] border border-[#27272A] rounded-2xl px-4 py-3 text-sm text-[#F4F4F5] space-y-2.5">
                    {msg.imageDataUrl && (
                      <img
                        src={msg.imageDataUrl}
                        alt="Uploaded prompt attachment"
                        className="max-h-48 rounded-lg border border-[#27272A] object-contain"
                      />
                    )}
                    {msg.content && (
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : msg.role === "tool" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[82%] bg-[#09090B] border border-emerald-500/30 rounded-xl px-3.5 py-2 text-xs font-mono text-emerald-300 space-y-1">
                    <div className="text-[11px] text-emerald-400">
                      tool output ({msg.toolName || msg.toolCallId})
                    </div>
                    <div className="whitespace-pre-wrap break-all text-[#D4D4D8]">
                      {msg.content}
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-start gap-3.5"
                >
                  <div
                    className={`w-7 h-7 rounded-full border flex items-center justify-center font-display text-[11px] font-bold shrink-0 mt-0.5 ${
                      msg.isError
                        ? "bg-red-500/10 border-red-500/30 text-red-400"
                        : "bg-[#111114] border-[#27272A] text-amber-400"
                    }`}
                  >
                    AS
                  </div>

                  <div className="flex-1 min-w-0 space-y-2.5">
                    {msg.content && (
                      <AssistantMessageBody
                        content={msg.content}
                        isError={msg.isError}
                        onNotify={onNotify}
                      />
                    )}

                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="bg-[#111114] border border-[#222227] rounded-xl p-3.5 space-y-3">
                        <div className="text-xs font-medium text-emerald-400">
                          Tool Calls ({msg.toolCalls.length})
                        </div>
                        <pre className="font-mono text-xs text-[#E5E7EB] overflow-x-auto">
                          {JSON.stringify(msg.toolCalls, null, 2)}
                        </pre>
                        {msg.toolCalls.map((tc) => (
                          <div
                            key={tc.id}
                            className="pt-2 border-t border-[#222227] flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                          >
                            <input
                              type="text"
                              value={
                                toolReplyDrafts[tc.id] ??
                                '{"status":"ok","latencyMs":42}'
                              }
                              onChange={(e) =>
                                setToolReplyDrafts((prev) => ({
                                  ...prev,
                                  [tc.id]: e.target.value,
                                }))
                              }
                              aria-label={`Tool response JSON for ${tc.function.name}`}
                              className="flex-1 bg-[#09090B] border border-[#222227] rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                            />
                            <button
                              type="button"
                              disabled={running}
                              onClick={() =>
                                handleSubmitToolOutput(tc.id, tc.function.name)
                              }
                              className="px-3 py-1.5 text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-lg whitespace-nowrap disabled:opacity-50"
                            >
                              Send {tc.function.name} output
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.meta && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#71717A] tabular-nums">
                          <div className="flex flex-wrap items-center gap-x-1.5">
                            <span className="text-[#A1A1AA]">
                              {msg.meta.resolvedProvider}/{msg.meta.resolvedModel}
                            </span>
                            <span>·</span>
                            <span>{msg.meta.latencyMs}ms</span>
                            <span>·</span>
                            <span>
                              {msg.meta.promptTokens + msg.meta.completionTokens}{" "}
                              tok
                            </span>
                            <span>·</span>
                            <span>${msg.meta.estimatedCostUsd.toFixed(5)}</span>
                            {msg.meta.cached && (
                              <>
                                <span>·</span>
                                <span className="text-sky-400">Cache hit</span>
                              </>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg)}
                            className="inline-flex items-center gap-1 text-[#71717A] hover:text-white transition-colors"
                            title="Copy response"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        {msg.meta.fallbackAttempts.length > 1 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                            {msg.meta.fallbackAttempts.map((hop, hIdx) => (
                              <span
                                key={`${hop.tierId}-${hIdx}`}
                                title={hop.reason}
                                className={`px-2 py-0.5 rounded border ${
                                  hop.status === "success"
                                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                    : hop.status === "failed"
                                      ? "bg-red-500/10 border-red-500/30 text-red-300"
                                      : "bg-[#111114] border-[#27272A] text-[#A1A1AA]"
                                }`}
                              >
                                #{hIdx + 1} {hop.provider}/{hop.model} ({hop.status}
                                {hop.statusCode ? ` ${hop.statusCode}` : ""})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            )}

            {running && (
              <div className="flex items-start gap-3.5">
                <div className="w-7 h-7 rounded-full bg-[#111114] border border-[#27272A] flex items-center justify-center font-display text-[11px] font-bold text-amber-400 shrink-0">
                  AS
                </div>
                <div className="py-1 text-sm text-[#A1A1AA] animate-pulse">
                  Thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Bottom Floating Composer (ChatGPT / Gemini Style) */}
      <div className="pt-2 max-w-3xl mx-auto w-full">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="bg-[#111114] border border-[#27272A] focus-within:border-[#3F3F46] rounded-2xl p-3 transition-colors"
        >
          {imageDataUrl && (
            <div className="mb-2.5 inline-flex items-center gap-2.5 p-1.5 pr-2.5 bg-[#09090B] border border-[#222227] rounded-xl">
              <img
                src={imageDataUrl}
                alt="Attachment preview"
                className="w-9 h-9 object-cover rounded-lg"
              />
              <span className="text-xs text-[#D4D4D8]">Image attached</span>
              <button
                type="button"
                onClick={() => setImageDataUrl(null)}
                className="text-[#71717A] hover:text-red-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={
              connections.length === 0
                ? "Connect a provider to start chatting"
                : "Message AS ROUTER..."
            }
            disabled={connections.length === 0}
            className="w-full bg-transparent resize-none px-1.5 py-1 text-sm text-white placeholder-[#71717A] focus:outline-none max-h-40 leading-relaxed"
          />

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
                className="p-2 rounded-lg text-[#A1A1AA] hover:text-white hover:bg-[#18181B] transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                title="Options"
                className="p-2 rounded-lg text-[#A1A1AA] hover:text-white hover:bg-[#18181B] transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>

            {running ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop generating"
                className="w-8 h-8 rounded-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 flex items-center justify-center transition-colors shrink-0"
                title="Stop generating"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  connections.length === 0 ||
                  (!inputText.trim() && !imageDataUrl)
                }
                aria-label="Send message"
                className="w-8 h-8 rounded-full bg-amber-400 hover:bg-amber-300 disabled:bg-[#27272A] disabled:text-[#71717A] text-[#09090B] flex items-center justify-center transition-colors shrink-0"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
