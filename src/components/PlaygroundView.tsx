import React, { useMemo, useRef, useState } from "react";
import { ImagePlus, Send, Wrench, X } from "lucide-react";
import { getProviderSpec } from "../shared/catalog.ts";
import type {
  Combo,
  FallbackHop,
  ProviderConnection,
} from "../types/gateway.ts";

interface PlaygroundViewProps {
  combos: Combo[];
  connections: ProviderConnection[];
  onNotify: (msg: string, tone?: "success" | "error") => void;
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

export function PlaygroundView({
  combos,
  connections,
  onNotify,
}: PlaygroundViewProps) {
  const modelOptions = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [];
    for (const c of combos) {
      if (c.isActive) {
        list.push({ value: c.name, label: `Combo: ${c.name} (${c.strategy})` });
      }
    }
    const seen = new Set<string>();
    for (const conn of connections) {
      if (!conn.isActive) continue;
      const spec = getProviderSpec(conn.provider);
      if (conn.defaultModel) {
        const customKey = `${conn.provider}/${conn.defaultModel}`;
        if (!seen.has(customKey)) {
          seen.add(customKey);
          list.push({
            value: customKey,
            label: `${conn.name} — ${conn.defaultModel}`,
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
    modelOptions[0]?.value || "gemini/gemini-2.5-flash"
  );
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a concise, accurate technical assistant."
  );
  const [userPrompt, setUserPrompt] = useState(
    "Explain how multi-provider fallback routing improves LLM reliability in 3 bullet points."
  );
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [enableTools, setEnableTools] = useState(false);
  const [toolsJson, setToolsJson] = useState(DEFAULT_TOOLS_JSON);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<{
    content: string;
    toolCalls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    resolvedProvider: string;
    resolvedModel: string;
    detectedIntent?: string;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
    latencyMs: number;
    fallbackAttempts: FallbackHop[];
  } | null>(null);

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

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userPrompt.trim() && !imageDataUrl) return;

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

    setRunning(true);
    setResponse(null);

    try {
      const userContent = imageDataUrl
        ? [
            ...(userPrompt.trim()
              ? [{ type: "text", text: userPrompt.trim() }]
              : []),
            { type: "image_url", image_url: { url: imageDataUrl } },
          ]
        : userPrompt.trim();

      const messages = [
        ...(systemPrompt.trim()
          ? [{ role: "system", content: systemPrompt.trim() }]
          : []),
        { role: "user", content: userContent },
      ];

      const res = await fetch("/api/playground/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          messages,
          tools: parsedTools,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onNotify(data.error || "Playground request failed", "error");
        return;
      }
      setResponse(data);
    } catch {
      onNotify("Network error executing playground request", "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="font-display text-lg font-semibold text-white">
        Playground
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <form
          onSubmit={handleSend}
          className="lg:col-span-5 bg-[#111114] border border-[#222227] rounded-lg p-5 space-y-4 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                Target Combo or Direct Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
              >
                {modelOptions.length === 0 ? (
                  <option value="gemini/gemini-2.5-flash">
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
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                System Instruction
              </label>
              <textarea
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                User Prompt
              </label>
              <textarea
                rows={4}
                required={!imageDataUrl}
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-xs text-white placeholder-[#6B7280] focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Multimodal Image & Tool Calling Controls */}
            <div className="flex flex-wrap items-center gap-2">
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
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#09090B] border border-[#222227] rounded-md text-[#D4D4D8] hover:text-white whitespace-nowrap"
              >
                <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
                <span>{imageDataUrl ? "Replace Image" : "Attach Image"}</span>
              </button>

              <button
                type="button"
                onClick={() => setEnableTools((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-md whitespace-nowrap transition-colors ${
                  enableTools
                    ? "bg-[#18181B] border-amber-400/50 text-white"
                    : "bg-[#09090B] border-[#222227] text-[#D4D4D8] hover:text-white"
                }`}
              >
                <Wrench className="w-3.5 h-3.5 text-amber-400" />
                <span>{enableTools ? "Tools Enabled" : "Add Tools JSON"}</span>
              </button>
            </div>

            {imageDataUrl && (
              <div className="flex items-center justify-between gap-3 p-2.5 bg-[#09090B] border border-[#222227] rounded-lg">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={imageDataUrl}
                    alt="Multimodal upload preview"
                    className="w-10 h-10 object-cover rounded border border-[#222227]"
                  />
                  <span className="text-xs text-[#D4D4D8] truncate">
                    Multimodal image attached
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setImageDataUrl(null)}
                  className="text-[#A1A1AA] hover:text-red-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {enableTools && (
              <div>
                <label className="block text-xs font-medium text-[#D4D4D8] mb-1.5">
                  OpenAI Tools JSON Array
                </label>
                <textarea
                  rows={5}
                  value={toolsJson}
                  onChange={(e) => setToolsJson(e.target.value)}
                  className="w-full bg-[#09090B] border border-[#222227] rounded-lg px-3 py-2 text-[11px] font-mono text-[#E5E7EB] focus:outline-none focus:border-amber-400"
                />
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={running || connections.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-[#09090B] rounded-lg transition-colors whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{running ? "Routing Request..." : "Send Through Gateway"}</span>
          </button>
        </form>

        <div className="lg:col-span-7 bg-[#111114] border border-[#222227] rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-[#222227]">
              <h3 className="text-sm font-medium text-white">
                Gateway Output & Resolution Telemetry
              </h3>
              {response && (
                <div className="font-mono text-xs text-[#A1A1AA] tabular-nums">
                  <span className="text-emerald-400">
                    {response.resolvedProvider}/{response.resolvedModel}
                  </span>
                  {response.detectedIntent && (
                    <>
                      <span className="mx-1.5">·</span>
                      <span>intent:{response.detectedIntent}</span>
                    </>
                  )}
                  <span className="mx-1.5">·</span>
                  <span>{response.latencyMs}ms</span>
                </div>
              )}
            </div>

            {!response && !running && (
              <div className="py-16 text-center text-xs text-[#71717A]">
                {connections.length === 0 ? "No active providers" : "Ready"}
              </div>
            )}

            {running && (
              <div className="py-16 text-center text-xs text-[#A1A1AA]">
                Executing request through AS ROUTER engine...
              </div>
            )}

            {response && (
              <div className="mt-4 space-y-4">
                {response.content && (
                  <div className="bg-[#09090B] border border-[#222227] rounded-lg p-4 text-sm text-[#E5E7EB] whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                    {response.content}
                  </div>
                )}

                {response.toolCalls && response.toolCalls.length > 0 && (
                  <div className="bg-[#09090B] border border-[#222227] rounded-lg p-4 space-y-2">
                    <div className="text-xs font-medium text-emerald-400">
                      Translated Tool Calls ({response.toolCalls.length})
                    </div>
                    <pre className="font-mono text-xs text-[#E5E7EB] overflow-x-auto">
                      {JSON.stringify(response.toolCalls, null, 2)}
                    </pre>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#A1A1AA] tabular-nums pt-2 border-t border-[#222227]">
                  <span>
                    Tokens: {response.promptTokens} in /{" "}
                    {response.completionTokens} out
                  </span>
                  <span>
                    Est. Cost: ${response.estimatedCostUsd.toFixed(6)} ·{" "}
                    {response.fallbackAttempts.length} hop(s)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
