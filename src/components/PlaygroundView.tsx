import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Check,
  Copy,
  ImagePlus,
  Pencil,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Square,
  SquarePen,
  X,
} from "lucide-react";
import {
  getConnectionPrefix,
  getProviderSpec,
  isSearchProvider,
} from "../shared/catalog.ts";
import { getProviderVisual } from "../lib/providerVisuals.ts";
import { useFocusTrap } from "../lib/useFocusTrap.ts";
import { ToggleSwitch } from "./ToggleSwitch.tsx";
import type {
  Combo,
  FallbackHop,
  ProviderConnection,
} from "../types/gateway.ts";

interface PlaygroundViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  launchRequest?: {
    model?: string;
    prompt?: string;
    nonce: number;
  } | null;
  onConnectProvider?: () => void;
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

function safeMarkdownHref(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    ) {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokenRe =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\((?:[^)\s]+)\))/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    const key = `inl-${keyCounter++}`;
    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={key}
          className="px-1.5 py-0.5 rounded bg-canvas border border-hairline font-mono text-[12px] text-sky-300"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={key} className="font-semibold text-ink">
          {renderInlineMarkdown(token.slice(2, -2))}
        </strong>
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      parts.push(
        <del key={key} className="line-through text-ink-muted">
          {renderInlineMarkdown(token.slice(2, -2))}
        </del>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(
        <em key={key} className="italic text-ink">
          {renderInlineMarkdown(token.slice(1, -1))}
        </em>
      );
    } else if (token.startsWith("[")) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (m) {
        const href = safeMarkdownHref(m[2]);
        if (href) {
          parts.push(
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
            >
              {m[1]}
            </a>
          );
        } else {
          parts.push(m[1]);
        }
      } else {
        parts.push(token);
      }
    }
    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}

function renderMarkdownBlocks(rawText: string, keyPrefix: string): React.ReactNode {
  const lines = rawText.replace(/^\n+|\n+$/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`${keyPrefix}-hr-${i}`} className="border-hairline my-3" />);
      i += 1;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingClasses =
        level === 1
          ? "text-lg font-bold text-ink mt-3 mb-1"
          : level === 2
            ? "text-base font-semibold text-ink mt-2.5 mb-1"
            : level === 3
              ? "text-sm font-semibold text-ink mt-2 mb-0.5"
              : "text-xs font-semibold uppercase tracking-wide text-indigo-300 mt-2 mb-0.5";
      blocks.push(
        <div key={`${keyPrefix}-h-${i}`} className={`font-display ${headingClasses}`}>
          {renderInlineMarkdown(headingMatch[2])}
        </div>
      );
      i += 1;
      continue;
    }

    // Markdown Table
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])
    ) {
      const parseRow = (rowLine: string) =>
        rowLine
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());

      const headers = parseRow(line);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        bodyRows.push(parseRow(lines[i]));
        i += 1;
      }

      blocks.push(
        <div
          key={`${keyPrefix}-tbl-${i}`}
          className="overflow-x-auto rounded-xl border border-hairline bg-canvas"
        >
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-hairline bg-surface text-ink">
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="px-3 py-2 font-semibold whitespace-nowrap">
                    {renderInlineMarkdown(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-ink-2">
                      {renderInlineMarkdown(row[cIdx] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`${keyPrefix}-bq-${i}`}
          className="border-l-2 border-indigo-400/70 pl-3.5 py-0.5 text-ink-2 italic bg-surface/50 rounded-r-lg"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInlineMarkdown(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul
          key={`${keyPrefix}-ul-${i}`}
          className="list-disc pl-5 space-y-1 text-ink-2"
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ol
          key={`${keyPrefix}-ol-${i}`}
          className="list-decimal pl-5 space-y-1 text-ink-2"
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (collect consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith(">") &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`${keyPrefix}-p-${i}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(paraLines.join("\n"))}
      </p>
    );
  }

  return blocks;
}

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
    <div className="space-y-3 text-sm leading-7 text-ink-2">
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
              className="rounded-xl border border-hairline-strong bg-canvas overflow-hidden"
            >
              <div className="px-3.5 py-1.5 border-b border-hairline flex items-center justify-between text-[11px] font-mono text-ink-muted">
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
                  className="inline-flex items-center gap-1 hover:text-ink transition-colors"
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
              <pre className="p-3.5 text-xs font-mono text-ink overflow-x-auto leading-relaxed">
                {code}
              </pre>
            </div>
          );
        }
        if (!seg || !seg.trim()) return null;
        return (
          <div key={idx} className="space-y-2.5">
            {renderMarkdownBlocks(seg, `seg-${idx}`)}
          </div>
        );
      })}
    </div>
  );
}

export function PlaygroundView({
  combos,
  connections,
  launchRequest,
  onConnectProvider,
  onRefresh,
  onNotify,
}: PlaygroundViewProps) {
  const modelOptions = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    const hasActiveLlm = connections.some(
      (c) => c.isActive && !isSearchProvider(c.provider)
    );
    if (hasActiveLlm) {
      list.push({
        value: "auto",
        label: "Built-in: auto (Smart Intent Router)",
      });
    }
    for (const c of combos) {
      if (c.isActive) {
        list.push({ value: c.name, label: `Combo: ${c.name}` });
      }
    }
    const seen = new Set<string>();
    for (const conn of connections) {
      if (!conn.isActive || isSearchProvider(conn.provider)) continue;
      const spec = getProviderSpec(conn.provider);
      const prefix = getConnectionPrefix(conn);
      const connModels = Array.from(
        new Set([
          ...(conn.defaultModel ? [conn.defaultModel] : []),
          ...(conn.availableModels || []),
        ])
      );
      for (const m of connModels) {
        const key = `${prefix}/${m}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push({
            value: key,
            label: `${conn.name} — ${m}`,
          });
        }
      }
      if (conn.provider !== "custom") {
        for (const m of spec.models) {
          const key = `${prefix}/${m.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            list.push({ value: key, label: `${spec.label} — ${m.id}` });
          }
        }
      }
    }
    return list;
  }, [combos, connections]);

  const activeLlmConnections = useMemo(
    () => connections.filter((c) => c.isActive && !isSearchProvider(c.provider)),
    [connections]
  );

  const [selectedModel, setSelectedModel] = useState(
    launchRequest?.model || modelOptions[0]?.value || ""
  );
  const [customLaunchModel, setCustomLaunchModel] = useState<string | null>(
    launchRequest?.model || null
  );
  const [syncingModels, setSyncingModels] = useState(false);

  const effectiveModelOptions = useMemo(() => {
    if (
      customLaunchModel &&
      !modelOptions.some((opt) => opt.value === customLaunchModel)
    ) {
      return [
        { value: customLaunchModel, label: `Target: ${customLaunchModel}` },
        ...modelOptions,
      ];
    }
    return modelOptions;
  }, [modelOptions, customLaunchModel]);

  const hasActiveLlmOptions =
    effectiveModelOptions.length > 0 && activeLlmConnections.length > 0;

  useEffect(() => {
    if (effectiveModelOptions.length === 0) {
      if (selectedModel !== "") {
        setSelectedModel("");
      }
      return;
    }
    if (!effectiveModelOptions.some((opt) => opt.value === selectedModel)) {
      setSelectedModel(effectiveModelOptions[0].value);
    }
  }, [effectiveModelOptions, selectedModel]);

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
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraftText, setEditDraftText] = useState("");
  const [toolReplyDrafts, setToolReplyDrafts] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsDialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(settingsDialogRef, showSettings);

  useEffect(() => {
    if (!launchRequest) return;
    if (launchRequest.model) {
      setCustomLaunchModel(launchRequest.model);
      setSelectedModel(launchRequest.model);
    }
    if (launchRequest.prompt) {
      setInputText(launchRequest.prompt);
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [launchRequest?.nonce]);

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
    if (activeLlmConnections.length === 0) {
      onNotify("No active provider connections to sync.", "error");
      return;
    }
    setSyncingModels(true);
    let syncedCount = 0;
    let totalModels = 0;
    try {
      for (const conn of activeLlmConnections) {
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
    if (!hasActiveLlmOptions || !selectedModel) {
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

  const parseActiveTools = (): unknown | undefined => {
    if (!enableTools) return undefined;
    try {
      const parsed = JSON.parse(toolsJson);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      onNotify("Tools JSON is invalid — ignoring tools for this request.", "error");
      return undefined;
    }
  };

  const handleRegenerate = async (assistantMsgIndex: number) => {
    if (running || !selectedModel) return;
    const prefixHistory = messages.slice(0, assistantMsgIndex);
    if (prefixHistory.length === 0) return;
    const parsedTools = parseActiveTools();
    setMessages(prefixHistory);
    await executeTurn(prefixHistory, parsedTools);
  };

  const handleResendEditedUser = async (msgIndex: number) => {
    if (running || !selectedModel) return;
    const trimmed = editDraftText.trim();
    const target = messages[msgIndex];
    if (!target || (!trimmed && !target.imageDataUrl)) return;
    const updatedUser: ChatMessage = { ...target, content: trimmed };
    const nextHistory = [...messages.slice(0, msgIndex), updatedUser];
    setEditingMsgId(null);
    setEditDraftText("");
    const parsedTools = parseActiveTools();
    setMessages(nextHistory);
    await executeTurn(nextHistory, parsedTools);
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setEditingMsgId(null);
    setEditDraftText("");
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
            value={hasActiveLlmOptions ? selectedModel : ""}
            disabled={!hasActiveLlmOptions}
            onChange={(e) => setSelectedModel(e.target.value)}
            aria-label="Select model or combo"
            className="flex-1 min-w-0 sm:flex-none sm:max-w-[360px] truncate bg-surface hover:bg-elevated disabled:opacity-75 disabled:cursor-not-allowed border border-hairline rounded-xl px-3 py-1.5 text-xs font-mono text-ink focus:outline-none focus:border-indigo-500 transition-colors"
          >
            {!hasActiveLlmOptions ? (
              <option value="">No active providers configured</option>
            ) : (
              effectiveModelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )}
          </select>

          <div className="flex items-center gap-1.5 shrink-0">
            {freeOnly && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-medium text-emerald-300 whitespace-nowrap">
                Free
              </span>
            )}
            {useCache && (
              <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-[10px] font-medium text-sky-300 whitespace-nowrap hidden sm:inline">
                Cached
              </span>
            )}
            {enableTools && (
              <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-medium text-indigo-300 whitespace-nowrap">
                Tools
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors whitespace-nowrap ${
              showSettings
                ? "bg-elevated border-hairline-strong text-ink"
                : "bg-surface hover:bg-elevated border-hairline text-ink-2 hover:text-ink"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Options</span>
          </button>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-elevated border border-hairline rounded-xl text-ink-2 hover:text-ink transition-colors whitespace-nowrap"
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
                ref={settingsDialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Chat options"
                tabIndex={-1}
                initial={{ opacity: 0, scale: 0.95, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute right-0 top-11 z-30 w-[min(calc(100vw-2rem),24rem)] max-h-[75dvh] overflow-y-auto bg-surface border border-hairline-strong rounded-2xl shadow-2xl p-4 space-y-4 origin-top-right outline-none"
              >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">
                  Chat Options
                </span>
                <button
                  type="button"
                  aria-label="Close chat options"
                  onClick={() => setShowSettings(false)}
                  className="text-ink-muted hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <label
                  htmlFor="pg-system-prompt"
                  className="block text-xs font-medium text-ink-2 mb-1.5"
                >
                  System Instruction
                </label>
                <textarea
                  id="pg-system-prompt"
                  rows={2}
                  placeholder="Optional system instruction for the assistant..."
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  className="w-full bg-canvas border border-hairline rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between text-xs text-ink-2 mb-1">
                    <span>Temperature</span>
                    <span className="font-mono text-indigo-400">
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
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    min={64}
                    max={32768}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                    className="w-full bg-canvas border border-hairline rounded-lg px-2.5 py-1 text-xs font-mono text-ink focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="divide-y divide-hairline border-y border-hairline py-1">
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
                      className="w-full bg-canvas border border-hairline rounded-xl px-3 py-2 text-[11px] font-mono text-ink-2 focus:outline-none focus:border-indigo-500"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
                {activeLlmConnections.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSyncAllModels(true)}
                      disabled={syncingModels}
                      className="hover:text-ink transition-colors"
                    >
                      Sync free
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => handleSyncAllModels(false)}
                      disabled={syncingModels}
                      className="inline-flex items-center gap-1 hover:text-ink transition-colors"
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
                  className="hover:text-ink transition-colors"
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
            <motion.img
              src="/assets/as-logo.svg"
              alt="AS ROUTER"
              animate={{ scale: [1, 1.045, 1] }}
              transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
              className="h-8 w-auto object-contain mb-3 drop-shadow-[0_0_16px_rgba(129,140,248,0.35)]"
            />
            <h2 className="font-display text-xl sm:text-2xl font-semibold text-ink tracking-tight">
              {!hasActiveLlmOptions
                ? "Connect a provider to start chatting"
                : "What would you like to ask?"}
            </h2>
            {!hasActiveLlmOptions && onConnectProvider && (
              <button
                type="button"
                onClick={onConnectProvider}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl transition-colors"
              >
                Connect Provider
              </button>
            )}
            {hasActiveLlmOptions && selectedModel && (
              <p className="mt-1.5 text-xs text-ink-muted font-mono">
                {selectedModel}
              </p>
            )}

            {hasActiveLlmOptions && (
              <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-w-2xl w-full text-left">
                {STARTER_PROMPTS.map((starter, idx) => {
                  const starterAccents = [
                    "hover:border-sky-400/50",
                    "hover:border-purple-400/50",
                    "hover:border-emerald-400/50",
                  ];
                  return (
                    <motion.button
                      key={starter}
                      type="button"
                      whileHover={{ y: -2 }}
                      onClick={() => sendMessage(starter)}
                      className={`p-3.5 rounded-xl bg-surface hover:bg-elevated border border-hairline ${starterAccents[idx % starterAccents.length]} text-xs text-ink-2 hover:text-ink transition-colors leading-relaxed`}
                    >
                      {starter}
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto w-full pb-2">
            {messages.map((msg, msgIdx) =>
              msg.role === "user" ? (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-end group"
                >
                  <div className="max-w-[85%] bg-elevated border border-hairline-strong rounded-2xl px-4 py-3 text-sm text-ink space-y-2.5">
                    {msg.imageDataUrl && (
                      <img
                        src={msg.imageDataUrl}
                        alt="Uploaded prompt attachment"
                        className="max-h-48 rounded-lg border border-hairline-strong object-contain"
                      />
                    )}
                    {editingMsgId === msg.id ? (
                      <div className="space-y-2 min-w-[240px] sm:min-w-[340px]">
                        <textarea
                          rows={3}
                          value={editDraftText}
                          onChange={(e) => setEditDraftText(e.target.value)}
                          className="w-full bg-canvas border border-hairline-strong rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:border-indigo-400"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMsgId(null);
                              setEditDraftText("");
                            }}
                            className="px-2.5 py-1 text-xs text-ink-muted hover:text-ink bg-canvas border border-hairline rounded-lg"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={running}
                            onClick={() => handleResendEditedUser(msgIdx)}
                            className="px-2.5 py-1 text-xs font-semibold bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg"
                          >
                            Save & Resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      msg.content && (
                        <div className="whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </div>
                      )
                    )}
                  </div>
                  {editingMsgId !== msg.id && (
                    <div className="mt-1 flex items-center gap-2 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity pr-1">
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(msg)}
                        aria-label="Copy message"
                        title="Copy"
                        className="text-ink-muted hover:text-ink p-1"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={running}
                        onClick={() => {
                          setEditingMsgId(msg.id);
                          setEditDraftText(msg.content);
                        }}
                        aria-label="Edit and resend"
                        title="Edit & resend"
                        className="text-ink-muted hover:text-ink p-1 disabled:opacity-40"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : msg.role === "tool" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[82%] bg-canvas border border-emerald-500/30 rounded-xl px-3.5 py-2 text-xs font-mono text-emerald-300 space-y-1">
                    <div className="text-[11px] text-emerald-400">
                      tool output ({msg.toolName || msg.toolCallId})
                    </div>
                    <div className="whitespace-pre-wrap break-all text-ink-2">
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
                  className="flex items-start gap-3"
                >
                  <div
                    className={`w-6 h-6 flex items-center justify-center shrink-0 mt-0.5 ${
                      msg.isError ? "opacity-75 grayscale contrast-125" : ""
                    }`}
                  >
                    <img
                      src="/assets/as-logo.svg"
                      alt="AS ROUTER"
                      className="w-5 h-auto object-contain drop-shadow-[0_0_6px_rgba(129,140,248,0.26)]"
                    />
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
                      <div className="bg-surface border border-hairline rounded-xl p-3.5 space-y-3">
                        <div className="text-xs font-medium text-emerald-400">
                          Tool Calls ({msg.toolCalls.length})
                        </div>
                        <pre className="font-mono text-xs text-ink-2 overflow-x-auto">
                          {JSON.stringify(msg.toolCalls, null, 2)}
                        </pre>
                        {msg.toolCalls.map((tc) => (
                          <div
                            key={tc.id}
                            className="pt-2 border-t border-hairline flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
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
                              className="flex-1 bg-canvas border border-hairline rounded-lg px-2.5 py-1.5 text-xs font-mono text-ink focus:outline-none focus:border-indigo-500"
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

                    {(msg.meta || (!running && (msg.content || msg.isError))) && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-ink-dim tabular-nums">
                          <div className="flex flex-wrap items-center gap-x-1.5">
                            {msg.meta ? (
                              <>
                                <span>
                                  <span
                                    className="font-semibold"
                                    style={{
                                      color: getProviderVisual(
                                        msg.meta.resolvedProvider
                                      ).color,
                                    }}
                                  >
                                    {msg.meta.resolvedProvider}
                                  </span>
                                  <span className="text-ink-muted">
                                    /{msg.meta.resolvedModel}
                                  </span>
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
                              </>
                            ) : (
                              <span className="text-ink-dim">
                                {msg.isError ? "Request failed" : "Streamed response"}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              disabled={running}
                              onClick={() => handleRegenerate(msgIdx)}
                              className="inline-flex items-center gap-1 text-ink-dim hover:text-ink transition-colors disabled:opacity-40"
                              title="Regenerate response"
                              aria-label="Regenerate response"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline font-sans">
                                Regenerate
                              </span>
                            </button>
                            {msg.content && (
                              <button
                                type="button"
                                onClick={() => handleCopyMessage(msg)}
                                className="inline-flex items-center gap-1 text-ink-dim hover:text-ink transition-colors"
                                title="Copy response"
                                aria-label="Copy response"
                              >
                                {copiedId === msg.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>

                        {msg.meta && msg.meta.fallbackAttempts.length > 1 && (
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
                                      : "bg-surface border-hairline-strong text-ink-muted"
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
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
                  <img
                    src="/assets/as-logo.svg"
                    alt="AS ROUTER"
                    className="w-5 h-auto object-contain animate-pulse drop-shadow-[0_0_8px_rgba(56,189,248,0.34)]"
                  />
                </div>
                <div className="py-1 text-sm text-ink-muted animate-pulse">
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
          className="bg-surface border border-hairline-strong focus-within:border-hairline-strong rounded-2xl p-3 transition-colors"
        >
          {imageDataUrl && (
            <div className="mb-2.5 inline-flex items-center gap-2.5 p-1.5 pr-2.5 bg-canvas border border-hairline rounded-xl">
              <img
                src={imageDataUrl}
                alt="Attachment preview"
                className="w-9 h-9 object-cover rounded-lg"
              />
              <span className="text-xs text-ink-2">Image attached</span>
              <button
                type="button"
                onClick={() => setImageDataUrl(null)}
                className="text-ink-dim hover:text-red-400"
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
              !hasActiveLlmOptions
                ? "Connect a provider to start chatting"
                : "Message AS ROUTER..."
            }
            disabled={!hasActiveLlmOptions}
            className="w-full bg-transparent resize-none px-1.5 py-1 text-sm text-ink placeholder:text-ink-dim focus:outline-none max-h-40 leading-relaxed"
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
                disabled={!hasActiveLlmOptions}
                onClick={() => fileInputRef.current?.click()}
                title="Attach image"
                className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                title="Options"
                className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-elevated transition-colors"
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
                  !hasActiveLlmOptions ||
                  (!inputText.trim() && !imageDataUrl)
                }
                aria-label="Send message"
                className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 via-sky-500 to-cyan-400 hover:brightness-110 disabled:bg-none disabled:bg-subtle disabled:text-ink-dim text-white flex items-center justify-center transition-all shrink-0 shadow-[0_0_16px_rgba(99,102,241,0.35)] disabled:shadow-none"
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
