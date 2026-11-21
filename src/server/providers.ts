import crypto from "node:crypto";
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/genai";
import {
  estimateModelCostUsd,
  getProviderSpec,
  isModelKnownFree,
} from "../shared/catalog.ts";
import type { ModelHealthEntry } from "../types/gateway.ts";
import { validateOutboundUrl } from "./urlSafety.ts";

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface NormalizedCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: OpenAIToolDefinition[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
}

export interface StreamDeltaPayload {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface UpstreamExecutionResult {
  content: string;
  toolCalls?: OpenAIToolCall[];
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  finishReason: string;
}

export class UpstreamHttpError extends Error {
  statusCode: number;
  retryable: boolean;

  constructor(message: string, statusCode: number, retryable = false) {
    super(message);
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export function extractTextContent(
  content: OpenAIChatMessage["content"]
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function hasImageParts(messages: OpenAIChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p?.type === "image_url" && Boolean(p.image_url?.url))
  );
}

function approximateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function parseDataUrl(url: string): { mimeType: string; data: string } | null {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function resolveImageToInlineData(
  url: string
): Promise<{ mimeType: string; data: string }> {
  const parsed = parseDataUrl(url);
  if (parsed) return parsed;

  let parsedUrl: URL;
  try {
    parsedUrl = validateOutboundUrl(url, "image URL");
  } catch (err) {
    throw new UpstreamHttpError(
      err instanceof Error ? err.message : "Invalid image URL.",
      400,
      false
    );
  }

  const res = await fetch(parsedUrl.toString(), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new UpstreamHttpError(
      `Failed to fetch multimodal image URL (${res.status})`,
      400,
      false
    );
  }
  const contentType = res.headers.get("content-type") || "image/png";
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
    throw new UpstreamHttpError("Image exceeds 10MB limit.", 400, false);
  }
  return {
    mimeType: contentType.split(";")[0].trim(),
    data: Buffer.from(arrayBuffer).toString("base64"),
  };
}

async function buildGeminiPayload(request: NormalizedCompletionRequest): Promise<{
  systemInstruction?: string;
  contents: Content[];
  tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
  toolConfig?: {
    functionCallingConfig: {
      mode: FunctionCallingConfigMode;
      allowedFunctionNames?: string[];
    };
  };
}> {
  const systemParts: string[] = [];
  const contents: Content[] = [];
  const toolCallIdToName = new Map<string, string>();

  for (const msg of request.messages) {
    if (msg.role === "system") {
      const txt = extractTextContent(msg.content);
      if (txt) systemParts.push(txt);
      continue;
    }

    if (msg.role === "assistant") {
      const parts: Part[] = [];
      const txt = extractTextContent(msg.content);
      if (txt) parts.push({ text: txt });

      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolCallIdToName.set(tc.id, tc.function.name);
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || "{}");
          } catch {
            parsedArgs = {};
          }
          parts.push({
            functionCall: {
              id: tc.id,
              name: tc.function.name,
              args: parsedArgs,
            },
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    if (msg.role === "tool") {
      const fnName =
        msg.name ||
        (msg.tool_call_id ? toolCallIdToName.get(msg.tool_call_id) : undefined) ||
        "tool_result";
      const rawText = extractTextContent(msg.content);
      let parsedResp: Record<string, unknown>;
      try {
        const candidate = JSON.parse(rawText);
        parsedResp =
          candidate && typeof candidate === "object" && !Array.isArray(candidate)
            ? candidate
            : { result: candidate };
      } catch {
        parsedResp = { result: rawText };
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              id: msg.tool_call_id,
              name: fnName,
              response: parsedResp,
            },
          },
        ],
      });
      continue;
    }

    // User message (text or multimodal array)
    const parts: Part[] = [];
    if (typeof msg.content === "string") {
      if (msg.content) parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) {
          parts.push({ text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const inlineData = await resolveImageToInlineData(part.image_url.url);
          parts.push({ inlineData });
        }
      }
    }
    if (parts.length > 0) {
      contents.push({ role: "user", parts });
    }
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  let tools: Array<{ functionDeclarations: FunctionDeclaration[] }> | undefined;
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    const declarations: FunctionDeclaration[] = request.tools
      .filter((t) => t.type === "function" && t.function?.name)
      .map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parametersJsonSchema: t.function.parameters || {
          type: "object",
          properties: {},
        },
      }));
    if (declarations.length > 0) {
      tools = [{ functionDeclarations: declarations }];
    }
  }

  let toolConfig:
    | {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode;
          allowedFunctionNames?: string[];
        };
      }
    | undefined;

  if (request.tool_choice && tools) {
    if (request.tool_choice === "none") {
      toolConfig = {
        functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
      };
    } else if (request.tool_choice === "required") {
      toolConfig = {
        functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
      };
    } else if (request.tool_choice === "auto") {
      toolConfig = {
        functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
      };
    } else if (
      typeof request.tool_choice === "object" &&
      request.tool_choice.type === "function"
    ) {
      toolConfig = {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: [request.tool_choice.function.name],
        },
      };
    }
  }

  return {
    systemInstruction:
      systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    contents,
    tools,
    toolConfig,
  };
}

export async function invokeUpstreamCompletion(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  request: NormalizedCompletionRequest;
  onStreamDelta?: (delta: StreamDeltaPayload) => void;
}): Promise<UpstreamExecutionResult> {
  const {
    provider,
    model,
    apiKey,
    baseUrl,
    timeoutMs,
    signal,
    request,
    onStreamDelta,
  } = params;

  if (!apiKey) {
    throw new UpstreamHttpError(
      `Missing API key for provider "${provider}"`,
      401,
      true
    );
  }

  if (signal?.aborted) {
    throw new UpstreamHttpError("Request aborted by client.", 499, false);
  }

  if (provider === "gemini") {
    return invokeGemini({
      model,
      apiKey,
      timeoutMs,
      signal,
      request,
      onStreamDelta,
    });
  }

  if (provider === "anthropic") {
    return invokeAnthropic({
      model,
      apiKey,
      baseUrl,
      timeoutMs,
      signal,
      request,
      onStreamDelta,
    });
  }

  return invokeOpenAICompatible({
    provider,
    model,
    apiKey,
    baseUrl,
    timeoutMs,
    signal,
    request,
    onStreamDelta,
  });
}

async function withInitialTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new UpstreamHttpError(
              `${label} timed out after ${timeoutMs}ms`,
              504,
              true
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function invokeGemini(params: {
  model: string;
  apiKey: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  request: NormalizedCompletionRequest;
  onStreamDelta?: (delta: StreamDeltaPayload) => void;
}): Promise<UpstreamExecutionResult> {
  const {
    model,
    apiKey,
    timeoutMs = 25000,
    signal,
    request,
    onStreamDelta,
  } = params;
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: timeoutMs,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const { systemInstruction, contents, tools, toolConfig } =
    await buildGeminiPayload(request);

  const config: Record<string, unknown> = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (typeof request.max_tokens === "number" && request.max_tokens > 0) {
    config.maxOutputTokens = request.max_tokens;
  }
  if (tools) config.tools = tools;
  if (toolConfig) config.toolConfig = toolConfig;
  if (signal) config.abortSignal = signal;

  try {
    if (request.stream && onStreamDelta) {
      const stream = await withInitialTimeout(
        ai.models.generateContentStream({
          model,
          contents,
          config: Object.keys(config).length > 0 ? config : undefined,
        }),
        timeoutMs,
        `Gemini (${model})`
      );

      let fullText = "";
      let promptTokens = 0;
      let completionTokens = 0;
      const collectedToolCalls: OpenAIToolCall[] = [];

      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const chunkText = chunk.text ?? "";
        if (chunkText) {
          fullText += chunkText;
          onStreamDelta({ content: chunkText });
        }

        if (Array.isArray(chunk.functionCalls) && chunk.functionCalls.length > 0) {
          for (const fc of chunk.functionCalls) {
            const idx = collectedToolCalls.length;
            const callId =
              fc.id || `call_${crypto.randomBytes(6).toString("hex")}`;
            const argsJson = JSON.stringify(fc.args || {});
            const tc: OpenAIToolCall = {
              id: callId,
              type: "function",
              function: {
                name: fc.name || "function",
                arguments: argsJson,
              },
            };
            collectedToolCalls.push(tc);
            onStreamDelta({
              tool_calls: [
                {
                  index: idx,
                  id: callId,
                  type: "function",
                  function: { name: tc.function.name, arguments: argsJson },
                },
              ],
            });
          }
        }

        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
          completionTokens =
            chunk.usageMetadata.candidatesTokenCount ?? completionTokens;
        }
      }

      if (!promptTokens) {
        promptTokens = approximateTokens(
          request.messages.map((m) => extractTextContent(m.content)).join(" ")
        );
      }
      if (!completionTokens) {
        completionTokens = approximateTokens(
          fullText + JSON.stringify(collectedToolCalls)
        );
      }

      return {
        content: fullText,
        toolCalls:
          collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
        promptTokens,
        completionTokens,
        estimatedCostUsd: estimateModelCostUsd(
          "gemini",
          model,
          promptTokens,
          completionTokens
        ),
        finishReason: collectedToolCalls.length > 0 ? "tool_calls" : "stop",
      };
    }

    const response = await withInitialTimeout(
      ai.models.generateContent({
        model,
        contents,
        config: Object.keys(config).length > 0 ? config : undefined,
      }),
      timeoutMs,
      `Gemini (${model})`
    );

    const text = response.text ?? "";
    const toolCalls: OpenAIToolCall[] = (response.functionCalls || []).map(
      (fc) => ({
        id: fc.id || `call_${crypto.randomBytes(6).toString("hex")}`,
        type: "function",
        function: {
          name: fc.name || "function",
          arguments: JSON.stringify(fc.args || {}),
        },
      })
    );

    const promptTokens =
      response.usageMetadata?.promptTokenCount ??
      approximateTokens(
        request.messages.map((m) => extractTextContent(m.content)).join(" ")
      );
    const completionTokens =
      response.usageMetadata?.candidatesTokenCount ??
      approximateTokens(text + JSON.stringify(toolCalls));

    return {
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimateModelCostUsd(
        "gemini",
        model,
        promptTokens,
        completionTokens
      ),
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    };
  } catch (err: unknown) {
    if (err instanceof UpstreamHttpError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const statusMatch = message.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
    const statusCode = statusMatch ? Number(statusMatch[1]) : 502;
    const retryable =
      statusCode === 429 ||
      statusCode >= 500 ||
      statusCode === 401 ||
      statusCode === 403 ||
      statusCode === 404;
    throw new UpstreamHttpError(message, statusCode, retryable);
  }
}

async function invokeAnthropic(params: {
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  request: NormalizedCompletionRequest;
  onStreamDelta?: (delta: StreamDeltaPayload) => void;
}): Promise<UpstreamExecutionResult> {
  const {
    model,
    apiKey,
    baseUrl,
    timeoutMs = 25000,
    signal,
    request,
    onStreamDelta,
  } = params;
  const rawEndpoint = `${(baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "")}/messages`;
  let endpoint: string;
  try {
    endpoint = validateOutboundUrl(rawEndpoint, "provider base URL").toString();
  } catch (err) {
    throw new UpstreamHttpError(
      err instanceof Error ? err.message : "Invalid provider base URL.",
      400,
      false
    );
  }

  const systemParts: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const m of request.messages) {
    if (m.role === "system") {
      const txt = extractTextContent(m.content);
      if (txt) systemParts.push(txt);
      continue;
    }

    if (m.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id || "tool_call",
            content: extractTextContent(m.content),
          },
        ],
      });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: Array<Record<string, unknown>> = [];
      const txt = extractTextContent(m.content);
      if (txt) blocks.push({ type: "text", text: txt });
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments || "{}");
          } catch {
            input = {};
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      if (blocks.length > 0) {
        messages.push({ role: "assistant", content: blocks });
      }
      continue;
    }

    // User message (string or multimodal array)
    if (typeof m.content === "string") {
      if (m.content) {
        messages.push({ role: "user", content: m.content });
      }
    } else if (Array.isArray(m.content)) {
      const blocks: Array<Record<string, unknown>> = [];
      for (const part of m.content) {
        if (part.type === "text" && part.text) {
          blocks.push({ type: "text", text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const parsed = parseDataUrl(part.image_url.url);
          if (parsed) {
            blocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: parsed.mimeType,
                data: parsed.data,
              },
            });
          } else {
            let safeUrl: string;
            try {
              safeUrl = validateOutboundUrl(
                part.image_url.url,
                "image URL"
              ).toString();
            } catch (err) {
              throw new UpstreamHttpError(
                err instanceof Error ? err.message : "Invalid image URL.",
                400,
                false
              );
            }
            blocks.push({
              type: "image",
              source: {
                type: "url",
                url: safeUrl,
              },
            });
          }
        }
      }
      if (blocks.length > 0) {
        messages.push({ role: "user", content: blocks });
      }
    }
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: request.max_tokens || 2048,
    messages:
      messages.length > 0 ? messages : [{ role: "user", content: "Hello" }],
    stream: Boolean(request.stream && onStreamDelta),
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }
  if (typeof request.temperature === "number") {
    body.temperature = request.temperature;
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools
      .filter((t) => t.type === "function")
      .map((t) => ({
        name: t.function.name,
        description: t.function.description || "",
        input_schema: t.function.parameters || {
          type: "object",
          properties: {},
        },
      }));
  }
  if (request.tool_choice && body.tools) {
    if (request.tool_choice === "auto") {
      body.tool_choice = { type: "auto" };
    } else if (request.tool_choice === "required") {
      body.tool_choice = { type: "any" };
    } else if (
      typeof request.tool_choice === "object" &&
      request.tool_choice.type === "function"
    ) {
      body.tool_choice = {
        type: "tool",
        name: request.tool_choice.function.name,
      };
    }
  }

  const connectController = new AbortController();
  const onParentAbort = () =>
    connectController.abort(new Error("Request aborted by client"));
  signal?.addEventListener("abort", onParentAbort, { once: true });
  const connectTimer = setTimeout(() => {
    connectController.abort(
      new Error(`Anthropic upstream timed out after ${timeoutMs}ms`)
    );
  }, timeoutMs);

  let res: globalThis.Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: connectController.signal,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    signal?.removeEventListener("abort", onParentAbort);
    throw new UpstreamHttpError(
      err instanceof Error ? err.message : "Anthropic connection error",
      signal?.aborted ? 499 : 504,
      !signal?.aborted
    );
  }
  clearTimeout(connectTimer);
  signal?.removeEventListener("abort", onParentAbort);

  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamHttpError(
      errText || `Anthropic HTTP ${res.status}`,
      res.status,
      res.status === 429 ||
        res.status >= 500 ||
        res.status === 401 ||
        res.status === 403
    );
  }

  if (request.stream && onStreamDelta && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    const toolMap = new Map<
      number,
      { id: string; name: string; args: string; openAiIdx: number }
    >();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.type === "message_start" && parsed.message?.usage) {
            promptTokens = parsed.message.usage.input_tokens ?? promptTokens;
          } else if (
            parsed.type === "content_block_start" &&
            parsed.content_block?.type === "tool_use"
          ) {
            const openAiIdx = toolMap.size;
            const callId =
              parsed.content_block.id ||
              `call_${crypto.randomBytes(6).toString("hex")}`;
            const name = parsed.content_block.name || "function";
            toolMap.set(parsed.index, {
              id: callId,
              name,
              args: "",
              openAiIdx,
            });
            onStreamDelta({
              tool_calls: [
                {
                  index: openAiIdx,
                  id: callId,
                  type: "function",
                  function: { name, arguments: "" },
                },
              ],
            });
          } else if (
            parsed.type === "content_block_delta" &&
            parsed.delta?.type === "text_delta" &&
            parsed.delta?.text
          ) {
            fullText += parsed.delta.text;
            onStreamDelta({ content: parsed.delta.text });
          } else if (
            parsed.type === "content_block_delta" &&
            parsed.delta?.type === "input_json_delta" &&
            typeof parsed.delta?.partial_json === "string"
          ) {
            const entry = toolMap.get(parsed.index);
            if (entry) {
              entry.args += parsed.delta.partial_json;
              onStreamDelta({
                tool_calls: [
                  {
                    index: entry.openAiIdx,
                    function: { arguments: parsed.delta.partial_json },
                  },
                ],
              });
            }
          } else if (parsed.type === "message_delta" && parsed.usage) {
            completionTokens =
              parsed.usage.output_tokens ?? completionTokens;
          }
        } catch {
          // ignore malformed SSE chunk
        }
      }
    }

    const toolCalls: OpenAIToolCall[] = Array.from(toolMap.values()).map(
      (t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.args || "{}" },
      })
    );

    if (!promptTokens) {
      promptTokens = approximateTokens(
        request.messages.map((m) => extractTextContent(m.content)).join(" ")
      );
    }
    if (!completionTokens) {
      completionTokens = approximateTokens(
        fullText + JSON.stringify(toolCalls)
      );
    }

    return {
      content: fullText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimateModelCostUsd(
        "anthropic",
        model,
        promptTokens,
        completionTokens
      ),
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    };
  }

  const json = (await res.json()) as {
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };

  const blocks = json.content || [];
  const content = blocks
    .filter((b) => b.type === "text" || typeof b.text === "string")
    .map((b) => b.text || "")
    .join("");

  const toolCalls: OpenAIToolCall[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      id: b.id || `call_${crypto.randomBytes(6).toString("hex")}`,
      type: "function",
      function: {
        name: b.name || "function",
        arguments: JSON.stringify(b.input || {}),
      },
    }));

  const promptTokens =
    json.usage?.input_tokens ??
    approximateTokens(
      request.messages.map((m) => extractTextContent(m.content)).join(" ")
    );
  const completionTokens =
    json.usage?.output_tokens ??
    approximateTokens(content + JSON.stringify(toolCalls));

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    promptTokens,
    completionTokens,
    estimatedCostUsd: estimateModelCostUsd(
      "anthropic",
      model,
      promptTokens,
      completionTokens
    ),
    finishReason:
      toolCalls.length > 0
        ? "tool_calls"
        : json.stop_reason === "max_tokens"
          ? "length"
          : "stop",
  };
}

async function invokeOpenAICompatible(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  request: NormalizedCompletionRequest;
  onStreamDelta?: (delta: StreamDeltaPayload) => void;
}): Promise<UpstreamExecutionResult> {
  const {
    provider,
    model,
    apiKey,
    baseUrl,
    timeoutMs = 25000,
    signal,
    request,
    onStreamDelta,
  } = params;
  const spec = getProviderSpec(provider);
  const resolvedBase = (baseUrl || spec.defaultBaseUrl).replace(/\/+$/, "");
  const rawEndpoint = resolvedBase.endsWith("/chat/completions")
    ? resolvedBase
    : `${resolvedBase}/chat/completions`;
  let endpoint: string;
  try {
    endpoint = validateOutboundUrl(rawEndpoint, "provider base URL").toString();
  } catch (err) {
    throw new UpstreamHttpError(
      err instanceof Error ? err.message : "Invalid provider base URL.",
      400,
      false
    );
  }

  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
    stream: Boolean(request.stream && onStreamDelta),
  };
  if (typeof request.temperature === "number") {
    body.temperature = request.temperature;
  }
  if (typeof request.max_tokens === "number") {
    body.max_tokens = request.max_tokens;
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools;
  }
  if (request.tool_choice !== undefined) {
    body.tool_choice = request.tool_choice;
  }
  if (body.stream) {
    body.stream_options = { include_usage: true };
  }

  const connectController = new AbortController();
  const onParentAbort = () =>
    connectController.abort(new Error("Request aborted by client"));
  signal?.addEventListener("abort", onParentAbort, { once: true });
  const connectTimer = setTimeout(() => {
    connectController.abort(
      new Error(`${spec.label} timed out after ${timeoutMs}ms`)
    );
  }, timeoutMs);

  let res: globalThis.Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: connectController.signal,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    signal?.removeEventListener("abort", onParentAbort);
    throw new UpstreamHttpError(
      err instanceof Error ? err.message : `${spec.label} connection error`,
      signal?.aborted ? 499 : 504,
      !signal?.aborted
    );
  }
  clearTimeout(connectTimer);
  signal?.removeEventListener("abort", onParentAbort);

  if (!res.ok) {
    const errText = await res.text();
    throw new UpstreamHttpError(
      errText || `${spec.label} HTTP ${res.status}`,
      res.status,
      res.status === 429 ||
        res.status >= 500 ||
        res.status === 401 ||
        res.status === 403
    );
  }

  if (request.stream && onStreamDelta && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason = "stop";
    const toolAcc = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(dataStr);
          const deltaObj = parsed.choices?.[0]?.delta;
          if (deltaObj) {
            const payload: StreamDeltaPayload = {};
            if (
              typeof deltaObj.content === "string" &&
              deltaObj.content.length > 0
            ) {
              fullText += deltaObj.content;
              payload.content = deltaObj.content;
            }
            if (Array.isArray(deltaObj.tool_calls)) {
              payload.tool_calls = deltaObj.tool_calls;
              for (const tc of deltaObj.tool_calls) {
                const idx = typeof tc.index === "number" ? tc.index : 0;
                const existing = toolAcc.get(idx) || {
                  id: tc.id || `call_${idx}`,
                  name: tc.function?.name || "",
                  arguments: "",
                };
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
                toolAcc.set(idx, existing);
              }
            }
            if (payload.content || payload.tool_calls) {
              onStreamDelta(payload);
            }
          }
          if (parsed.choices?.[0]?.finish_reason) {
            finishReason = parsed.choices[0].finish_reason;
          }
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
            completionTokens =
              parsed.usage.completion_tokens ?? completionTokens;
          }
        } catch {
          // ignore partial SSE line
        }
      }
    }

    const toolCalls: OpenAIToolCall[] = Array.from(toolAcc.values()).map(
      (t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.arguments || "{}" },
      })
    );

    if (!promptTokens) {
      promptTokens = approximateTokens(
        request.messages.map((m) => extractTextContent(m.content)).join(" ")
      );
    }
    if (!completionTokens) {
      completionTokens = approximateTokens(
        fullText + JSON.stringify(toolCalls)
      );
    }

    return {
      content: fullText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      promptTokens,
      completionTokens,
      estimatedCostUsd: estimateModelCostUsd(
        provider,
        model,
        promptTokens,
        completionTokens
      ),
      finishReason,
    };
  }

  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: OpenAIToolCall[];
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const msg = json.choices?.[0]?.message;
  const content = msg?.content ?? "";
  const toolCalls =
    Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
      ? msg.tool_calls
      : undefined;
  const promptTokens =
    json.usage?.prompt_tokens ??
    approximateTokens(
      request.messages.map((m) => extractTextContent(m.content)).join(" ")
    );
  const completionTokens =
    json.usage?.completion_tokens ??
    approximateTokens(content + JSON.stringify(toolCalls || []));

  return {
    content,
    toolCalls,
    promptTokens,
    completionTokens,
    estimatedCostUsd: estimateModelCostUsd(
      provider,
      model,
      promptTokens,
      completionTokens
    ),
    finishReason: json.choices?.[0]?.finish_reason || "stop",
  };
}

export async function testProviderConnection(params: {
  provider: string;
  apiKey: string;
  baseUrl?: string | null;
}): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
  const start = Date.now();
  const { provider, apiKey, baseUrl } = params;

  if (!apiKey) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: "No API key available for this connection.",
    };
  }

  try {
    if (provider === "gemini") {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { "User-Agent": "aistudio-build" },
        },
      });
      const res = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: "Reply with OK.",
      });
      return {
        ok: true,
        latencyMs: Date.now() - start,
        detail: `Verified Gemini response (${(res.text ?? "OK").slice(0, 24).trim()})`,
      };
    }

    if (provider === "anthropic") {
      const cleanBase = validateOutboundUrl(
        (baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, ""),
        "provider base URL"
      )
        .toString()
        .replace(/\/+$/, "");
      const res = await fetch(`${cleanBase}/models?limit=1`, {
        method: "GET",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false,
          latencyMs: Date.now() - start,
          detail: `HTTP ${res.status}: ${body.slice(0, 120)}`,
        };
      }
      return {
        ok: true,
        latencyMs: Date.now() - start,
        detail: "Anthropic models endpoint authenticated and responsive.",
      };
    }

    const spec = getProviderSpec(provider);
    const resolvedBase = validateOutboundUrl(
      (baseUrl || spec.defaultBaseUrl).replace(/\/+$/, ""),
      "provider base URL"
    )
      .toString()
      .replace(/\/+$/, "");
    const res = await fetch(`${resolvedBase}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        latencyMs: Date.now() - start,
        detail: `HTTP ${res.status}: ${body.slice(0, 120)}`,
      };
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      detail: `${spec.label} models endpoint verified.`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function isUpstreamModelFree(
  id: string,
  entry?: Record<string, unknown> | null
): boolean {
  if (entry && typeof entry === "object") {
    if (entry.free === true || entry.is_free === true) return true;
    if (typeof entry.tier === "string" && entry.tier.toLowerCase() === "free") {
      return true;
    }
    if (entry.pricing && typeof entry.pricing === "object") {
      const p = entry.pricing as Record<string, unknown>;
      if (
        p.prompt !== undefined &&
        p.prompt !== null &&
        String(p.prompt).trim() !== ""
      ) {
        const promptCost = Number(p.prompt);
        const compCost =
          p.completion !== undefined &&
          p.completion !== null &&
          String(p.completion).trim() !== ""
            ? Number(p.completion)
            : 0;
        if (!Number.isNaN(promptCost) && !Number.isNaN(compCost)) {
          return promptCost === 0 && compCost === 0;
        }
      }
    }
  }
  return /(^|[:/._-])free([:/._-]|$)/i.test(id);
}

export async function fetchProviderModels(params: {
  provider: string;
  apiKey: string;
  baseUrl?: string | null;
  freeOnly?: boolean;
}): Promise<string[]> {
  const { provider, apiKey, baseUrl, freeOnly } = params;
  const spec = getProviderSpec(provider);

  if (!apiKey) {
    throw new Error("API key is required to fetch upstream models.");
  }

  if (provider === "gemini") {
    const cleanBase = validateOutboundUrl(
      (baseUrl || spec.defaultBaseUrl)
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/v1beta$/, ""),
      "provider base URL"
    )
      .toString()
      .replace(/\/+$/, "");
    const res = await fetch(
      `${cleanBase}/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`,
      {
        method: "GET",
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 140)}`);
    }
    const json = (await res.json()) as {
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    const rawModels = Array.isArray(json.models) ? json.models : [];
    const filtered = rawModels.filter(
      (m) =>
        !Array.isArray(m.supportedGenerationMethods) ||
        m.supportedGenerationMethods.includes("generateContent")
    );
    const list = (filtered.length > 0 ? filtered : rawModels)
      .map((m) => (m.name || "").replace(/^models\//, "").trim())
      .filter((id) => Boolean(id) && (!freeOnly || isUpstreamModelFree(id) || /flash|gemma/i.test(id)));
    return Array.from(new Set(list)).sort();
  }

  if (provider === "anthropic") {
    const cleanBase = validateOutboundUrl(
      (baseUrl || "https://api.anthropic.com/v1")
        .trim()
        .replace(/\/+$/, ""),
      "provider base URL"
    )
      .toString()
      .replace(/\/+$/, "");
    const res = await fetch(`${cleanBase}/models?limit=100`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 140)}`);
    }
    const json = (await res.json()) as {
      data?: Array<Record<string, unknown> & { id?: string }>;
    };
    const list = (Array.isArray(json.data) ? json.data : [])
      .filter((m) => {
        const id = (m.id || "").trim();
        return Boolean(id) && (!freeOnly || isUpstreamModelFree(id, m));
      })
      .map((m) => (m.id || "").trim());
    return Array.from(new Set(list)).sort();
  }

  const cleanBase = validateOutboundUrl(
    (baseUrl || spec.defaultBaseUrl).trim().replace(/\/+$/, ""),
    "provider base URL"
  )
    .toString()
    .replace(/\/+$/, "");
  const res = await fetch(`${cleanBase}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${spec.label} HTTP ${res.status}: ${errText.slice(0, 140)}`);
  }

  type RawModelEntry = string | (Record<string, unknown> & { id?: string; name?: string });
  const json = (await res.json()) as
    | RawModelEntry[]
    | {
        data?: RawModelEntry[];
        models?: RawModelEntry[];
      };

  const rows: RawModelEntry[] = Array.isArray(json)
    ? json
    : Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.models)
        ? json.models
        : [];

  const list = rows
    .filter((m) => {
      const id = typeof m === "string" ? m.trim() : String(m?.id || m?.name || "").trim();
      if (!id) return false;
      if (!freeOnly) return true;
      return isUpstreamModelFree(id, typeof m === "string" ? null : m);
    })
    .map((m) =>
      typeof m === "string" ? m.trim() : String(m?.id || m?.name || "").trim()
    );

  return Array.from(new Set(list)).sort();
}

export async function probeProviderFreeModels(params: {
  provider: string;
  apiKeys: string[];
  baseUrl?: string | null;
  candidateModels: string[];
  existingHealth?: Record<string, ModelHealthEntry>;
}): Promise<{
  healthMap: Record<string, ModelHealthEntry>;
  probedModels: string[];
  healthyCount: number;
}> {
  const { provider, apiKeys, baseUrl, candidateModels, existingHealth } = params;
  const activeKey = apiKeys.find((k) => Boolean(k?.trim())) || "";
  const healthMap: Record<string, ModelHealthEntry> = {
    ...(existingHealth || {}),
  };

  const freeTargets = Array.from(
    new Set(
      candidateModels
        .map((m) => m.trim())
        .filter((m) => Boolean(m) && isModelKnownFree(provider, m))
    )
  ).slice(0, 12);

  if (!activeKey || freeTargets.length === 0) {
    return { healthMap, probedModels: [], healthyCount: 0 };
  }

  let healthyCount = 0;
  const batchSize = 3;

  for (let i = 0; i < freeTargets.length; i += batchSize) {
    const batch = freeTargets.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (modelId, idx) => {
        const keyToUse = apiKeys[(i + idx) % apiKeys.length] || activeKey;
        const t0 = Date.now();
        try {
          await invokeUpstreamCompletion({
            provider,
            model: modelId,
            apiKey: keyToUse,
            baseUrl,
            request: {
              model: modelId,
              messages: [{ role: "user", content: "OK" }],
              max_tokens: 4,
              temperature: 0,
              stream: false,
            },
          });
          const latencyMs = Date.now() - t0;
          healthyCount += 1;
          healthMap[modelId] = {
            ok: true,
            latencyMs,
            testedAt: new Date().toISOString(),
          };
        } catch (err: unknown) {
          const latencyMs = Date.now() - t0;
          const msg = err instanceof Error ? err.message : String(err);
          healthMap[modelId] = {
            ok: false,
            latencyMs,
            testedAt: new Date().toISOString(),
            error: msg.slice(0, 140),
          };
        }
      })
    );
  }

  return { healthMap, probedModels: freeTargets, healthyCount };
}
