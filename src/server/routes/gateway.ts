import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { db, ensureSchema } from "../../db/index.ts";
import {
  combos,
  gatewayApiKeys,
  providerConnections,
} from "../../db/schema.ts";
import { isModelKnownFree, PROVIDER_CATALOG } from "../../shared/catalog.ts";
import { hashGatewayApiKey } from "../crypto.ts";
import {
  type NormalizedCompletionRequest,
  type OpenAIChatMessage,
  type OpenAIContentPart,
  type OpenAIToolDefinition,
  UpstreamHttpError,
} from "../providers.ts";
import { executeGatewayChatCompletion } from "../routerEngine.ts";
import { parseAvailableModels } from "../utils/connections.ts";

export const gatewayRouter = Router();

async function authenticateGatewayKey(req: Request) {
  await ensureSchema();
  const authHeader = req.headers.authorization || "";
  const xApiKeyHeader =
    typeof req.headers["x-api-key"] === "string"
      ? req.headers["x-api-key"].trim()
      : "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : xApiKeyHeader;

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
      const connModels = Array.from(
        new Set([
          ...(conn.defaultModel ? [conn.defaultModel] : []),
          ...parseAvailableModels(conn.availableModels),
        ])
      );
      for (const m of connModels) {
        if (keyRow.freeOnly && !isModelKnownFree(conn.provider, m)) continue;
        const modelKey = `${conn.provider}/${m}`;
        if (!seenIds.has(modelKey)) {
          seenIds.add(modelKey);
          models.push({
            id: modelKey,
            object: "model",
            created: Math.floor(conn.createdAt.getTime() / 1000),
            owned_by: conn.provider,
          });
        }
      }
    }

    for (const p of PROVIDER_CATALOG) {
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

    if (
      keyRow.allowedCombo &&
      keyRow.allowedCombo !== "*" &&
      keyRow.allowedCombo !== body.model
    ) {
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

    if (
      keyRow.allowedCombo &&
      keyRow.allowedCombo !== "*" &&
      keyRow.allowedCombo !== body.model
    ) {
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

    const requestPayload: NormalizedCompletionRequest = {
      model: body.model,
      messages: translatedMessages,
      stream: Boolean(body.stream),
      temperature: body.temperature,
      max_tokens: body.max_tokens ?? 2048,
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
      res.flushHeaders?.();

      const msgId = `msg_${crypto.randomBytes(10).toString("hex")}`;
      let blockOpened = false;

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
              if (!blockOpened) {
                blockOpened = true;
                res.write(
                  `event: content_block_start\ndata: ${JSON.stringify({
                    type: "content_block_start",
                    index: 0,
                    content_block: { type: "text", text: "" },
                  })}\n\n`
                );
              }
              res.write(
                `event: content_block_delta\ndata: ${JSON.stringify({
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: delta.content },
                })}\n\n`
              );
            }
          },
        });

        if (abortController.signal.aborted) {
          return res.end();
        }

        if (blockOpened) {
          res.write(
            `event: content_block_stop\ndata: ${JSON.stringify({
              type: "content_block_stop",
              index: 0,
            })}\n\n`
          );
        }

        if (result.toolCalls && result.toolCalls.length > 0) {
          let blockIdx = blockOpened ? 1 : 0;
          for (const tc of result.toolCalls) {
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
            blockIdx++;
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
