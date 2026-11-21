import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import {
  databaseMode,
  db,
  ensureSchema,
  isNeonConfigured,
} from "./src/db/index.ts";
import {
  account,
  combos,
  comboTiers,
  gatewayApiKeys,
  providerConnections,
  requestLogs,
  wildcardRoutes,
} from "./src/db/schema.ts";
import { auth } from "./src/server/auth.ts";
import {
  decryptSecret,
  encryptSecret,
  generateGatewayApiKey,
  hashGatewayApiKey,
  maskSecret,
} from "./src/server/crypto.ts";
import {
  fetchProviderModels,
  type NormalizedCompletionRequest,
  type OpenAIChatMessage,
  type OpenAIContentPart,
  type OpenAIToolDefinition,
  probeProviderFreeModels,
  testProviderConnection,
  UpstreamHttpError,
} from "./src/server/providers.ts";
import {
  clearGatewayResponseCache,
  executeGatewayChatCompletion,
  simulateComboRoute,
} from "./src/server/routerEngine.ts";
import { subscribeUserLogs } from "./src/server/sse.ts";
import { isModelKnownFree, PROVIDER_CATALOG } from "./src/shared/catalog.ts";
import type { ModelHealthEntry } from "./src/types/gateway.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AuthedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
    name: string;
  };
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const authHandler = toNodeHandler(auth);

app.set("trust proxy", 1);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

// Better Auth handler MUST precede express.json()
app.all("/api/auth/*", async (req: Request, res: Response) => {
  try {
    await ensureSchema();
    return authHandler(req, res);
  } catch (err) {
    console.error("[AS ROUTER] Auth handler error:", err);
    return res.status(500).json({ error: "Authentication service error" });
  }
});

app.use(express.json({ limit: "4mb" }));

async function requireSession(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    await ensureSchema();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.authUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    };
    return next();
  } catch (err) {
    console.error("[AS ROUTER] Session check failed:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function parseAvailableModels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
  } catch {
    return [];
  }
}

function serializeAvailableModels(input: unknown): string | null {
  if (!Array.isArray(input)) return null;
  const cleaned = Array.from(
    new Set(
      input
        .filter((item): item is string => typeof item === "string")
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

function parseModelHealth(raw: string | null | undefined): Record<string, ModelHealthEntry> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, ModelHealthEntry>) : {};
  } catch {
    return {};
  }
}

function parseExtraApiKeyInput(input: unknown): string[] {
  if (Array.isArray(input)) {
    return Array.from(
      new Set(
        input
          .filter((item): item is string => typeof item === "string")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
  }
  if (typeof input === "string") {
    return Array.from(
      new Set(
        input
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function serializeEncryptedKeyPool(rawKeys: string[]): string | null {
  if (rawKeys.length === 0) return null;
  const encrypted = rawKeys.map((k) => encryptSecret(k));
  return JSON.stringify(encrypted);
}

function decryptConnectionAllKeys(conn: typeof providerConnections.$inferSelect): string[] {
  const keys: string[] = [];
  if (conn.encryptedApiKey) {
    try {
      const k = decryptSecret(conn.encryptedApiKey);
      if (k) keys.push(k);
    } catch {
      // ignore
    }
  }
  if (conn.encryptedKeyPool) {
    try {
      const parsed = JSON.parse(conn.encryptedKeyPool);
      if (Array.isArray(parsed)) {
        for (const enc of parsed) {
          if (typeof enc === "string" && enc) {
            try {
              const dec = decryptSecret(enc);
              if (dec && !keys.includes(dec)) keys.push(dec);
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return keys;
}

function sanitizeConnection(c: typeof providerConnections.$inferSelect) {
  let maskedKey = "Not set";
  if (c.encryptedApiKey) {
    try {
      maskedKey = maskSecret(decryptSecret(c.encryptedApiKey));
    } catch {
      maskedKey = "Encrypted";
    }
  }

  const maskedPoolKeys: string[] = [];
  if (c.encryptedKeyPool) {
    try {
      const parsed = JSON.parse(c.encryptedKeyPool);
      if (Array.isArray(parsed)) {
        for (const enc of parsed) {
          if (typeof enc === "string" && enc) {
            try {
              maskedPoolKeys.push(maskSecret(decryptSecret(enc)));
            } catch {
              maskedPoolKeys.push("Encrypted");
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const now = new Date();
  const lastReset = c.quotaResetAt ? new Date(c.quotaResetAt) : new Date(0);
  const resetDaily =
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth() ||
    lastReset.getUTCDate() !== now.getUTCDate();
  const resetMonthly =
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth();

  return {
    ...c,
    availableModels: parseAvailableModels(c.availableModels),
    modelHealth: parseModelHealth(c.modelHealth),
    encryptedApiKey: undefined,
    encryptedKeyPool: undefined,
    maskedKey,
    poolKeyCount: maskedPoolKeys.length,
    maskedPoolKeys,
    usedRequestsToday: resetDaily ? 0 : c.usedRequestsToday,
    usedTokensToday: resetDaily ? 0 : c.usedTokensToday,
    usedCostMonth: resetMonthly ? 0 : c.usedCostMonth,
  };
}

function getGatewayBaseUrl(req: Request): string {
  if (process.env.APP_URL?.trim()) {
    return `${process.env.APP_URL.replace(/\/+$/, "")}/v1`;
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host") || `localhost:${PORT}`;
  return `${proto}://${host}/v1`;
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Unified Gateway Endpoints (/v1/*)
// ---------------------------------------------------------------------------

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

  // Quota auto-reset check
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

app.get("/v1/models", async (req: Request, res: Response) => {
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

app.post("/v1/chat/completions", async (req: Request, res: Response) => {
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
          onStreamDelta: (delta) => {
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
        const message =
          streamErr instanceof Error ? streamErr.message : "Gateway stream error";
        res.write(
          `data: ${JSON.stringify({ error: { message } })}\n\n`
        );
        return res.end();
      }
    }

    const result = await executeGatewayChatCompletion({
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      apiKeyPrefix: keyRow.keyPrefix,
      request: requestPayload,
      freeOnly: Boolean(keyRow.freeOnly),
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

// Anthropic Messages API Protocol Bridge (/v1/messages)
app.post("/v1/messages", async (req: Request, res: Response) => {
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
          onStreamDelta: (delta) => {
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
        const message =
          streamErr instanceof Error ? streamErr.message : "Anthropic stream error";
        res.write(
          `event: error\ndata: ${JSON.stringify({
            type: "error",
            error: { type: "api_error", message },
          })}\n\n`
        );
        return res.end();
      }
    }

    const result = await executeGatewayChatCompletion({
      userId: keyRow.userId,
      apiKeyId: keyRow.id,
      apiKeyPrefix: keyRow.keyPrefix,
      request: requestPayload,
      freeOnly: Boolean(keyRow.freeOnly),
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

// ---------------------------------------------------------------------------
// Dashboard Control-Plane REST APIs (/api/*)
// ---------------------------------------------------------------------------

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "AS ROUTER",
    databaseMode,
    neonConfigured: isNeonConfigured,
    googleOAuthEnabled: Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CLIENT_SECRET?.trim()
    ),
  });
});

app.get(
  "/api/bootstrap",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;

      const [keys, conns, userCombos, wildcards, recentLogs, userAccounts] =
        await Promise.all([
          db
            .select()
            .from(gatewayApiKeys)
            .where(eq(gatewayApiKeys.userId, userId))
            .orderBy(desc(gatewayApiKeys.createdAt)),
          db
            .select()
            .from(providerConnections)
            .where(eq(providerConnections.userId, userId))
            .orderBy(desc(providerConnections.createdAt)),
          db
            .select()
            .from(combos)
            .where(eq(combos.userId, userId))
            .orderBy(desc(combos.createdAt)),
          db
            .select()
            .from(wildcardRoutes)
            .where(eq(wildcardRoutes.userId, userId))
            .orderBy(desc(wildcardRoutes.createdAt)),
          db
            .select()
            .from(requestLogs)
            .where(eq(requestLogs.userId, userId))
            .orderBy(desc(requestLogs.createdAt))
            .limit(100),
          db
            .select({
              providerId: account.providerId,
              password: account.password,
            })
            .from(account)
            .where(eq(account.userId, userId)),
        ]);

      const comboIds = userCombos.map((c) => c.id);
      const userTiers =
        comboIds.length > 0
          ? await db
              .select()
              .from(comboTiers)
              .where(inArray(comboTiers.comboId, comboIds))
              .orderBy(asc(comboTiers.priority))
          : [];

      const hasPassword = userAccounts.some(
        (a) => a.providerId === "credential" || Boolean(a.password)
      );
      const authProviders = Array.from(
        new Set(userAccounts.map((a) => a.providerId))
      );

      const sanitizedConnections = conns.map((c) => sanitizeConnection(c));

      const combosWithTiers = userCombos.map((combo) => ({
        ...combo,
        tiers: userTiers.filter((t) => t.comboId === combo.id),
      }));

      return res.json({
        user: {
          ...req.authUser,
          hasPassword,
          authProviders,
        },
        environment: {
          databaseMode,
          neonConfigured: isNeonConfigured,
          gatewayEndpoint: getGatewayBaseUrl(req),
        },
        keys: keys.map((k) => ({ ...k, keyHash: undefined })),
        connections: sanitizedConnections,
        combos: combosWithTiers,
        wildcards,
        logs: recentLogs,
      });
    } catch (err) {
      console.error("[AS ROUTER] Bootstrap error:", err);
      return res.status(500).json({ error: "Failed to load workspace data" });
    }
  }
);

// --- API Keys CRUD ---

app.post(
  "/api/keys",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { name, allowedCombo, freeOnly, dailyTokenLimit, monthlyUsdLimit } =
        req.body || {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Key name is required." });
      }

      const { rawKey, keyPrefix, keyHash } = generateGatewayApiKey();
      const id = `key_${crypto.randomBytes(8).toString("hex")}`;

      const [created] = await db
        .insert(gatewayApiKeys)
        .values({
          id,
          userId,
          name: name.trim(),
          keyPrefix,
          keyHash,
          isActive: true,
          allowedCombo:
            allowedCombo && String(allowedCombo).trim()
              ? String(allowedCombo).trim()
              : null,
          freeOnly: Boolean(freeOnly),
          dailyTokenLimit:
            dailyTokenLimit && Number(dailyTokenLimit) > 0
              ? Number(dailyTokenLimit)
              : null,
          monthlyUsdLimit:
            monthlyUsdLimit && Number(monthlyUsdLimit) > 0
              ? Number(monthlyUsdLimit)
              : null,
        })
        .returning();

      return res.status(201).json({
        key: { ...created, keyHash: undefined },
        rawKey,
      });
    } catch (err) {
      console.error("[AS ROUTER] Create key error:", err);
      return res.status(500).json({ error: "Failed to create API key" });
    }
  }
);

app.patch(
  "/api/keys/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      const {
        isActive,
        name,
        allowedCombo,
        freeOnly,
        dailyTokenLimit,
        monthlyUsdLimit,
      } = req.body || {};

      const updates: Partial<typeof gatewayApiKeys.$inferInsert> = {};
      if (typeof isActive === "boolean") updates.isActive = isActive;
      if (typeof name === "string" && name.trim()) updates.name = name.trim();
      if (allowedCombo !== undefined) {
        updates.allowedCombo = allowedCombo ? String(allowedCombo).trim() : null;
      }
      if (typeof freeOnly === "boolean") {
        updates.freeOnly = freeOnly;
      }
      if (dailyTokenLimit !== undefined) {
        updates.dailyTokenLimit =
          dailyTokenLimit && Number(dailyTokenLimit) > 0
            ? Number(dailyTokenLimit)
            : null;
      }
      if (monthlyUsdLimit !== undefined) {
        updates.monthlyUsdLimit =
          monthlyUsdLimit && Number(monthlyUsdLimit) > 0
            ? Number(monthlyUsdLimit)
            : null;
      }

      const [updated] = await db
        .update(gatewayApiKeys)
        .set(updates)
        .where(
          and(eq(gatewayApiKeys.id, id), eq(gatewayApiKeys.userId, userId))
        )
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "API key not found" });
      }
      return res.json({ key: { ...updated, keyHash: undefined } });
    } catch (err) {
      console.error("[AS ROUTER] Update key error:", err);
      return res.status(500).json({ error: "Failed to update API key" });
    }
  }
);

app.delete(
  "/api/keys/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      await db
        .delete(gatewayApiKeys)
        .where(
          and(eq(gatewayApiKeys.id, id), eq(gatewayApiKeys.userId, userId))
        );
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AS ROUTER] Delete key error:", err);
      return res.status(500).json({ error: "Failed to revoke API key" });
    }
  }
);

// --- Provider Connections CRUD ---

app.post(
  "/api/providers/fetch-models",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { connectionId, provider, baseUrl, apiKey, freeOnly } =
        req.body || {};

      let resolvedProvider = typeof provider === "string" ? provider : "openai";
      let resolvedBaseUrl: string | null =
        typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : null;
      let resolvedApiKey =
        typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : "";

      if (typeof connectionId === "string" && connectionId.trim()) {
        const [existingConn] = await db
          .select()
          .from(providerConnections)
          .where(
            and(
              eq(providerConnections.id, connectionId.trim()),
              eq(providerConnections.userId, userId)
            )
          );
        if (!existingConn) {
          return res
            .status(404)
            .json({ error: "Provider connection not found." });
        }
        if (!provider) resolvedProvider = existingConn.provider;
        if (baseUrl === undefined) resolvedBaseUrl = existingConn.baseUrl;
        if (!resolvedApiKey && existingConn.encryptedApiKey) {
          resolvedApiKey = decryptSecret(existingConn.encryptedApiKey);
        }
      }

      if (!resolvedApiKey) {
        return res
          .status(400)
          .json({ error: "Enter an API key first to fetch models." });
      }

      const models = await fetchProviderModels({
        provider: resolvedProvider,
        apiKey: resolvedApiKey,
        baseUrl: resolvedBaseUrl,
        freeOnly: Boolean(freeOnly),
      });

      if (typeof connectionId === "string" && connectionId.trim()) {
        await db
          .update(providerConnections)
          .set({
            availableModels: JSON.stringify(models),
          })
          .where(
            and(
              eq(providerConnections.id, connectionId.trim()),
              eq(providerConnections.userId, userId)
            )
          );
      }

      return res.json({ models });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch upstream models";
      return res.status(502).json({ error: message });
    }
  }
);

app.post(
  "/api/providers",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const {
        provider,
        name,
        baseUrl,
        defaultModel,
        availableModels,
        apiKey,
        extraApiKeys,
        rpmLimit,
        rpdLimit,
        dailyTokenQuota,
        monthlyUsdQuota,
      } = req.body || {};

      if (!provider || !name || !String(name).trim()) {
        return res
          .status(400)
          .json({ error: "Provider type and connection name are required." });
      }

      if (!apiKey || !String(apiKey).trim()) {
        return res.status(400).json({ error: "Provider API key is required." });
      }

      const rawSecret = String(apiKey).trim();
      const parsedPoolKeys = parseExtraApiKeyInput(extraApiKeys).filter(
        (k) => k !== rawSecret
      );
      const id = `conn_${crypto.randomBytes(8).toString("hex")}`;

      const [created] = await db
        .insert(providerConnections)
        .values({
          id,
          userId,
          provider: String(provider),
          name: String(name).trim(),
          baseUrl: baseUrl && String(baseUrl).trim() ? String(baseUrl).trim() : null,
          defaultModel:
            defaultModel && String(defaultModel).trim()
              ? String(defaultModel).trim()
              : null,
          availableModels: serializeAvailableModels(availableModels),
          encryptedApiKey: encryptSecret(rawSecret),
          encryptedKeyPool: serializeEncryptedKeyPool(parsedPoolKeys),
          useServerKey: false,
          isActive: true,
          rpmLimit:
            rpmLimit && Number(rpmLimit) > 0 ? Math.round(Number(rpmLimit)) : null,
          rpdLimit:
            rpdLimit && Number(rpdLimit) > 0 ? Math.round(Number(rpdLimit)) : null,
          dailyTokenQuota:
            dailyTokenQuota && Number(dailyTokenQuota) > 0
              ? Number(dailyTokenQuota)
              : null,
          monthlyUsdQuota:
            monthlyUsdQuota && Number(monthlyUsdQuota) > 0
              ? Number(monthlyUsdQuota)
              : null,
          circuitStatus: "healthy",
        })
        .returning();

      return res.status(201).json({
        connection: sanitizeConnection(created),
      });
    } catch (err) {
      console.error("[AS ROUTER] Create provider error:", err);
      return res.status(500).json({ error: "Failed to create provider connection" });
    }
  }
);

app.patch(
  "/api/providers/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      const {
        isActive,
        name,
        baseUrl,
        defaultModel,
        availableModels,
        apiKey,
        extraApiKeys,
        clearKeyPool,
        rpmLimit,
        rpdLimit,
        dailyTokenQuota,
        monthlyUsdQuota,
      } = req.body || {};

      const updates: Partial<typeof providerConnections.$inferInsert> = {};
      if (typeof isActive === "boolean") updates.isActive = isActive;
      if (typeof name === "string" && name.trim()) updates.name = name.trim();
      if (baseUrl !== undefined) {
        updates.baseUrl = baseUrl ? String(baseUrl).trim() : null;
      }
      if (defaultModel !== undefined) {
        updates.defaultModel =
          defaultModel && String(defaultModel).trim()
            ? String(defaultModel).trim()
            : null;
      }
      if (Array.isArray(availableModels)) {
        updates.availableModels = serializeAvailableModels(availableModels);
      }
      if (typeof apiKey === "string" && apiKey.trim()) {
        updates.encryptedApiKey = encryptSecret(apiKey.trim());
        updates.useServerKey = false;
      }
      if (clearKeyPool === true) {
        updates.encryptedKeyPool = null;
        updates.keyPoolCursor = 0;
      } else if (extraApiKeys !== undefined) {
        const parsedPool = parseExtraApiKeyInput(extraApiKeys);
        if (parsedPool.length > 0) {
          updates.encryptedKeyPool = serializeEncryptedKeyPool(parsedPool);
          updates.keyPoolCursor = 0;
        }
      }
      if (rpmLimit !== undefined) {
        updates.rpmLimit =
          rpmLimit && Number(rpmLimit) > 0 ? Math.round(Number(rpmLimit)) : null;
      }
      if (rpdLimit !== undefined) {
        updates.rpdLimit =
          rpdLimit && Number(rpdLimit) > 0 ? Math.round(Number(rpdLimit)) : null;
      }
      if (dailyTokenQuota !== undefined) {
        updates.dailyTokenQuota =
          dailyTokenQuota && Number(dailyTokenQuota) > 0
            ? Number(dailyTokenQuota)
            : null;
      }
      if (monthlyUsdQuota !== undefined) {
        updates.monthlyUsdQuota =
          monthlyUsdQuota && Number(monthlyUsdQuota) > 0
            ? Number(monthlyUsdQuota)
            : null;
      }

      const [updated] = await db
        .update(providerConnections)
        .set(updates)
        .where(
          and(
            eq(providerConnections.id, id),
            eq(providerConnections.userId, userId)
          )
        )
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Provider connection not found" });
      }

      return res.json({
        connection: sanitizeConnection(updated),
      });
    } catch (err) {
      console.error("[AS ROUTER] Update provider error:", err);
      return res.status(500).json({ error: "Failed to update provider connection" });
    }
  }
);

app.post(
  "/api/providers/:id/test",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;

      const [conn] = await db
        .select()
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.id, id),
            eq(providerConnections.userId, userId)
          )
        );

      if (!conn) {
        return res.status(404).json({ error: "Provider connection not found" });
      }

      const keys = decryptConnectionAllKeys(conn);
      const apiKey = keys[0] || "";

      const result = await testProviderConnection({
        provider: conn.provider,
        apiKey,
        baseUrl: conn.baseUrl,
      });

      await db
        .update(providerConnections)
        .set({
          lastLatencyMs: result.latencyMs,
          lastError: result.ok ? null : result.detail,
          circuitStatus: result.ok ? "healthy" : conn.circuitStatus,
          failureCount: result.ok ? 0 : conn.failureCount,
          cooldownUntil: result.ok ? null : conn.cooldownUntil,
        })
        .where(eq(providerConnections.id, conn.id));

      return res.json(result);
    } catch (err) {
      console.error("[AS ROUTER] Test provider error:", err);
      return res.status(500).json({ error: "Failed to test provider connection" });
    }
  }
);

app.post(
  "/api/providers/:id/probe-free",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;

      const [conn] = await db
        .select()
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.id, id),
            eq(providerConnections.userId, userId)
          )
        );

      if (!conn) {
        return res.status(404).json({ error: "Provider connection not found" });
      }

      const keys = decryptConnectionAllKeys(conn);
      if (keys.length === 0) {
        return res
          .status(400)
          .json({ error: "No API key configured for this connection." });
      }

      const candidateModels = Array.from(
        new Set([
          ...(conn.defaultModel ? [conn.defaultModel] : []),
          ...parseAvailableModels(conn.availableModels),
          ...(conn.provider === "gemini"
            ? ["gemini-4-hydrogen", "gemini-3.1-flash-lite"]
            : []),
        ])
      );

      const probeResult = await probeProviderFreeModels({
        provider: conn.provider,
        apiKeys: keys,
        baseUrl: conn.baseUrl,
        candidateModels,
        existingHealth: parseModelHealth(conn.modelHealth),
      });

      const fastestHealthy = probeResult.probedModels
        .map((m) => probeResult.healthMap[m])
        .filter((h) => h && h.ok)
        .sort((a, b) => a.latencyMs - b.latencyMs)[0];

      await db
        .update(providerConnections)
        .set({
          modelHealth: JSON.stringify(probeResult.healthMap),
          ...(fastestHealthy ? { lastLatencyMs: fastestHealthy.latencyMs } : {}),
        })
        .where(eq(providerConnections.id, conn.id));

      return res.json(probeResult);
    } catch (err) {
      console.error("[AS ROUTER] Probe free models error:", err);
      return res.status(500).json({ error: "Failed to probe free models" });
    }
  }
);

app.post(
  "/api/providers/:id/reset-circuit",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;

      const [updated] = await db
        .update(providerConnections)
        .set({
          circuitStatus: "healthy",
          failureCount: 0,
          cooldownUntil: null,
          lastError: null,
        })
        .where(
          and(
            eq(providerConnections.id, id),
            eq(providerConnections.userId, userId)
          )
        )
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Connection not found" });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AS ROUTER] Reset circuit error:", err);
      return res.status(500).json({ error: "Failed to reset circuit breaker" });
    }
  }
);

app.delete(
  "/api/providers/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      await db
        .delete(providerConnections)
        .where(
          and(
            eq(providerConnections.id, id),
            eq(providerConnections.userId, userId)
          )
        );
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AS ROUTER] Delete provider error:", err);
      return res.status(500).json({ error: "Failed to delete provider connection" });
    }
  }
);

// --- Combos & Tiers CRUD + Simulator ---

app.post(
  "/api/combos",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const {
        name,
        description,
        strategy,
        compressPrompt,
        freeOnly,
        enableCache,
        tiers,
      } = req.body || {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Combo alias name is required." });
      }
      if (!Array.isArray(tiers) || tiers.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one provider tier is required." });
      }

      const comboId = `combo_${crypto.randomBytes(8).toString("hex")}`;
      const [created] = await db
        .insert(combos)
        .values({
          id: comboId,
          userId,
          name: name.trim(),
          description: description ? String(description).trim() : null,
          strategy: strategy || "priority",
          compressPrompt: Boolean(compressPrompt),
          freeOnly: Boolean(freeOnly),
          enableCache: Boolean(enableCache),
          isActive: true,
        })
        .returning();

      const tierValues = tiers.map(
        (
          t: {
            connectionId: string;
            upstreamModel: string;
            priority?: number;
            weight?: number;
            maxRetries?: number;
          },
          i: number
        ) => ({
          id: `tier_${crypto.randomBytes(8).toString("hex")}`,
          comboId,
          connectionId: String(t.connectionId),
          upstreamModel: String(t.upstreamModel),
          priority: typeof t.priority === "number" ? t.priority : i,
          weight: typeof t.weight === "number" ? Math.max(1, t.weight) : 100,
          maxRetries: typeof t.maxRetries === "number" ? t.maxRetries : 1,
        })
      );

      const insertedTiers =
        tierValues.length > 0
          ? await db.insert(comboTiers).values(tierValues).returning()
          : [];

      return res.status(201).json({
        combo: { ...created, tiers: insertedTiers },
      });
    } catch (err) {
      console.error("[AS ROUTER] Create combo error:", err);
      return res.status(500).json({ error: "Failed to create combo" });
    }
  }
);

app.post(
  "/api/combos/free-auto",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const activeConns = await db
        .select()
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.userId, userId),
            eq(providerConnections.isActive, true)
          )
        );

      const candidates: Array<{
        connectionId: string;
        upstreamModel: string;
        healthOk: boolean;
        latencyMs: number;
      }> = [];
      const seen = new Set<string>();

      for (const conn of activeConns) {
        const healthMap = parseModelHealth(conn.modelHealth);
        const connModels = Array.from(
          new Set([
            ...(conn.defaultModel ? [conn.defaultModel] : []),
            ...parseAvailableModels(conn.availableModels),
            ...(conn.provider === "gemini"
              ? ["gemini-4-hydrogen", "gemini-3.1-flash-lite"]
              : []),
          ])
        ).filter((m) => isModelKnownFree(conn.provider, m));

        for (const modelId of connModels) {
          const dedupKey = `${conn.id}:${modelId}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          const health = healthMap[modelId];
          candidates.push({
            connectionId: conn.id,
            upstreamModel: modelId,
            healthOk: health ? health.ok : true,
            latencyMs: health?.latencyMs ?? conn.lastLatencyMs ?? 1500,
          });
        }
      }

      if (candidates.length === 0) {
        return res.status(400).json({
          error:
            "No free models found across active providers. Run 'Sync Free' on a provider first.",
        });
      }

      candidates.sort((a, b) => {
        if (a.healthOk !== b.healthOk) return a.healthOk ? -1 : 1;
        return a.latencyMs - b.latencyMs;
      });

      const pickedTiers = candidates.slice(0, 20);
      const userCombos = await db
        .select()
        .from(combos)
        .where(eq(combos.userId, userId));
      const existing = userCombos.find(
        (c) => c.name.toLowerCase() === "free-auto"
      );

      let comboRow: typeof combos.$inferSelect;
      if (existing) {
        const [updated] = await db
          .update(combos)
          .set({
            description: "Auto-built failover pool across all connected free models",
            strategy: "intent_auto",
            compressPrompt: true,
            freeOnly: true,
            enableCache: true,
            isActive: true,
          })
          .where(eq(combos.id, existing.id))
          .returning();
        comboRow = updated;
        await db.delete(comboTiers).where(eq(comboTiers.comboId, existing.id));
      } else {
        const [created] = await db
          .insert(combos)
          .values({
            id: `combo_${crypto.randomBytes(8).toString("hex")}`,
            userId,
            name: "free-auto",
            description: "Auto-built failover pool across all connected free models",
            strategy: "intent_auto",
            compressPrompt: true,
            freeOnly: true,
            enableCache: true,
            isActive: true,
          })
          .returning();
        comboRow = created;
      }

      const tierValues = pickedTiers.map((item, i) => ({
        id: `tier_${crypto.randomBytes(8).toString("hex")}`,
        comboId: comboRow.id,
        connectionId: item.connectionId,
        upstreamModel: item.upstreamModel,
        priority: i,
        weight: 100,
        maxRetries: 1,
      }));
      const insertedTiers =
        tierValues.length > 0
          ? await db.insert(comboTiers).values(tierValues).returning()
          : [];

      return res.json({
        combo: { ...comboRow, tiers: insertedTiers },
        tierCount: insertedTiers.length,
        updated: Boolean(existing),
      });
    } catch (err) {
      console.error("[AS ROUTER] Build free-auto combo error:", err);
      return res.status(500).json({ error: "Failed to build free-auto combo" });
    }
  }
);

app.patch(
  "/api/combos/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      const {
        name,
        description,
        strategy,
        compressPrompt,
        freeOnly,
        enableCache,
        isActive,
        tiers,
      } = req.body || {};

      const [existing] = await db
        .select()
        .from(combos)
        .where(and(eq(combos.id, id), eq(combos.userId, userId)));

      if (!existing) {
        return res.status(404).json({ error: "Combo not found" });
      }

      const updates: Partial<typeof combos.$inferInsert> = {};
      if (typeof name === "string" && name.trim()) updates.name = name.trim();
      if (description !== undefined) {
        updates.description = description ? String(description).trim() : null;
      }
      if (strategy) updates.strategy = String(strategy);
      if (typeof compressPrompt === "boolean") {
        updates.compressPrompt = compressPrompt;
      }
      if (typeof freeOnly === "boolean") {
        updates.freeOnly = freeOnly;
      }
      if (typeof enableCache === "boolean") {
        updates.enableCache = enableCache;
      }
      if (typeof isActive === "boolean") updates.isActive = isActive;

      const [updated] = await db
        .update(combos)
        .set(updates)
        .where(and(eq(combos.id, id), eq(combos.userId, userId)))
        .returning();

      let currentTiers = await db
        .select()
        .from(comboTiers)
        .where(eq(comboTiers.comboId, id))
        .orderBy(asc(comboTiers.priority));

      if (Array.isArray(tiers)) {
        await db.delete(comboTiers).where(eq(comboTiers.comboId, id));
        const tierValues = tiers.map(
          (
            t: {
              connectionId: string;
              upstreamModel: string;
              priority?: number;
              weight?: number;
              maxRetries?: number;
            },
            i: number
          ) => ({
            id: `tier_${crypto.randomBytes(8).toString("hex")}`,
            comboId: id,
            connectionId: String(t.connectionId),
            upstreamModel: String(t.upstreamModel),
            priority: typeof t.priority === "number" ? t.priority : i,
            weight: typeof t.weight === "number" ? Math.max(1, t.weight) : 100,
            maxRetries: typeof t.maxRetries === "number" ? t.maxRetries : 1,
          })
        );
        currentTiers =
          tierValues.length > 0
            ? await db.insert(comboTiers).values(tierValues).returning()
            : [];
      }

      return res.json({ combo: { ...updated, tiers: currentTiers } });
    } catch (err) {
      console.error("[AS ROUTER] Update combo error:", err);
      return res.status(500).json({ error: "Failed to update combo" });
    }
  }
);

app.delete(
  "/api/combos/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      await db
        .delete(combos)
        .where(and(eq(combos.id, id), eq(combos.userId, userId)));
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AS ROUTER] Delete combo error:", err);
      return res.status(500).json({ error: "Failed to delete combo" });
    }
  }
);

app.post(
  "/api/combos/simulate",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const {
        requestedModel,
        samplePrompt,
        hasTools,
        hasImage,
        freeOnly,
        simulatedFaultConnectionIds,
      } = req.body || {};
      if (!requestedModel || typeof requestedModel !== "string") {
        return res
          .status(400)
          .json({ error: "requestedModel is required for dry-run simulation." });
      }
      const result = await simulateComboRoute({
        userId,
        requestedModel: requestedModel.trim(),
        samplePrompt:
          typeof samplePrompt === "string" ? samplePrompt : undefined,
        hasTools: Boolean(hasTools),
        hasImage: Boolean(hasImage),
        freeOnly: Boolean(freeOnly),
        simulatedFaultConnectionIds: Array.isArray(simulatedFaultConnectionIds)
          ? simulatedFaultConnectionIds
          : [],
      });
      return res.json(result);
    } catch (err) {
      console.error("[AS ROUTER] Simulate combo error:", err);
      return res.status(500).json({ error: "Simulation failed" });
    }
  }
);

app.post(
  "/api/cache/clear",
  requireSession,
  (req: AuthedRequest, res: Response) => {
    const cleared = clearGatewayResponseCache(req.authUser!.id);
    return res.json({ ok: true, cleared });
  }
);

// --- Wildcard Routes ---

app.post(
  "/api/wildcards",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { pattern, comboId } = req.body || {};
      if (!pattern || !comboId) {
        return res
          .status(400)
          .json({ error: "Wildcard pattern and target combo are required." });
      }
      const [created] = await db
        .insert(wildcardRoutes)
        .values({
          id: `wc_${crypto.randomBytes(8).toString("hex")}`,
          userId,
          pattern: String(pattern).trim(),
          comboId: String(comboId),
          isActive: true,
        })
        .returning();
      return res.status(201).json({ wildcard: created });
    } catch (err) {
      console.error("[AS ROUTER] Create wildcard error:", err);
      return res.status(500).json({ error: "Failed to create wildcard route" });
    }
  }
);

app.delete(
  "/api/wildcards/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      await db
        .delete(wildcardRoutes)
        .where(
          and(eq(wildcardRoutes.id, id), eq(wildcardRoutes.userId, userId))
        );
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AS ROUTER] Delete wildcard error:", err);
      return res.status(500).json({ error: "Failed to delete wildcard route" });
    }
  }
);

// --- Logs & Real-Time SSE Stream ---

app.get(
  "/api/logs",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const logs = await db
        .select()
        .from(requestLogs)
        .where(eq(requestLogs.userId, userId))
        .orderBy(desc(requestLogs.createdAt))
        .limit(200);
      return res.json({ logs });
    } catch (err) {
      console.error("[AS ROUTER] Fetch logs error:", err);
      return res.status(500).json({ error: "Failed to load request logs" });
    }
  }
);

app.delete(
  "/api/logs",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      await db.delete(requestLogs).where(eq(requestLogs.userId, userId));
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AS ROUTER] Clear logs error:", err);
      return res.status(500).json({ error: "Failed to clear logs" });
    }
  }
);

app.get(
  "/api/logs/stream",
  requireSession,
  (req: AuthedRequest, res: Response) => {
    const userId = req.authUser!.id;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const unsubscribe = subscribeUserLogs(userId, res);
    req.on("close", () => {
      unsubscribe();
    });
  }
);

// --- Time-Range Analytics ---

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx];
}

function calcPctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  return Number(pct.toFixed(1));
}

app.get(
  "/api/analytics",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const rawRange = String(req.query.range || "24h");
      const range: "24h" | "7d" | "30d" =
        rawRange === "7d" ? "7d" : rawRange === "30d" ? "30d" : "24h";

      const now = Date.now();
      const windowMs =
        range === "30d"
          ? 30 * 24 * 60 * 60 * 1000
          : range === "7d"
            ? 7 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
      const startMs = now - windowMs;
      const prevStart = new Date(startMs - windowMs);

      const [allRows, userKeys] = await Promise.all([
        db
          .select()
          .from(requestLogs)
          .where(
            and(
              eq(requestLogs.userId, userId),
              gte(requestLogs.createdAt, prevStart)
            )
          )
          .orderBy(asc(requestLogs.createdAt)),
        db
          .select()
          .from(gatewayApiKeys)
          .where(eq(gatewayApiKeys.userId, userId)),
      ]);

      const rows = allRows.filter((r) => r.createdAt.getTime() >= startMs);
      const prevRows = allRows.filter((r) => r.createdAt.getTime() < startMs);

      const bucketCount = range === "24h" ? 24 : range === "7d" ? 7 : 30;
      const bucketSpanMs = windowMs / bucketCount;

      const buckets = Array.from({ length: bucketCount }, (_, i) => {
        const bucketStart = new Date(startMs + i * bucketSpanMs);
        const label =
          range === "24h"
            ? bucketStart.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : bucketStart.toLocaleDateString([], {
                month: "short",
                day: "numeric",
              });
        return {
          label,
          total: 0,
          success: 0,
          fallback: 0,
          error: 0,
          latencySum: 0,
          avgLatencyMs: 0,
          tokens: 0,
          costUsd: 0,
          successRate: 100,
          blendedPer1M: 0,
          byModel: {} as Record<
            string,
            { costUsd: number; tokens: number; requests: number }
          >,
        };
      });

      const providerMap = new Map<
        string,
        {
          provider: string;
          requests: number;
          errors: number;
          tokens: number;
          costUsd: number;
          latencySum: number;
        }
      >();

      const keyMetaById = new Map(userKeys.map((k) => [k.id, k]));
      const keyStatsMap = new Map<
        string,
        {
          id: string;
          name: string;
          keyPrefix: string;
          requests: number;
          tokens: number;
          costUsd: number;
        }
      >();

      const routeStatsMap = new Map<
        string,
        {
          name: string;
          provider: string;
          lastModel: string;
          requests: number;
          tokens: number;
          costUsd: number;
          latencySum: number;
        }
      >();

      const modelStatsMap = new Map<
        string,
        {
          model: string;
          provider: string;
          requests: number;
          tokens: number;
          costUsd: number;
        }
      >();

      let successCount = 0;
      let fallbackRecovered = 0;
      let errorCount = 0;
      let totalTokens = 0;
      let totalCostUsd = 0;
      const latencies: number[] = [];

      for (const row of rows) {
        const createdMs = row.createdAt.getTime();
        const bIdx = Math.min(
          bucketCount - 1,
          Math.max(0, Math.floor((createdMs - startMs) / bucketSpanMs))
        );
        const bucket = buckets[bIdx];
        const rowTokens = row.promptTokens + row.completionTokens;

        bucket.total += 1;
        bucket.tokens += rowTokens;
        bucket.costUsd += row.estimatedCostUsd;
        bucket.latencySum += row.latencyMs;

        const isError =
          row.outcome === "error" || row.outcome === "rate_limited";
        const isFallback = row.outcome === "fallback_success";

        if (isError) {
          bucket.error += 1;
          errorCount += 1;
        } else if (isFallback) {
          bucket.fallback += 1;
          fallbackRecovered += 1;
          successCount += 1;
        } else {
          bucket.success += 1;
          successCount += 1;
        }

        const modelKey = row.resolvedModel || row.requestedModel || "unknown";
        if (modelKey !== "none") {
          const prevBucketModel = bucket.byModel[modelKey] || {
            costUsd: 0,
            tokens: 0,
            requests: 0,
          };
          prevBucketModel.costUsd += row.estimatedCostUsd;
          prevBucketModel.tokens += rowTokens;
          prevBucketModel.requests += 1;
          bucket.byModel[modelKey] = prevBucketModel;

          const mStats = modelStatsMap.get(modelKey) || {
            model: modelKey,
            provider: row.resolvedProvider || "unknown",
            requests: 0,
            tokens: 0,
            costUsd: 0,
          };
          mStats.requests += 1;
          mStats.tokens += rowTokens;
          mStats.costUsd += row.estimatedCostUsd;
          modelStatsMap.set(modelKey, mStats);
        }

        totalTokens += rowTokens;
        totalCostUsd += row.estimatedCostUsd;
        if (row.latencyMs > 0) latencies.push(row.latencyMs);

        const pKey = row.resolvedProvider || "none";
        const pStats = providerMap.get(pKey) || {
          provider: pKey,
          requests: 0,
          errors: 0,
          tokens: 0,
          costUsd: 0,
          latencySum: 0,
        };
        pStats.requests += 1;
        if (isError) pStats.errors += 1;
        pStats.tokens += rowTokens;
        pStats.costUsd += row.estimatedCostUsd;
        pStats.latencySum += row.latencyMs;
        providerMap.set(pKey, pStats);

        // Top API Key aggregation
        const keyMapId = row.apiKeyId || row.apiKeyPrefix || "dashboard-playground";
        const meta = row.apiKeyId ? keyMetaById.get(row.apiKeyId) : undefined;
        const kEntry = keyStatsMap.get(keyMapId) || {
          id: keyMapId,
          name:
            meta?.name ||
            (row.apiKeyPrefix === "dashboard-playground"
              ? "Dashboard Playground"
              : row.apiKeyPrefix || "Gateway Key"),
          keyPrefix: meta?.keyPrefix || row.apiKeyPrefix || "playground",
          requests: 0,
          tokens: 0,
          costUsd: 0,
        };
        kEntry.requests += 1;
        kEntry.tokens += rowTokens;
        kEntry.costUsd += row.estimatedCostUsd;
        keyStatsMap.set(keyMapId, kEntry);

        // Top Routes / Combos aggregation
        const routeName = row.comboName || row.requestedModel || modelKey;
        const rEntry = routeStatsMap.get(routeName) || {
          name: routeName,
          provider: row.resolvedProvider || "gateway",
          lastModel: row.resolvedModel || row.requestedModel,
          requests: 0,
          tokens: 0,
          costUsd: 0,
          latencySum: 0,
        };
        rEntry.requests += 1;
        rEntry.tokens += rowTokens;
        rEntry.costUsd += row.estimatedCostUsd;
        rEntry.latencySum += row.latencyMs;
        routeStatsMap.set(routeName, rEntry);
      }

      // Compute previous period aggregates for vs prev period % deltas
      let prevCost = 0;
      let prevTokens = 0;
      let prevSuccess = 0;
      for (const r of prevRows) {
        prevCost += r.estimatedCostUsd;
        prevTokens += r.promptTokens + r.completionTokens;
        if (r.outcome !== "error" && r.outcome !== "rate_limited") {
          prevSuccess += 1;
        }
      }
      const prevRequests = prevRows.length;
      const prevSuccessRate =
        prevRequests > 0 ? (prevSuccess / prevRequests) * 100 : 0;
      const prevBlended =
        prevTokens > 0 ? (prevCost / prevTokens) * 1_000_000 : 0;

      latencies.sort((a, b) => a - b);
      const totalRequests = rows.length;
      const successRate =
        totalRequests > 0
          ? Number(((successCount / totalRequests) * 100).toFixed(1))
          : 100;
      const blendedCostPer1M =
        totalTokens > 0 ? (totalCostUsd / totalTokens) * 1_000_000 : 0;

      // Include created API keys if fewer than 5 had traffic in the selected window
      for (const k of userKeys) {
        if (!keyStatsMap.has(k.id)) {
          keyStatsMap.set(k.id, {
            id: k.id,
            name: k.name,
            keyPrefix: k.keyPrefix,
            requests: 0,
            tokens: 0,
            costUsd: 0,
          });
        }
      }

      return res.json({
        range,
        totalRequests,
        successRate,
        fallbackRecovered,
        errorCount,
        totalTokens,
        totalCostUsd,
        blendedCostPer1M,
        p50: computePercentile(latencies, 50),
        p95: computePercentile(latencies, 95),
        p99: computePercentile(latencies, 99),
        deltas: {
          spendPct: calcPctDelta(totalCostUsd, prevCost),
          requestsPct: calcPctDelta(totalRequests, prevRequests),
          tokensPct: calcPctDelta(totalTokens, prevTokens),
          successRatePct:
            prevRequests > 0
              ? calcPctDelta(successRate, prevSuccessRate)
              : null,
          blendedPct: calcPctDelta(blendedCostPer1M, prevBlended),
        },
        buckets: buckets.map(({ latencySum, ...rest }) => ({
          ...rest,
          avgLatencyMs:
            rest.total > 0 ? Math.round(latencySum / rest.total) : 0,
          successRate:
            rest.total > 0
              ? Number(
                  (((rest.success + rest.fallback) / rest.total) * 100).toFixed(
                    1
                  )
                )
              : 100,
          blendedPer1M:
            rest.tokens > 0 ? (rest.costUsd / rest.tokens) * 1_000_000 : 0,
        })),
        providers: Array.from(providerMap.values())
          .map((p) => ({
            provider: p.provider,
            requests: p.requests,
            tokens: p.tokens,
            costUsd: p.costUsd,
            avgLatencyMs:
              p.requests > 0 ? Math.round(p.latencySum / p.requests) : 0,
            errorRate:
              p.requests > 0 ? Math.round((p.errors / p.requests) * 100) : 0,
          }))
          .sort((a, b) => b.requests - a.requests),
        topApiKeys: Array.from(keyStatsMap.values())
          .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests)
          .slice(0, 5),
        topRoutes: Array.from(routeStatsMap.values())
          .map((r) => ({
            name: r.name,
            subtitle: `${r.provider}/${r.lastModel} · ${r.requests} reqs · ${
              r.requests > 0 ? Math.round(r.latencySum / r.requests) : 0
            }ms avg`,
            provider: r.provider,
            requests: r.requests,
            tokens: r.tokens,
            costUsd: r.costUsd,
            avgLatencyMs:
              r.requests > 0 ? Math.round(r.latencySum / r.requests) : 0,
          }))
          .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests)
          .slice(0, 5),
        models: Array.from(modelStatsMap.values())
          .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens)
          .slice(0, 6),
      });
    } catch (err) {
      console.error("[AS ROUTER] Analytics error:", err);
      return res.status(500).json({ error: "Failed to load analytics" });
    }
  }
);

// --- Live Playground Execution ---

app.post(
  "/api/playground/chat",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const {
        model,
        messages,
        temperature,
        max_tokens,
        tools,
        tool_choice,
        freeOnly,
        useCache,
      } = req.body || {};

      if (!model || !Array.isArray(messages)) {
        return res
          .status(400)
          .json({ error: "Model and messages array are required." });
      }

      const result = await executeGatewayChatCompletion({
        userId,
        apiKeyId: null,
        apiKeyPrefix: "dashboard-playground",
        freeOnly: Boolean(freeOnly),
        useCache: Boolean(useCache),
        request: {
          model: String(model),
          messages,
          stream: false,
          temperature:
            typeof temperature === "number" ? temperature : undefined,
          max_tokens: typeof max_tokens === "number" ? max_tokens : undefined,
          tools: Array.isArray(tools) ? tools : undefined,
          tool_choice,
        },
      });

      return res.json(result);
    } catch (err: unknown) {
      const status = err instanceof UpstreamHttpError ? err.statusCode : 500;
      const message = err instanceof Error ? err.message : "Playground request failed";
      return res.status(status).json({ error: message });
    }
  }
);

// ---------------------------------------------------------------------------
// Vite Dev Middleware / Static Production Assets
// ---------------------------------------------------------------------------

async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== "production") {
    const hmrDisabled = process.env.DISABLE_HMR === "true";
    if (hmrDisabled) {
      app.get("/@vite/client", (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
  }
  sheetsMap.delete(id);
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
}
export class ErrorOverlay {}
`);
      });
    }
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : undefined,
        watch: null,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) {
        return next();
      }
      return res.sendFile(path.join(distDir, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[AS ROUTER] Unified AI Gateway listening on http://0.0.0.0:${PORT} (DB mode: ${databaseMode})`
    );
  });
}

export default app;

if (process.env.VERCEL !== "1") {
  startServer().catch((err) => {
    console.error("[AS ROUTER] Fatal startup error:", err);
    process.exit(1);
  });
}
