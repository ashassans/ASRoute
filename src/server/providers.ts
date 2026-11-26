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
  hasFreeModelSuffix,
  isModelKnownFree,
  isSearchProvider,
} from "../shared/catalog.ts";
import type { ModelHealthEntry } from "../types/gateway.ts";
import { validateOutboundUrl, validateOutboundUrlWithDns } from "./urlSafety.ts";

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
  top_p?: number;
  stop?: string | string[];
  response_format?: Record<string, unknown>;
  presence_penalty?: number;
  frequency_penalty?: number;
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
    parsedUrl = await validateOutboundUrlWithDns(url, "image URL");
  } catch (err) {
    throw new UpstreamHttpError(
      err instanceof Error ? err.message : "Invalid image URL.",
      400,
      false
    );
  }

  const res = await fetch(parsedUrl.toString(), {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
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

function sanitizeGeminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "$schema" || key === "additionalProperties") {
      continue;
    }
    if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
      const nextProps: Record<string, unknown> = {};
      for (const [propKey, propSchema] of Object.entries(value as Record<string, unknown>)) {
        nextProps[propKey] = sanitizeGeminiSchema(propSchema);
      }
      clean[key] = nextProps;
    } else if (key === "items" && value && typeof value === "object" && !Array.isArray(value)) {
      clean[key] = sanitizeGeminiSchema(value);
    } else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      clean[key] = value.map((item) => sanitizeGeminiSchema(item));
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function pushGeminiContent(contents: Content[], role: "user" | "model", parts: Part[]) {
  if (parts.length === 0) return;
  const prev = contents[contents.length - 1];
  if (prev && prev.role === role && Array.isArray(prev.parts)) {
    prev.parts.push(...parts);
  } else {
    contents.push({ role, parts: [...parts] });
  }
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
      pushGeminiContent(contents, "model", parts);
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
      pushGeminiContent(contents, "user", [
        {
          functionResponse: {
            id: msg.tool_call_id,
            name: fnName,
            response: parsedResp,
          },
        },
      ]);
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
    pushGeminiContent(contents, "user", parts);
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
        parametersJsonSchema: sanitizeGeminiSchema(t.function.parameters),
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
      baseUrl,
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

function isRetryableStatus(statusCode: number): boolean {
  return (
    statusCode === 401 ||
    statusCode === 402 ||
    statusCode === 403 ||
    statusCode === 404 ||
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}

function createUpstreamTimeoutController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  label: string
) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const toAbortError = (): UpstreamHttpError => {
    if (parentSignal?.aborted) {
      return new UpstreamHttpError("Request aborted by client.", 499, false);
    }
    if (timedOut) {
      return new UpstreamHttpError(
        `${label} timed out after ${timeoutMs}ms`,
        504,
        true
      );
    }
    return new UpstreamHttpError(`${label} connection error`, 504, true);
  };

  const triggerTimeout = () => {
    timedOut = true;
    controller.abort(
      new UpstreamHttpError(
        `${label} timed out after ${timeoutMs}ms`,
        504,
        true
      )
    );
  };

  const reset = () => {
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted) {
      timer = setTimeout(triggerTimeout, timeoutMs);
    }
  };

  const onParentAbort = () => {
    if (timer) clearTimeout(timer);
    controller.abort(
      new UpstreamHttpError("Request aborted by client.", 499, false)
    );
  };

  if (parentSignal?.aborted) {
    onParentAbort();
  } else {
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    reset();
  }

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  };

  return {
    signal: controller.signal,
    reset,
    cleanup,
    toAbortError,
    get timedOut() {
      return timedOut;
    },
  };
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  abortSignal: AbortSignal,
  getError: () => UpstreamHttpError
): Promise<T> {
  if (abortSignal.aborted) {
    throw getError();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(getError());
    abortSignal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => {
        abortSignal.removeEventListener("abort", onAbort);
        resolve(val);
      },
      (err) => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

async function invokeGemini(params: {
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

  let resolvedGeminiBaseUrl: string | undefined;
  if (baseUrl && baseUrl.trim()) {
    const clean = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1beta$/, "");
    if (clean !== "https://generativelanguage.googleapis.com") {
      try {
        resolvedGeminiBaseUrl = (
          await validateOutboundUrlWithDns(clean, "provider base URL")
        )
          .toString()
          .replace(/\/+$/, "");
      } catch (err) {
        throw new UpstreamHttpError(
          err instanceof Error ? err.message : "Invalid provider base URL.",
          400,
          false
        );
      }
    }
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: timeoutMs,
      ...(resolvedGeminiBaseUrl ? { baseUrl: resolvedGeminiBaseUrl } : {}),
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const { systemInstruction, contents, tools, toolConfig } =
    await buildGeminiPayload(request);

  const watchdog = createUpstreamTimeoutController(
    signal,
    timeoutMs,
    `Gemini (${model})`
  );

  const config: Record<string, unknown> = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (typeof request.temperature === "number") {
    config.temperature = request.temperature;
  }
  if (typeof request.max_tokens === "number" && request.max_tokens > 0) {
    config.maxOutputTokens = request.max_tokens;
  }
  if (typeof request.top_p === "number") {
    config.topP = request.top_p;
  }
  if (typeof request.stop === "string" && request.stop) {
    config.stopSequences = [request.stop];
  } else if (Array.isArray(request.stop) && request.stop.length > 0) {
    config.stopSequences = request.stop.filter((s) => typeof s === "string" && s);
  }
  if (request.response_format && typeof request.response_format === "object") {
    const fmtType = request.response_format.type;
    if (fmtType === "json_object" || fmtType === "json_schema") {
      config.responseMimeType = "application/json";
      const jsonSchema = (request.response_format.json_schema as Record<string, unknown> | undefined)?.schema;
      if (fmtType === "json_schema" && jsonSchema && typeof jsonSchema === "object") {
        config.responseJsonSchema = sanitizeGeminiSchema(jsonSchema);
      }
    }
  }
  if (tools) config.tools = tools;
  if (toolConfig) config.toolConfig = toolConfig;
  config.abortSignal = watchdog.signal;

  try {
    if (request.stream && onStreamDelta) {
      const stream = await raceWithAbort(
        ai.models.generateContentStream({
          model,
          contents,
          config: Object.keys(config).length > 0 ? config : undefined,
        }),
        watchdog.signal,
        watchdog.toAbortError
      );

      let fullText = "";
      let promptTokens = 0;
      let completionTokens = 0;
      const collectedToolCalls: OpenAIToolCall[] = [];
      const iterator = stream[Symbol.asyncIterator]();

      try {
        while (true) {
          const step = await raceWithAbort(
            iterator.next(),
            watchdog.signal,
            watchdog.toAbortError
          );
          if (step.done) break;
          watchdog.reset();
          const chunk = step.value;
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
      } finally {
        iterator.return?.(undefined).catch(() => {});
      }

      if (fullText.length === 0 && collectedToolCalls.length === 0) {
        throw new UpstreamHttpError(
          `Gemini (${model}) returned an empty completion`,
          502,
          true
        );
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

    const response = await raceWithAbort(
      ai.models.generateContent({
        model,
        contents,
        config: Object.keys(config).length > 0 ? config : undefined,
      }),
      watchdog.signal,
      watchdog.toAbortError
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

    if (text.length === 0 && toolCalls.length === 0) {
      throw new UpstreamHttpError(
        `Gemini (${model}) returned an empty completion`,
        502,
        true
      );
    }

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
    if (watchdog.timedOut) {
      throw watchdog.toAbortError();
    }
    const message = err instanceof Error ? err.message : String(err);
    const statusMatch = message.match(
      /\b(400|401|402|403|404|408|429|500|502|503|504)\b/
    );
    const statusCode = statusMatch ? Number(statusMatch[1]) : 502;
    throw new UpstreamHttpError(
      message,
      statusCode,
      isRetryableStatus(statusCode)
    );
  } finally {
    watchdog.cleanup();
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
    endpoint = (await validateOutboundUrlWithDns(rawEndpoint, "provider base URL")).toString();
  } catch (err) {
    throw new UpstreamHttpError(
      err instanceof Error ? err.message : "Invalid provider base URL.",
      400,
      false
    );
  }

  const systemParts: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }> = [];

  const pushAnthropicMessage = (
    role: "user" | "assistant",
    blocks: Array<Record<string, unknown>>
  ) => {
    if (blocks.length === 0) return;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) {
      prev.content.push(...blocks);
    } else {
      messages.push({ role, content: [...blocks] });
    }
  };

  for (const m of request.messages) {
    if (m.role === "system") {
      const txt = extractTextContent(m.content);
      if (txt) systemParts.push(txt);
      continue;
    }

    if (m.role === "tool") {
      pushAnthropicMessage("user", [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id || "tool_call",
          content: extractTextContent(m.content),
        },
      ]);
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
      pushAnthropicMessage("assistant", blocks);
      continue;
    }

    // User message (string or multimodal array)
    if (typeof m.content === "string") {
      if (m.content) {
        pushAnthropicMessage("user", [{ type: "text", text: m.content }]);
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
              safeUrl = (
                await validateOutboundUrlWithDns(part.image_url.url, "image URL")
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
      pushAnthropicMessage("user", blocks);
    }
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: request.max_tokens || 2048,
    messages:
      messages.length > 0
        ? messages
        : [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    stream: Boolean(request.stream && onStreamDelta),
  };
  if (systemParts.length > 0) {
    body.system = systemParts.join("\n\n");
  }
  if (typeof request.temperature === "number") {
    body.temperature = request.temperature;
  }
  if (typeof request.top_p === "number") {
    body.top_p = request.top_p;
  }
  if (typeof request.stop === "string" && request.stop) {
    body.stop_sequences = [request.stop];
  } else if (Array.isArray(request.stop) && request.stop.length > 0) {
    body.stop_sequences = request.stop.filter((s) => typeof s === "string" && s);
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

  const watchdog = createUpstreamTimeoutController(
    signal,
    timeoutMs,
    `Anthropic (${model})`
  );

  try {
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
        signal: watchdog.signal,
      });
    } catch (err) {
      if (watchdog.signal.aborted) {
        throw watchdog.toAbortError();
      }
      throw new UpstreamHttpError(
        err instanceof Error ? err.message : "Anthropic connection error",
        504,
        true
      );
    }

    if (!res.ok) {
      const errText = await raceWithAbort(
        res.text(),
        watchdog.signal,
        watchdog.toAbortError
      );
      throw new UpstreamHttpError(
        errText || `Anthropic HTTP ${res.status}`,
        res.status,
        isRetryableStatus(res.status)
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

      try {
        while (true) {
          const { value, done } = await raceWithAbort(
            reader.read(),
            watchdog.signal,
            watchdog.toAbortError
          );
          if (done) break;
          watchdog.reset();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;
            let parsed: Record<string, any>;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              continue;
            }
            if (parsed.type === "error" || parsed.error) {
              const errMsg =
                parsed.error?.message ||
                JSON.stringify(parsed.error || parsed);
              const errCode = Number(parsed.error?.status || 502) || 502;
              if (fullText.length === 0 && toolMap.size === 0) {
                throw new UpstreamHttpError(
                  errMsg || "Anthropic upstream stream error",
                  errCode,
                  isRetryableStatus(errCode)
                );
              }
              continue;
            }
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
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }

      const toolCalls: OpenAIToolCall[] = Array.from(toolMap.values()).map(
        (t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.args || "{}" },
        })
      );

      if (fullText.length === 0 && toolCalls.length === 0) {
        throw new UpstreamHttpError(
          `Anthropic (${model}) returned an empty completion`,
          502,
          true
        );
      }

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

    const json = (await raceWithAbort(
      res.json(),
      watchdog.signal,
      watchdog.toAbortError
    )) as {
      type?: string;
      error?: { message?: string; status?: number };
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

    if (json.type === "error" || json.error) {
      const errCode = Number(json.error?.status || 502) || 502;
      throw new UpstreamHttpError(
        json.error?.message || "Anthropic upstream error",
        errCode,
        isRetryableStatus(errCode)
      );
    }

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

    if (content.length === 0 && toolCalls.length === 0) {
      throw new UpstreamHttpError(
        `Anthropic (${model}) returned an empty completion`,
        502,
        true
      );
    }

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
  } finally {
    watchdog.cleanup();
  }
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
    endpoint = (
      await validateOutboundUrlWithDns(rawEndpoint, "provider base URL")
    ).toString();
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
  if (typeof request.top_p === "number") {
    body.top_p = request.top_p;
  }
  if (request.stop !== undefined) {
    body.stop = request.stop;
  }
  if (request.response_format !== undefined) {
    body.response_format = request.response_format;
  }
  if (typeof request.presence_penalty === "number") {
    body.presence_penalty = request.presence_penalty;
  }
  if (typeof request.frequency_penalty === "number") {
    body.frequency_penalty = request.frequency_penalty;
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = request.tools;
  }
  if (request.tool_choice !== undefined) {
    body.tool_choice = request.tool_choice;
  }
  const supportsStreamOptions =
    provider === "openai" ||
    provider === "groq" ||
    provider === "deepseek" ||
    provider === "openrouter" ||
    provider === "xai" ||
    provider === "cerebras" ||
    provider === "together" ||
    provider === "fireworks";
  if (body.stream && supportsStreamOptions) {
    body.stream_options = { include_usage: true };
  }

  const watchdog = createUpstreamTimeoutController(
    signal,
    timeoutMs,
    `${spec.label} (${model})`
  );

  try {
    const sendFetch = async (payloadBody: Record<string, unknown>) => {
      try {
        return await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payloadBody),
          signal: watchdog.signal,
        });
      } catch (err) {
        if (watchdog.signal.aborted) {
          throw watchdog.toAbortError();
        }
        throw new UpstreamHttpError(
          err instanceof Error ? err.message : `${spec.label} connection error`,
          504,
          true
        );
      }
    };

    let res = await sendFetch(body);

    if (!res.ok) {
      let errText = await raceWithAbort(
        res.text(),
        watchdog.signal,
        watchdog.toAbortError
      );
      if (
        (res.status === 400 || res.status === 422) &&
        body.stream_options &&
        /stream_options|extra_forbidden|unrecognized|additional properties/i.test(
          errText
        )
      ) {
        const retryBody = { ...body };
        delete retryBody.stream_options;
        watchdog.reset();
        res = await sendFetch(retryBody);
        if (!res.ok) {
          errText = await raceWithAbort(
            res.text(),
            watchdog.signal,
            watchdog.toAbortError
          );
        }
      }

      if (!res.ok) {
        throw new UpstreamHttpError(
          errText || `${spec.label} HTTP ${res.status}`,
          res.status,
          isRetryableStatus(res.status)
        );
      }
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

      try {
        while (true) {
          const { value, done } = await raceWithAbort(
            reader.read(),
            watchdog.signal,
            watchdog.toAbortError
          );
          if (done) break;
          watchdog.reset();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;
            let parsed: Record<string, any>;
            try {
              parsed = JSON.parse(dataStr);
            } catch {
              continue;
            }

            if (parsed.error) {
              const errMsg =
                parsed.error?.message ||
                (typeof parsed.error === "string"
                  ? parsed.error
                  : JSON.stringify(parsed.error));
              const errCode = Number(parsed.error?.code || parsed.error?.status || 502) || 502;
              if (fullText.length === 0 && toolAcc.size === 0) {
                throw new UpstreamHttpError(
                  errMsg || `${spec.label} inline stream error`,
                  errCode,
                  isRetryableStatus(errCode)
                );
              }
              continue;
            }

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
              if (
                finishReason === "error" &&
                fullText.length === 0 &&
                toolAcc.size === 0
              ) {
                throw new UpstreamHttpError(
                  `${spec.label} stream terminated with finish_reason=error`,
                  502,
                  true
                );
              }
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
              completionTokens =
                parsed.usage.completion_tokens ?? completionTokens;
            }
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }

      const toolCalls: OpenAIToolCall[] = Array.from(toolAcc.values()).map(
        (t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.arguments || "{}" },
        })
      );

      if (fullText.length === 0 && toolCalls.length === 0) {
        throw new UpstreamHttpError(
          `${spec.label} (${model}) returned an empty completion`,
          502,
          true
        );
      }

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

    const json = (await raceWithAbort(
      res.json(),
      watchdog.signal,
      watchdog.toAbortError
    )) as {
      error?: { message?: string; code?: number; status?: number };
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: OpenAIToolCall[];
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    if (json.error) {
      const errCode = Number(json.error.code || json.error.status || 502) || 502;
      throw new UpstreamHttpError(
        json.error.message || `${spec.label} error response`,
        errCode,
        isRetryableStatus(errCode)
      );
    }

    const msg = json.choices?.[0]?.message;
    const content = msg?.content ?? "";
    const toolCalls =
      Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
        ? msg.tool_calls
        : undefined;

    if (content.length === 0 && !toolCalls) {
      throw new UpstreamHttpError(
        `${spec.label} (${model}) returned an empty completion`,
        502,
        true
      );
    }

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
  } finally {
    watchdog.cleanup();
  }
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
      let resolvedGeminiBaseUrl: string | undefined;
      if (baseUrl && baseUrl.trim()) {
        const clean = baseUrl.trim().replace(/\/+$/, "").replace(/\/v1beta$/, "");
        if (clean !== "https://generativelanguage.googleapis.com") {
          resolvedGeminiBaseUrl = (
            await validateOutboundUrlWithDns(clean, "provider base URL")
          )
            .toString()
            .replace(/\/+$/, "");
        }
      }
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          ...(resolvedGeminiBaseUrl ? { baseUrl: resolvedGeminiBaseUrl } : {}),
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

    if (provider === "tavily") {
      const cleanBase = validateOutboundUrl(
        (baseUrl || "https://api.tavily.com").replace(/\/+$/, ""),
        "provider base URL"
      )
        .toString()
        .replace(/\/+$/, "");
      const res = await fetch(`${cleanBase}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: "test",
          max_results: 1,
          search_depth: "basic",
        }),
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
        detail: "Tavily Search API authenticated and responsive.",
      };
    }

    if (provider === "brave-search") {
      const cleanBase = validateOutboundUrl(
        (baseUrl || "https://api.search.brave.com/res/v1").replace(/\/+$/, ""),
        "provider base URL"
      )
        .toString()
        .replace(/\/+$/, "");
      const res = await fetch(`${cleanBase}/web/search?q=test&count=1`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
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
        detail: "Brave Search API authenticated and responsive.",
      };
    }

    if (provider === "exa") {
      const cleanBase = validateOutboundUrl(
        (baseUrl || "https://api.exa.ai").replace(/\/+$/, ""),
        "provider base URL"
      )
        .toString()
        .replace(/\/+$/, "");
      const res = await fetch(`${cleanBase}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ query: "test", numResults: 1 }),
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
        detail: "Exa Search API authenticated and responsive.",
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

function isUpstreamModelFree(id: string): boolean {
  return hasFreeModelSuffix(id);
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

  if (isSearchProvider(provider)) {
    return spec.models.map((m) => m.id);
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
      .filter((id) => Boolean(id) && (!freeOnly || isUpstreamModelFree(id)));
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
        return Boolean(id) && (!freeOnly || isUpstreamModelFree(id));
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
      return isUpstreamModelFree(id);
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
  ).slice(0, 25);

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
            timeoutMs: 10000,
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
