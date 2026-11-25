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

