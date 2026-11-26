import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db, ensureSchema } from "../../db/index.ts";
import {
  combos,
  gatewayApiKeys,
  providerConnections,
} from "../../db/schema.ts";
import {
  getConnectionPrefix,
  getProviderSpec,
  isModelKnownFree,
  isSearchProvider,
  PROVIDER_CATALOG,
} from "../../shared/catalog.ts";
import { hashGatewayApiKey } from "../crypto.ts";
import {
  type NormalizedCompletionRequest,
  type OpenAIChatMessage,
  type OpenAIContentPart,
  type OpenAIToolDefinition,
  UpstreamHttpError,
} from "../providers.ts";
import {
  executeGatewayChatCompletion,
  resolveRoutingTarget,
} from "../routerEngine.ts";
import { executeGatewayExtract, executeGatewaySearch } from "../searchEngine.ts";
import { validateOutboundUrlWithDns } from "../urlSafety.ts";
import {
  decryptConnectionAllKeys,
  parseAvailableModels,
} from "../utils/connections.ts";

export const gatewayRouter = Router();

export async function isModelAllowedForKey(
  allowedCombo: string | null | undefined,
  userId: string,
  requestedModel: string
): Promise<boolean> {
  if (!allowedCombo || allowedCombo === "*") return true;
  const normalizedAllowed = allowedCombo
    .trim()
    .replace(/^(as-router-combo|as-router|combo)\//i, "")
    .toLowerCase();
  const normalizedReq = requestedModel
    .trim()
    .replace(/^(as-router-combo|as-router|combo)\//i, "")
    .toLowerCase();
  if (normalizedAllowed === normalizedReq) return true;

  const target = await resolveRoutingTarget(userId, requestedModel);
  if (!target.combo) return false;
  return (
    target.combo.id.toLowerCase() === allowedCombo.trim().toLowerCase() ||
    target.combo.name.trim().toLowerCase() === normalizedAllowed
  );
}

async function authenticateGatewayKey(req: Request) {
  await ensureSchema();
  const authHeader = req.headers.authorization || "";
  const xApiKeyHeader =
    typeof req.headers["x-api-key"] === "string"
      ? req.headers["x-api-key"].trim()
      : "";
  const bodyApiKey =
    req.body && typeof (req.body as { api_key?: unknown }).api_key === "string"
      ? String((req.body as { api_key?: unknown }).api_key).trim()
      : "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : xApiKeyHeader || bodyApiKey;

  if (!token || !token.startsWith("sk-asr-")) {
    throw new UpstreamHttpError(
      "Missing or invalid AS ROUTER API key. Expected Authorization: Bearer sk-asr-... or x-api-key header.",
      401,
      false
    );
  }

  const keyHash = hashGatewayApiKey(token);
  const [keyRow] = await db
    .select()
    .from(gatewayApiKeys)
    .where(eq(gatewayApiKeys.keyHash, keyHash));

  if (!keyRow || !keyRow.isActive) {
    throw new UpstreamHttpError("API key is invalid or disabled.", 401, false);
  }

  const now = new Date();
  let usedToday = keyRow.usedTokensToday ?? 0;
  let usedMonth = keyRow.usedCostMonth ?? 0;
  const lastReset = keyRow.quotaResetAt
    ? new Date(keyRow.quotaResetAt)
    : new Date(0);

  const resetDaily =
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth() ||
    lastReset.getUTCDate() !== now.getUTCDate();

  const resetMonthly =
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth();

  if (resetDaily || resetMonthly) {
    if (resetDaily) usedToday = 0;
    if (resetMonthly) usedMonth = 0;
    await db
      .update(gatewayApiKeys)
      .set({
        usedTokensToday: usedToday,
        usedCostMonth: usedMonth,
        quotaResetAt: now,
      })
      .where(eq(gatewayApiKeys.id, keyRow.id));
  }

  if (
    keyRow.dailyTokenLimit !== null &&
    keyRow.dailyTokenLimit > 0 &&
    usedToday >= keyRow.dailyTokenLimit
  ) {
    throw new UpstreamHttpError(
      "API key daily token limit exceeded. Limit automatically resets at 00:00 UTC.",
      429,
      false
    );
  }

  if (
    keyRow.monthlyUsdLimit !== null &&
    keyRow.monthlyUsdLimit > 0 &&
    usedMonth >= keyRow.monthlyUsdLimit
  ) {
    throw new UpstreamHttpError(
      "API key monthly budget exceeded. Budget automatically resets at the beginning of next month.",
      429,
      false
    );
  }

  return { ...keyRow, usedTokensToday: usedToday, usedCostMonth: usedMonth };
}

gatewayRouter.get("/models", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const [userCombos, userConns] = await Promise.all([
      db
        .select()
        .from(combos)
        .where(and(eq(combos.userId, keyRow.userId), eq(combos.isActive, true))),
      db
        .select()
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.userId, keyRow.userId),
            eq(providerConnections.isActive, true)
          )
        ),
    ]);

    const seenIds = new Set<string>();
    const models: Array<{
      id: string;
      object: string;
      created: number;
      owned_by: string;
    }> = [];

    const hasActiveLlm = userConns.some((c) => !isSearchProvider(c.provider));
    const allowedNormalized = (keyRow.allowedCombo || "*")
      .trim()
      .replace(/^(as-router-combo|as-router|combo)\//i, "")
      .toLowerCase();
    if (
      hasActiveLlm &&
      (allowedNormalized === "*" || allowedNormalized === "auto")
    ) {
      seenIds.add("auto");
      models.push({
        id: "auto",
        object: "model",
        created: 1735689600,
        owned_by: "as-router",
      });
    }
    if (
      hasActiveLlm &&
      (allowedNormalized === "*" || allowedNormalized === "claude")
    ) {
      seenIds.add("claude");
      models.push({
        id: "claude",
        object: "model",
        created: 1735689600,
        owned_by: "as-router",
      });
    }

    for (const c of userCombos) {
      if (keyRow.freeOnly && !c.freeOnly) continue;
      if (!seenIds.has(c.name)) {
        seenIds.add(c.name);
        models.push({
          id: c.name,
          object: "model",
          created: Math.floor(c.createdAt.getTime() / 1000),
          owned_by: "as-router-combo",
        });
      }
    }

    for (const conn of userConns) {
      if (isSearchProvider(conn.provider)) continue;
      const prefix = getConnectionPrefix(conn);
      const connModels = Array.from(
        new Set([
          ...(conn.defaultModel ? [conn.defaultModel] : []),
          ...parseAvailableModels(conn.availableModels),
        ])
      );
      for (const m of connModels) {
        if (keyRow.freeOnly && !isModelKnownFree(conn.provider, m)) continue;
        const modelKey = `${prefix}/${m}`;
        if (!seenIds.has(modelKey)) {
          seenIds.add(modelKey);
          models.push({
            id: modelKey,
            object: "model",
            created: Math.floor(conn.createdAt.getTime() / 1000),
            owned_by: prefix,
          });
        }
      }
    }

    for (const p of PROVIDER_CATALOG) {
      if (p.kind === "search") continue;
      for (const m of p.models) {
        if (keyRow.freeOnly && !isModelKnownFree(p.id, m.id)) continue;
        const modelKey = `${p.id}/${m.id}`;
        if (!seenIds.has(modelKey)) {
          seenIds.add(modelKey);
          models.push({
            id: modelKey,
            object: "model",
            created: 1735689600,
            owned_by: p.id,
          });
        }
      }
    }

    return res.json({ object: "list", data: models });
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 401;
    const message = err instanceof Error ? err.message : "Unauthorized";
    return res.status(status).json({ error: { message, type: "auth_error" } });
  }
});

gatewayRouter.post("/chat/completions", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const body = req.body as Partial<NormalizedCompletionRequest>;

    if (!body?.model || !Array.isArray(body?.messages)) {
      return res.status(400).json({
        error: {
          message: "Request must include 'model' and 'messages' array.",
          type: "invalid_request_error",
        },
      });
    }

    if (!(await isModelAllowedForKey(keyRow.allowedCombo, keyRow.userId, body.model))) {
      return res.status(403).json({
        error: {
          message: `This API key is scoped exclusively to combo "${keyRow.allowedCombo}".`,
          type: "permission_error",
        },
      });
    }

    const requestPayload: NormalizedCompletionRequest = {
      model: body.model,
      messages: body.messages,
      stream: Boolean(body.stream),
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      top_p: body.top_p,
      stop: body.stop,
      response_format: body.response_format,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      tools: Array.isArray(body.tools) ? body.tools : undefined,
      tool_choice: body.tool_choice,
    };

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    if (requestPayload.stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      req.socket?.setNoDelay?.(true);
      res.flushHeaders?.();
      res.write(": asrouter-stream\n\n");

      const streamId = `chatcmpl-${crypto.randomBytes(8).toString("hex")}`;
      const created = Math.floor(Date.now() / 1000);

      try {
        const result = await executeGatewayChatCompletion({
          userId: keyRow.userId,
          apiKeyId: keyRow.id,
          apiKeyPrefix: keyRow.keyPrefix,
          request: requestPayload,
          freeOnly: Boolean(keyRow.freeOnly),
          signal: abortController.signal,
          onStreamDelta: (delta) => {
            if (abortController.signal.aborted) return;
            const chunk = {
              id: streamId,
              object: "chat.completion.chunk",
              created,
              model: requestPayload.model,
              choices: [
                {
                  index: 0,
                  delta,
                  finish_reason: null,
                },
              ],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          },
        });

        if (abortController.signal.aborted) {
          return res.end();
        }

        const finalChunk = {
          id: streamId,
          object: "chat.completion.chunk",
          created,
          model: requestPayload.model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: result.finishReason || "stop",
            },
          ],
          usage: {
            prompt_tokens: result.promptTokens,
            completion_tokens: result.completionTokens,
            total_tokens: result.promptTokens + result.completionTokens,
          },
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      } catch (streamErr: unknown) {
        if (!abortController.signal.aborted) {
          const message =
            streamErr instanceof Error
              ? streamErr.message
              : "Gateway stream error";
          res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
          res.write("data: [DONE]\n\n");
        }
        return res.end();
      }
    }

    const result = await executeGatewayChatCompletion({
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      apiKeyPrefix: keyRow.keyPrefix,
      request: requestPayload,
      freeOnly: Boolean(keyRow.freeOnly),
      signal: abortController.signal,
    });

    return res.json({
      id: result.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestPayload.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: result.toolCalls && !result.content ? null : result.content,
            ...(result.toolCalls ? { tool_calls: result.toolCalls } : {}),
          },
          finish_reason: result.finishReason,
        },
      ],
      usage: {
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        total_tokens: result.promptTokens + result.completionTokens,
      },
      x_asrouter: {
        resolved_provider: result.resolvedProvider,
        resolved_model: result.resolvedModel,
        combo: result.comboName,
        detected_intent: result.detectedIntent,
        latency_ms: result.latencyMs,
        compressed: result.compressed,
        cached: Boolean(result.cached),
        fallback_hops: result.fallbackAttempts,
      },
    });
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Gateway failure";
    return res.status(status).json({
      error: {
        message,
        type: status === 429 ? "rate_limit_error" : "gateway_error",
      },
    });
  }
});

interface ResponsesToolSpec {
  type?: string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  function?: {
    name?: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ResponsesApiBody {
  model?: string;
  input?: unknown;
  instructions?: string | null;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  stop?: string | string[];
  parallel_tool_calls?: boolean;
  tools?: ResponsesToolSpec[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type?: string; name?: string; function?: { name?: string } };
  text?: {
    format?: {
      type?: string;
      name?: string;
      schema?: Record<string, unknown>;
      strict?: boolean;
    };
  };
}

function serializeResponsesOutputValue(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const parts = output
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          if (typeof obj.text === "string") return obj.text;
          if (typeof obj.output_text === "string") return obj.output_text;
          return JSON.stringify(obj);
        }
        return "";
      })
      .filter(Boolean);
    return parts.join("\n");
  }
  if (output === null || output === undefined) return "";
  return JSON.stringify(output);
}

export function normalizeResponsesBodyToChatRequest(
  body: ResponsesApiBody
): NormalizedCompletionRequest {
  const translatedMessages: OpenAIChatMessage[] = [];

  if (typeof body.instructions === "string" && body.instructions.trim()) {
    translatedMessages.push({ role: "system", content: body.instructions });
  }

  const pushAssistantToolCall = (call: {
    id: string;
    name: string;
    arguments: string;
  }) => {
    const prev = translatedMessages[translatedMessages.length - 1];
    const toolCall = {
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    };
    if (prev && prev.role === "assistant") {
      prev.tool_calls = [...(prev.tool_calls || []), toolCall];
    } else {
      translatedMessages.push({
        role: "assistant",
        content: null,
        tool_calls: [toolCall],
      });
    }
  };

  if (typeof body.input === "string") {
    translatedMessages.push({ role: "user", content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const rawItem of body.input) {
      if (typeof rawItem === "string") {
        translatedMessages.push({ role: "user", content: rawItem });
        continue;
      }
      if (!rawItem || typeof rawItem !== "object") continue;

      const item = rawItem as Record<string, unknown>;
      const itemType = typeof item.type === "string" ? item.type : "";

      if (itemType === "function_call") {
        const fnName = typeof item.name === "string" ? item.name.trim() : "";
        if (!fnName) continue;
        const callId =
          typeof item.call_id === "string" && item.call_id.trim()
            ? item.call_id.trim()
            : typeof item.id === "string" && item.id.trim()
              ? item.id.trim()
              : `call_${crypto.randomBytes(6).toString("hex")}`;
        const args =
          typeof item.arguments === "string"
            ? item.arguments
            : JSON.stringify(item.arguments ?? {});
        pushAssistantToolCall({ id: callId, name: fnName, arguments: args });
        continue;
      }

      if (itemType === "function_call_output") {
        const callId =
          typeof item.call_id === "string" && item.call_id.trim()
            ? item.call_id.trim()
            : "call_0";
        translatedMessages.push({
          role: "tool",
          tool_call_id: callId,
          content: serializeResponsesOutputValue(item.output),
        });
        continue;
      }

      if (itemType === "reasoning" || itemType === "item_reference") {
        continue;
      }

      // Standard message item (type === "message" or omitted type with role)
      const rawRole =
        typeof item.role === "string" ? item.role.toLowerCase() : "user";
      const mappedRole: OpenAIChatMessage["role"] =
        rawRole === "system" || rawRole === "developer"
          ? "system"
          : rawRole === "assistant"
            ? "assistant"
            : rawRole === "tool"
              ? "tool"
              : "user";

      if (mappedRole === "tool") {
        const callId =
          typeof item.call_id === "string"
            ? item.call_id
            : typeof item.tool_call_id === "string"
              ? item.tool_call_id
              : "call_0";
        translatedMessages.push({
          role: "tool",
          tool_call_id: callId,
          content: serializeResponsesOutputValue(item.content),
        });
        continue;
      }

      if (typeof item.content === "string") {
        translatedMessages.push({ role: mappedRole, content: item.content });
        continue;
      }

      if (!Array.isArray(item.content)) continue;

      if (mappedRole === "system" || mappedRole === "assistant") {
        const text = item.content
          .map((part) => {
            if (typeof part === "string") return part;
            if (part && typeof part === "object") {
              const p = part as Record<string, unknown>;
              if (typeof p.text === "string") return p.text;
              if (typeof p.refusal === "string") return p.refusal;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n");
        if (text) {
          translatedMessages.push({ role: mappedRole, content: text });
        }
        continue;
      }

      const userParts: OpenAIContentPart[] = [];
      for (const rawPart of item.content) {
        if (typeof rawPart === "string") {
          if (rawPart) userParts.push({ type: "text", text: rawPart });
          continue;
        }
        if (!rawPart || typeof rawPart !== "object") continue;
        const part = rawPart as Record<string, unknown>;
        const pType = typeof part.type === "string" ? part.type : "";
        if (
          (pType === "input_text" || pType === "output_text" || pType === "text" || !pType) &&
          typeof part.text === "string"
        ) {
          userParts.push({ type: "text", text: part.text });
        } else if (pType === "input_image") {
          const rawUrl =
            typeof part.image_url === "string"
              ? part.image_url
              : part.image_url && typeof part.image_url === "object"
                ? (part.image_url as { url?: string }).url
                : undefined;
          const detail =
            typeof part.detail === "string"
              ? part.detail
              : part.image_url && typeof part.image_url === "object"
                ? (part.image_url as { detail?: string }).detail
                : undefined;
          if (typeof rawUrl === "string" && rawUrl.trim()) {
            userParts.push({
              type: "image_url",
              image_url: detail ? { url: rawUrl, detail } : { url: rawUrl },
            });
          }
        } else if (pType === "input_file" && typeof part.filename === "string") {
          userParts.push({
            type: "text",
            text: `[Attached file: ${part.filename}]`,
          });
        }
      }

      if (userParts.length > 0) {
        const hasImages = userParts.some((p) => p.type === "image_url");
        translatedMessages.push({
          role: "user",
          content: hasImages
            ? userParts
            : userParts
                .map((p) => (p.type === "text" ? p.text : ""))
                .join("\n"),
        });
      }
    }
  }

  const translatedTools: OpenAIToolDefinition[] = [];
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      if (!t || t.type !== "function") continue;
      const fnName = t.name || t.function?.name;
      if (!fnName) continue;
      translatedTools.push({
        type: "function",
        function: {
          name: fnName,
          description: t.description ?? t.function?.description,
          parameters: t.parameters ?? t.function?.parameters,
        },
      });
    }
  }

  let translatedToolChoice: NormalizedCompletionRequest["tool_choice"];
  if (
    body.tool_choice === "auto" ||
    body.tool_choice === "none" ||
    body.tool_choice === "required"
  ) {
    translatedToolChoice = body.tool_choice;
  } else if (body.tool_choice && typeof body.tool_choice === "object") {
    const fnName =
      body.tool_choice.name || body.tool_choice.function?.name;
    if (body.tool_choice.type === "function" && fnName) {
      translatedToolChoice = {
        type: "function",
        function: { name: fnName },
      };
    }
  }

  let responseFormat: Record<string, unknown> | undefined;
  const textFormat = body.text?.format;
  if (textFormat?.type === "json_object") {
    responseFormat = { type: "json_object" };
  } else if (textFormat?.type === "json_schema" && textFormat.schema) {
    responseFormat = {
      type: "json_schema",
      json_schema: {
        name: textFormat.name || "response",
        schema: textFormat.schema,
        ...(typeof textFormat.strict === "boolean"
          ? { strict: textFormat.strict }
          : {}),
      },
    };
  }

  const rawMax = Number(body.max_output_tokens ?? body.max_tokens);
  const maxTokens =
    Number.isFinite(rawMax) && rawMax > 0
      ? Math.min(Math.round(rawMax), 65536)
      : undefined;

  return {
    model: body.model || "",
    messages: translatedMessages,
    stream: Boolean(body.stream),
    temperature: body.temperature,
    max_tokens: maxTokens,
    top_p: body.top_p,
    stop: body.stop,
    response_format: responseFormat,
    tools: translatedTools.length > 0 ? translatedTools : undefined,
    tool_choice: translatedToolChoice,
  };
}

function buildResponsesObject(params: {
  id: string;
  createdAt: number;
  model: string;
  status: "in_progress" | "completed" | "incomplete" | "failed";
  output: Array<Record<string, unknown>>;
  outputText?: string;
  instructions?: string | null;
  maxOutputTokens?: number | null;
  temperature?: number | null;
  topP?: number | null;
  parallelToolCalls?: boolean;
  incompleteReason?: string | null;
  error?: { code: string; message: string } | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  } | null;
  meta?: Record<string, unknown>;
}) {
  return {
    id: params.id,
    object: "response",
    created_at: params.createdAt,
    status: params.status,
    error: params.error ?? null,
    incomplete_details: params.incompleteReason
      ? { reason: params.incompleteReason }
      : null,
    instructions: params.instructions ?? null,
    max_output_tokens: params.maxOutputTokens ?? null,
    model: params.model,
    output: params.output,
    ...(typeof params.outputText === "string"
      ? { output_text: params.outputText }
      : {}),
    parallel_tool_calls: params.parallelToolCalls ?? true,
    temperature: params.temperature ?? 1,
    top_p: params.topP ?? 1,
    usage: params.usage
      ? {
          input_tokens: params.usage.promptTokens,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: params.usage.completionTokens,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens:
            params.usage.promptTokens + params.usage.completionTokens,
        }
      : null,
    ...(params.meta ? { x_asrouter: params.meta } : {}),
  };
}

gatewayRouter.post("/responses", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const body = (req.body || {}) as ResponsesApiBody;

    if (!body.model || typeof body.model !== "string" || !body.model.trim()) {
      return res.status(400).json({
        error: {
          message: "Request must include a 'model' string.",
          type: "invalid_request_error",
        },
      });
    }

    const requestPayload = normalizeResponsesBodyToChatRequest(body);
    if (requestPayload.messages.length === 0) {
      return res.status(400).json({
        error: {
          message:
            "Request must include non-empty 'input' or 'instructions'.",
          type: "invalid_request_error",
        },
      });
    }

    if (!(await isModelAllowedForKey(keyRow.allowedCombo, keyRow.userId, requestPayload.model))) {
      return res.status(403).json({
        error: {
          message: `This API key is scoped exclusively to combo "${keyRow.allowedCombo}".`,
          type: "permission_error",
        },
      });
    }

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    const responseId = `resp_${crypto.randomBytes(10).toString("hex")}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const parallelToolCalls =
      typeof body.parallel_tool_calls === "boolean"
        ? body.parallel_tool_calls
        : true;

    if (requestPayload.stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      req.socket?.setNoDelay?.(true);
      res.flushHeaders?.();

      let seq = 0;
      const emitEvent = (eventType: string, data: Record<string, unknown>) => {
        const frame = {
          type: eventType,
          sequence_number: seq++,
          ...data,
        };
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(frame)}\n\n`);
      };

      const baseShell = (
        status: "in_progress" | "completed" | "incomplete" | "failed",
        extra?: Partial<Parameters<typeof buildResponsesObject>[0]>
      ) =>
        buildResponsesObject({
          id: responseId,
          createdAt,
          model: requestPayload.model,
          status,
          output: extra?.output ?? [],
          outputText: extra?.outputText,
          instructions: body.instructions ?? null,
          maxOutputTokens: requestPayload.max_tokens ?? null,
          temperature: requestPayload.temperature ?? 1,
          topP: requestPayload.top_p ?? 1,
          parallelToolCalls,
          incompleteReason: extra?.incompleteReason,
          error: extra?.error,
          usage: extra?.usage,
          meta: extra?.meta,
        });

      emitEvent("response.created", { response: baseShell("in_progress") });
      emitEvent("response.in_progress", { response: baseShell("in_progress") });

      let nextOutputIndex = 0;
      let activeMsgItem: {
        id: string;
        outputIndex: number;
        text: string;
      } | null = null;
      const completedOutputItems: Array<Record<string, unknown>> = [];
      const streamedTools = new Map<
        number,
        {
          id: string;
          callId: string;
          name: string;
          outputIndex: number;
          arguments: string;
        }
      >();

      const closeActiveMsgItem = () => {
        if (!activeMsgItem) return;
        const item = activeMsgItem;
        activeMsgItem = null;
        emitEvent("response.output_text.done", {
          item_id: item.id,
          output_index: item.outputIndex,
          content_index: 0,
          text: item.text,
        });
        const part = {
          type: "output_text",
          text: item.text,
          annotations: [],
        };
        emitEvent("response.content_part.done", {
          item_id: item.id,
          output_index: item.outputIndex,
          content_index: 0,
          part,
        });
        const doneItem = {
          id: item.id,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [part],
        };
        emitEvent("response.output_item.done", {
          output_index: item.outputIndex,
          item: doneItem,
        });
        completedOutputItems.push(doneItem);
      };

      try {
        const result = await executeGatewayChatCompletion({
          userId: keyRow.userId,
          apiKeyId: keyRow.id,
          apiKeyPrefix: keyRow.keyPrefix,
          request: requestPayload,
          freeOnly: Boolean(keyRow.freeOnly),
          signal: abortController.signal,
          onStreamDelta: (delta) => {
            if (abortController.signal.aborted) return;
            if (delta.content) {
              if (!activeMsgItem) {
                const msgId = `msg_${crypto.randomBytes(10).toString("hex")}`;
                const outputIndex = nextOutputIndex++;
                activeMsgItem = {
                  id: msgId,
                  outputIndex,
                  text: "",
                };
                emitEvent("response.output_item.added", {
                  output_index: outputIndex,
                  item: {
                    id: msgId,
                    type: "message",
                    status: "in_progress",
                    role: "assistant",
                    content: [],
                  },
                });
                emitEvent("response.content_part.added", {
                  item_id: msgId,
                  output_index: outputIndex,
                  content_index: 0,
                  part: {
                    type: "output_text",
                    text: "",
                    annotations: [],
                  },
                });
              }
              activeMsgItem.text += delta.content;
              emitEvent("response.output_text.delta", {
                item_id: activeMsgItem.id,
                output_index: activeMsgItem.outputIndex,
                content_index: 0,
                delta: delta.content,
              });
            }

            if (Array.isArray(delta.tool_calls)) {
              if (activeMsgItem) {
                closeActiveMsgItem();
              }
              for (const tc of delta.tool_calls) {
                const tcIdx = typeof tc.index === "number" ? tc.index : 0;
                let tracked = streamedTools.get(tcIdx);
                if (!tracked) {
                  const outputIndex = nextOutputIndex++;
                  const fcId = `fc_${crypto.randomBytes(8).toString("hex")}`;
                  const callId =
                    tc.id || `call_${crypto.randomBytes(6).toString("hex")}`;
                  const name = tc.function?.name || "function";
                  tracked = {
                    id: fcId,
                    callId,
                    name,
                    outputIndex,
                    arguments: "",
                  };
                  streamedTools.set(tcIdx, tracked);
                  emitEvent("response.output_item.added", {
                    output_index: outputIndex,
                    item: {
                      id: fcId,
                      type: "function_call",
                      status: "in_progress",
                      call_id: callId,
                      name,
                      arguments: "",
                    },
                  });
                }
                if (tc.function?.arguments) {
                  tracked.arguments += tc.function.arguments;
                  emitEvent("response.function_call_arguments.delta", {
                    item_id: tracked.id,
                    output_index: tracked.outputIndex,
                    delta: tc.function.arguments,
                  });
                }
              }
            }
          },
        });

        if (abortController.signal.aborted) {
          return res.end();
        }

        if (activeMsgItem) {
          closeActiveMsgItem();
        }

        if (streamedTools.size > 0) {
          const ordered = Array.from(streamedTools.entries()).sort(
            (a, b) => a[0] - b[0]
          );
          for (const [, tracked] of ordered) {
            emitEvent("response.function_call_arguments.done", {
              item_id: tracked.id,
              output_index: tracked.outputIndex,
              arguments: tracked.arguments,
            });
            const doneFc = {
              id: tracked.id,
              type: "function_call",
              status: "completed",
              call_id: tracked.callId,
              name: tracked.name,
              arguments: tracked.arguments,
            };
            emitEvent("response.output_item.done", {
              output_index: tracked.outputIndex,
              item: doneFc,
            });
            completedOutputItems.push(doneFc);
          }
        } else if (result.toolCalls && result.toolCalls.length > 0) {
          for (const tc of result.toolCalls) {
            const outputIndex = nextOutputIndex++;
            const fcId = `fc_${crypto.randomBytes(8).toString("hex")}`;
            const args = tc.function.arguments || "{}";
            emitEvent("response.output_item.added", {
              output_index: outputIndex,
              item: {
                id: fcId,
                type: "function_call",
                status: "in_progress",
                call_id: tc.id,
                name: tc.function.name,
                arguments: "",
              },
            });
            emitEvent("response.function_call_arguments.delta", {
              item_id: fcId,
              output_index: outputIndex,
              delta: args,
            });
            emitEvent("response.function_call_arguments.done", {
              item_id: fcId,
              output_index: outputIndex,
              arguments: args,
            });
            const doneFc = {
              id: fcId,
              type: "function_call",
              status: "completed",
              call_id: tc.id,
              name: tc.function.name,
              arguments: args,
            };
            emitEvent("response.output_item.done", {
              output_index: outputIndex,
              item: doneFc,
            });
            completedOutputItems.push(doneFc);
          }
        }

        if (completedOutputItems.length === 0) {
          const msgId = `msg_${crypto.randomBytes(10).toString("hex")}`;
          const outputIndex = nextOutputIndex++;
          const text = result.content || "";
          const part = { type: "output_text", text, annotations: [] };
          emitEvent("response.output_item.added", {
            output_index: outputIndex,
            item: {
              id: msgId,
              type: "message",
              status: "in_progress",
              role: "assistant",
              content: [],
            },
          });
          emitEvent("response.content_part.added", {
            item_id: msgId,
            output_index: outputIndex,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
          emitEvent("response.output_text.done", {
            item_id: msgId,
            output_index: outputIndex,
            content_index: 0,
            text,
          });
          emitEvent("response.content_part.done", {
            item_id: msgId,
            output_index: outputIndex,
            content_index: 0,
            part,
          });
          const doneItem = {
            id: msgId,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [part],
          };
          emitEvent("response.output_item.done", {
            output_index: outputIndex,
            item: doneItem,
          });
          completedOutputItems.push(doneItem);
        }

        const isIncomplete = result.finishReason === "length";
        const finalResponse = baseShell(
          isIncomplete ? "incomplete" : "completed",
          {
            output: completedOutputItems,
            outputText: result.content || "",
            incompleteReason: isIncomplete ? "max_output_tokens" : null,
            usage: {
              promptTokens: result.promptTokens,
              completionTokens: result.completionTokens,
            },
            meta: {
              resolved_provider: result.resolvedProvider,
              resolved_model: result.resolvedModel,
              combo: result.comboName,
              detected_intent: result.detectedIntent,
              latency_ms: result.latencyMs,
              compressed: result.compressed,
              cached: Boolean(result.cached),
              fallback_hops: result.fallbackAttempts,
            },
          }
        );

        emitEvent(
          isIncomplete ? "response.incomplete" : "response.completed",
          { response: finalResponse }
        );
        return res.end();
      } catch (streamErr: unknown) {
        if (!abortController.signal.aborted) {
          const message =
            streamErr instanceof Error
              ? streamErr.message
              : "Responses stream error";
          const failedResponse = baseShell("failed", {
            output: completedOutputItems,
            error: { code: "gateway_error", message },
          });
          emitEvent("response.failed", { response: failedResponse });
        }
        return res.end();
      }
    }

    const result = await executeGatewayChatCompletion({
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      apiKeyPrefix: keyRow.keyPrefix,
      request: requestPayload,
      freeOnly: Boolean(keyRow.freeOnly),
      signal: abortController.signal,
    });

    const output: Array<Record<string, unknown>> = [];
    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const tc of result.toolCalls) {
        output.push({
          id: `fc_${crypto.randomBytes(8).toString("hex")}`,
          type: "function_call",
          status: "completed",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments || "{}",
        });
      }
    }
    if (result.content || output.length === 0) {
      output.push({
        id: `msg_${crypto.randomBytes(10).toString("hex")}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: result.content || "",
            annotations: [],
          },
        ],
      });
    }

    const isIncomplete = result.finishReason === "length";
    return res.json(
      buildResponsesObject({
        id: responseId,
        createdAt,
        model: requestPayload.model,
        status: isIncomplete ? "incomplete" : "completed",
        output,
        outputText: result.content || "",
        instructions: body.instructions ?? null,
        maxOutputTokens: requestPayload.max_tokens ?? null,
        temperature: requestPayload.temperature ?? 1,
        topP: requestPayload.top_p ?? 1,
        parallelToolCalls,
        incompleteReason: isIncomplete ? "max_output_tokens" : null,
        usage: {
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        },
        meta: {
          resolved_provider: result.resolvedProvider,
          resolved_model: result.resolvedModel,
          combo: result.comboName,
          detected_intent: result.detectedIntent,
          latency_ms: result.latencyMs,
          compressed: result.compressed,
          cached: Boolean(result.cached),
          fallback_hops: result.fallbackAttempts,
        },
      })
    );
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Gateway failure";
    return res.status(status).json({
      error: {
        message,
        type:
          status === 401
            ? "auth_error"
            : status === 429
              ? "rate_limit_error"
              : "gateway_error",
      },
    });
  }
});

gatewayRouter.post("/messages", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const body = (req.body || {}) as {
      model?: string;
      system?: string | Array<{ type?: string; text?: string }>;
      messages?: Array<{
        role?: "user" | "assistant";
        content?:
          | string
          | Array<{
              type?: string;
              text?: string;
              id?: string;
              name?: string;
              input?: Record<string, unknown>;
              tool_use_id?: string;
              content?: string | Array<{ type?: string; text?: string }>;
              source?: {
                type?: string;
                media_type?: string;
                data?: string;
                url?: string;
              };
            }>;
      }>;
      max_tokens?: number;
      temperature?: number;
      top_p?: number;
      stop_sequences?: string[];
      stream?: boolean;
      tools?: Array<{
        name?: string;
        description?: string;
        input_schema?: Record<string, unknown>;
      }>;
      tool_choice?: { type?: string; name?: string };
    };

    if (!body.model || !Array.isArray(body.messages)) {
      return res.status(400).json({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Request must include 'model' and 'messages' array.",
        },
      });
    }

    if (!(await isModelAllowedForKey(keyRow.allowedCombo, keyRow.userId, body.model))) {
      return res.status(403).json({
        type: "error",
        error: {
          type: "permission_error",
          message: `This API key is scoped exclusively to combo "${keyRow.allowedCombo}".`,
        },
      });
    }

    const translatedMessages: OpenAIChatMessage[] = [];

    if (typeof body.system === "string" && body.system.trim()) {
      translatedMessages.push({ role: "system", content: body.system });
    } else if (Array.isArray(body.system)) {
      const sysText = body.system
        .map((b) => (typeof b?.text === "string" ? b.text : ""))
        .filter(Boolean)
        .join("\n");
      if (sysText) {
        translatedMessages.push({ role: "system", content: sysText });
      }
    }

    for (const msg of body.messages) {
      const role = msg.role === "assistant" ? "assistant" : "user";
      if (typeof msg.content === "string") {
        translatedMessages.push({ role, content: msg.content });
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      if (role === "assistant") {
        const textParts = msg.content
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text || "")
          .join("");
        const toolUses = msg.content
          .filter((b) => b.type === "tool_use" && b.name)
          .map((b) => ({
            id: b.id || `toolu_${crypto.randomBytes(6).toString("hex")}`,
            type: "function" as const,
            function: {
              name: b.name!,
              arguments: JSON.stringify(b.input || {}),
            },
          }));
        translatedMessages.push({
          role: "assistant",
          content: textParts || null,
          ...(toolUses.length > 0 ? { tool_calls: toolUses } : {}),
        });
      } else {
        const toolResults = msg.content.filter((b) => b.type === "tool_result");
        for (const tr of toolResults) {
          const rawText =
            typeof tr.content === "string"
              ? tr.content
              : Array.isArray(tr.content)
                ? tr.content.map((x) => x.text || "").join("\n")
                : "";
          translatedMessages.push({
            role: "tool",
            tool_call_id: tr.tool_use_id || "tool_0",
            content: rawText,
          });
        }

        const userParts: OpenAIContentPart[] = [];
        for (const b of msg.content) {
          if (b.type === "text" && b.text) {
            userParts.push({ type: "text", text: b.text });
          } else if (b.type === "image" && b.source) {
            if (b.source.type === "base64" && b.source.data) {
              const mime = b.source.media_type || "image/png";
              userParts.push({
                type: "image_url",
                image_url: { url: `data:${mime};base64,${b.source.data}` },
              });
            } else if (b.source.url) {
              userParts.push({
                type: "image_url",
                image_url: { url: b.source.url },
              });
            }
          }
        }
        if (userParts.length > 0) {
          translatedMessages.push({
            role: "user",
            content:
              userParts.length === 1 && userParts[0].type === "text"
                ? userParts[0].text
                : userParts,
          });
        }
      }
    }

    const translatedTools: OpenAIToolDefinition[] | undefined = Array.isArray(
      body.tools
    )
      ? body.tools
          .filter((t) => Boolean(t?.name))
          .map((t) => ({
            type: "function",
            function: {
              name: t.name!,
              description: t.description,
              parameters: t.input_schema,
            },
          }))
      : undefined;

    let translatedToolChoice: NormalizedCompletionRequest["tool_choice"];
    if (body.tool_choice?.type === "any") {
      translatedToolChoice = "required";
    } else if (body.tool_choice?.type === "none") {
      translatedToolChoice = "none";
    } else if (body.tool_choice?.type === "tool" && body.tool_choice.name) {
      translatedToolChoice = {
        type: "function",
        function: { name: body.tool_choice.name },
      };
    } else if (body.tool_choice?.type === "auto") {
      translatedToolChoice = "auto";
    }

    const rawMaxTokens = Number(body.max_tokens);
    const boundedMaxTokens =
      Number.isFinite(rawMaxTokens) && rawMaxTokens > 0
        ? Math.min(Math.round(rawMaxTokens), 65536)
        : 2048;

    const requestPayload: NormalizedCompletionRequest = {
      model: body.model,
      messages: translatedMessages,
      stream: Boolean(body.stream),
      temperature: body.temperature,
      max_tokens: boundedMaxTokens,
      top_p: body.top_p,
      stop: Array.isArray(body.stop_sequences) ? body.stop_sequences : undefined,
      tools: translatedTools,
      tool_choice: translatedToolChoice,
    };

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    if (requestPayload.stream) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      req.socket?.setNoDelay?.(true);
      res.flushHeaders?.();

      const msgId = `msg_${crypto.randomBytes(10).toString("hex")}`;
      let nextBlockIndex = 0;
      let textBlockIdx: number | null = null;
      const streamedToolBlocks = new Map<
        number,
        { blockIdx: number; id: string; name: string }
      >();

      res.write(
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: {
            id: msgId,
            type: "message",
            role: "assistant",
            model: requestPayload.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })}\n\n`
      );

      try {
        const result = await executeGatewayChatCompletion({
          userId: keyRow.userId,
          apiKeyId: keyRow.id,
          apiKeyPrefix: keyRow.keyPrefix,
          request: requestPayload,
          freeOnly: Boolean(keyRow.freeOnly),
          signal: abortController.signal,
          onStreamDelta: (delta) => {
            if (abortController.signal.aborted) return;
            if (delta.content) {
              if (textBlockIdx === null) {
                textBlockIdx = nextBlockIndex++;
                res.write(
                  `event: content_block_start\ndata: ${JSON.stringify({
                    type: "content_block_start",
                    index: textBlockIdx,
                    content_block: { type: "text", text: "" },
                  })}\n\n`
                );
              }
              res.write(
                `event: content_block_delta\ndata: ${JSON.stringify({
                  type: "content_block_delta",
                  index: textBlockIdx,
                  delta: { type: "text_delta", text: delta.content },
                })}\n\n`
              );
            }
            if (Array.isArray(delta.tool_calls)) {
              if (textBlockIdx !== null) {
                res.write(
                  `event: content_block_stop\ndata: ${JSON.stringify({
                    type: "content_block_stop",
                    index: textBlockIdx,
                  })}\n\n`
                );
                textBlockIdx = null;
              }
              for (const tc of delta.tool_calls) {
                const tcIdx = typeof tc.index === "number" ? tc.index : 0;
                let tracked = streamedToolBlocks.get(tcIdx);
                if (!tracked) {
                  const blockIdx = nextBlockIndex++;
                  tracked = {
                    blockIdx,
                    id: tc.id || `toolu_${crypto.randomBytes(6).toString("hex")}`,
                    name: tc.function?.name || "function",
                  };
                  streamedToolBlocks.set(tcIdx, tracked);
                  res.write(
                    `event: content_block_start\ndata: ${JSON.stringify({
                      type: "content_block_start",
                      index: tracked.blockIdx,
                      content_block: {
                        type: "tool_use",
                        id: tracked.id,
                        name: tracked.name,
                        input: {},
                      },
                    })}\n\n`
                  );
                }
                if (tc.function?.arguments) {
                  res.write(
                    `event: content_block_delta\ndata: ${JSON.stringify({
                      type: "content_block_delta",
                      index: tracked.blockIdx,
                      delta: {
                        type: "input_json_delta",
                        partial_json: tc.function.arguments,
                      },
                    })}\n\n`
                  );
                }
              }
            }
          },
        });

        if (abortController.signal.aborted) {
          return res.end();
        }

        if (textBlockIdx !== null) {
          res.write(
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: textBlockIdx,
            })}\n\n`
          );
          textBlockIdx = null;
        }

        if (streamedToolBlocks.size > 0) {
          for (const tracked of streamedToolBlocks.values()) {
            res.write(
              `event: content_block_stop\ndata: ${JSON.stringify({
                type: "content_block_stop",
                index: tracked.blockIdx,
              })}\n\n`
            );
          }
        } else if (result.toolCalls && result.toolCalls.length > 0) {
          for (const tc of result.toolCalls) {
            const blockIdx = nextBlockIndex++;
            let parsedInput: Record<string, unknown> = {};
            try {
              parsedInput = JSON.parse(tc.function.arguments || "{}");
            } catch {
              parsedInput = {};
            }
            res.write(
              `event: content_block_start\ndata: ${JSON.stringify({
                type: "content_block_start",
                index: blockIdx,
                content_block: {
                  type: "tool_use",
                  id: tc.id,
                  name: tc.function.name,
                  input: parsedInput,
                },
              })}\n\n`
            );
            res.write(
              `event: content_block_stop\ndata: ${JSON.stringify({
                type: "content_block_stop",
                index: blockIdx,
              })}\n\n`
            );
          }
        }

        const stopReason =
          result.finishReason === "tool_calls"
            ? "tool_use"
            : result.finishReason === "length"
              ? "max_tokens"
              : "end_turn";

        res.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: result.completionTokens },
          })}\n\n`
        );
        res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
        return res.end();
      } catch (streamErr: unknown) {
        if (!abortController.signal.aborted) {
          const message =
            streamErr instanceof Error
              ? streamErr.message
              : "Anthropic stream error";
          res.write(
            `event: error\ndata: ${JSON.stringify({
              type: "error",
              error: { type: "api_error", message },
            })}\n\n`
          );
        }
        return res.end();
      }
    }

    const result = await executeGatewayChatCompletion({
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      apiKeyPrefix: keyRow.keyPrefix,
      request: requestPayload,
      freeOnly: Boolean(keyRow.freeOnly),
      signal: abortController.signal,
    });

    const contentBlocks: Array<Record<string, unknown>> = [];
    if (result.content) {
      contentBlocks.push({ type: "text", text: result.content });
    }
    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const tc of result.toolCalls) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = JSON.parse(tc.function.arguments || "{}");
        } catch {
          parsedInput = {};
        }
        contentBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: parsedInput,
        });
      }
    }
    if (contentBlocks.length === 0) {
      contentBlocks.push({ type: "text", text: "" });
    }

    const stopReason =
      result.finishReason === "tool_calls"
        ? "tool_use"
        : result.finishReason === "length"
          ? "max_tokens"
          : "end_turn";

    return res.json({
      id: `msg_${crypto.randomBytes(10).toString("hex")}`,
      type: "message",
      role: "assistant",
      model: requestPayload.model,
      content: contentBlocks,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: result.promptTokens,
        output_tokens: result.completionTokens,
      },
    });
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Gateway failure";
    return res.status(status).json({
      type: "error",
      error: {
        type: status === 429 ? "rate_limit_error" : "api_error",
        message,
      },
    });
  }
});

gatewayRouter.post("/messages/count_tokens", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const body = (req.body || {}) as {
      model?: string;
      system?: unknown;
      messages?: unknown;
      tools?: unknown;
    };

    if (!body.model || !Array.isArray(body.messages)) {
      return res.status(400).json({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Request must include 'model' and 'messages' array.",
        },
      });
    }

    if (!(await isModelAllowedForKey(keyRow.allowedCombo, keyRow.userId, body.model))) {
      return res.status(403).json({
        type: "error",
        error: {
          type: "permission_error",
          message: `This API key is scoped exclusively to combo "${keyRow.allowedCombo}".`,
        },
      });
    }

    const serialized = JSON.stringify({
      system: body.system ?? "",
      messages: body.messages,
      tools: body.tools ?? [],
    });
    const estimatedTokens = Math.max(1, Math.ceil(serialized.length / 4));
    return res.json({ input_tokens: estimatedTokens });
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Token count failure";
    return res.status(status).json({
      type: "error",
      error: {
        type: status === 401 ? "authentication_error" : "api_error",
        message,
      },
    });
  }
});

gatewayRouter.post("/embeddings", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const body = (req.body || {}) as {
      model?: string;
      input?: string | string[];
      dimensions?: number;
      encoding_format?: string;
    };

    if (!body.model || body.input === undefined) {
      return res.status(400).json({
        error: {
          message: "Request must include 'model' and 'input'.",
          type: "invalid_request_error",
        },
      });
    }

    const slashIdx = body.model.indexOf("/");
    const providerHint =
      slashIdx > 0
        ? body.model.slice(0, slashIdx).toLowerCase()
        : body.model.toLowerCase().includes("gemini") ||
            body.model.toLowerCase().includes("embedding-001")
          ? "gemini"
          : "openai";
    const cleanModel =
      slashIdx > 0 ? body.model.slice(slashIdx + 1) : body.model;

    const userConns = await db
      .select()
      .from(providerConnections)
      .where(
        and(
          eq(providerConnections.userId, keyRow.userId),
          eq(providerConnections.isActive, true)
        )
      );

    const llmConns = userConns.filter((c) => !isSearchProvider(c.provider));
    const conn =
      llmConns.find(
        (c) =>
          c.provider === providerHint ||
          getConnectionPrefix(c) === providerHint
      ) ||
      llmConns.find((c) =>
        [
          "openai",
          "openrouter",
          "mistral",
          "together",
          "fireworks",
          "custom",
          "gemini",
        ].includes(c.provider)
      );

    if (!conn) {
      return res.status(404).json({
        error: {
          message: `No active embedding-compatible provider connection found for "${body.model}".`,
          type: "invalid_request_error",
        },
      });
    }

    const keys = decryptConnectionAllKeys(conn);
    const apiKey = keys[0];
    if (!apiKey) {
      return res.status(401).json({
        error: {
          message: "Selected provider connection has no usable API key.",
          type: "auth_error",
        },
      });
    }

    if (conn.provider === "gemini") {
      const inputs = Array.isArray(body.input) ? body.input : [String(body.input)];
      const cleanBase = (
        await validateOutboundUrlWithDns(
          (conn.baseUrl || "https://generativelanguage.googleapis.com")
            .trim()
            .replace(/\/+$/, "")
            .replace(/\/v1beta$/, ""),
          "provider base URL"
        )
      )
        .toString()
        .replace(/\/+$/, "");

      const data = await Promise.all(
        inputs.map(async (text, index) => {
          const r = await fetch(
            `${cleanBase}/v1beta/models/${encodeURIComponent(cleanModel)}:embedContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: `models/${cleanModel}`,
                content: { parts: [{ text }] },
              }),
              signal: AbortSignal.timeout(15000),
            }
          );
          if (!r.ok) {
            throw new UpstreamHttpError(await r.text(), r.status, false);
          }
          const json = (await r.json()) as {
            embedding?: { values?: number[] };
          };
          return {
            object: "embedding",
            index,
            embedding: json.embedding?.values || [],
          };
        })
      );

      return res.json({
        object: "list",
        data,
        model: cleanModel,
        usage: { prompt_tokens: 0, total_tokens: 0 },
      });
    }

    const spec = getProviderSpec(conn.provider);
    const base = (conn.baseUrl || spec.defaultBaseUrl).replace(/\/+$/, "");
    const endpoint = (
      await validateOutboundUrlWithDns(`${base}/embeddings`, "provider base URL")
    ).toString();
    const upstreamRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cleanModel,
        input: body.input,
        ...(body.dimensions ? { dimensions: body.dimensions } : {}),
        ...(body.encoding_format
          ? { encoding_format: body.encoding_format }
          : {}),
      }),
      signal: AbortSignal.timeout(20000),
    });

    const payload = await upstreamRes.json();
    return res.status(upstreamRes.status).json(payload);
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Embeddings failure";
    return res.status(status).json({
      error: { message, type: "gateway_error" },
    });
  }
});

gatewayRouter.post("/search", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const body = (req.body || {}) as {
      query?: unknown;
      search_depth?: "basic" | "advanced";
      topic?: "general" | "news" | "finance";
      max_results?: number;
      include_answer?: boolean | "basic" | "advanced";
      include_raw_content?: boolean | "markdown" | "text";
      include_domains?: unknown;
      exclude_domains?: unknown;
      time_range?: "day" | "week" | "month" | "year";
      days?: number;
      provider?: "auto" | "tavily" | "brave-search" | "exa" | "builtin";
    };

    if (!body.query || typeof body.query !== "string" || !body.query.trim()) {
      return res.status(400).json({
        error: {
          message: "Request must include a non-empty 'query' string.",
          type: "invalid_request_error",
        },
      });
    }

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    const result = await executeGatewaySearch({
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      apiKeyPrefix: keyRow.keyPrefix,
      signal: abortController.signal,
      request: {
        query: body.query.trim(),
        search_depth: body.search_depth === "advanced" ? "advanced" : "basic",
        topic:
          body.topic === "news" || body.topic === "finance"
            ? body.topic
            : "general",
        max_results:
          typeof body.max_results === "number"
            ? Math.min(20, Math.max(1, Math.round(body.max_results)))
            : 5,
        include_answer: Boolean(body.include_answer),
        include_raw_content: body.include_raw_content,
        include_domains: Array.isArray(body.include_domains)
          ? body.include_domains.map(String)
          : undefined,
        exclude_domains: Array.isArray(body.exclude_domains)
          ? body.exclude_domains.map(String)
          : undefined,
        time_range: body.time_range,
        days: typeof body.days === "number" ? body.days : undefined,
        provider: body.provider || "auto",
      },
    });

    return res.json(result);
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : "Search gateway failure";
    return res.status(status).json({
      error: {
        message,
        type: status === 401 ? "auth_error" : status === 429 ? "rate_limit_error" : "gateway_error",
      },
    });
  }
});

gatewayRouter.post("/extract", async (req: Request, res: Response) => {
  try {
    const keyRow = await authenticateGatewayKey(req);
    const body = (req.body || {}) as {
      urls?: unknown;
      extract_depth?: "basic" | "advanced";
      query?: string;
      format?: "markdown" | "text";
      provider?: "auto" | "tavily" | "exa" | "builtin";
    };

    const rawUrls = Array.isArray(body.urls)
      ? body.urls
      : typeof body.urls === "string"
        ? [body.urls]
        : [];
    const urls = rawUrls.map((u) => String(u || "").trim()).filter(Boolean);

    if (urls.length === 0) {
      return res.status(400).json({
        error: {
          message: "Request must include 'urls' (string or array of URLs).",
          type: "invalid_request_error",
        },
      });
    }

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    const result = await executeGatewayExtract({
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      apiKeyPrefix: keyRow.keyPrefix,
      signal: abortController.signal,
      request: {
        urls,
        extract_depth:
          body.extract_depth === "advanced" ? "advanced" : "basic",
        query: typeof body.query === "string" ? body.query.trim() : undefined,
        format: body.format === "text" ? "text" : "markdown",
        provider: body.provider || "auto",
      },
    });

    return res.json(result);
  } catch (err: unknown) {
    const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
    const message =
      err instanceof Error ? err.message : "Extract gateway failure";
    return res.status(status).json({
      error: {
        message,
        type: status === 401 ? "auth_error" : status === 429 ? "rate_limit_error" : "gateway_error",
      },
    });
  }
});

