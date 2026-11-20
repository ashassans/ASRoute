import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  combos,
  comboTiers,
  gatewayApiKeys,
  providerConnections,
  requestLogs,
  wildcardRoutes,
} from "../db/schema.ts";
import {
  getModelSpec,
  getModelUnitCost,
  type DetectedIntent,
  type RoutingStrategy,
} from "../shared/catalog.ts";
import { decryptSecret } from "./crypto.ts";
import {
  extractTextContent,
  hasImageParts,
  invokeUpstreamCompletion,
  type NormalizedCompletionRequest,
  type OpenAIChatMessage,
  type OpenAIToolCall,
  type StreamDeltaPayload,
  UpstreamHttpError,
} from "./providers.ts";
import {
  publishCircuitUpdate,
  publishRouteActivity,
  publishUserLog,
} from "./sse.ts";

export interface FallbackHop {
  tierId: string;
  connectionId: string;
  connectionName: string;
  provider: string;
  model: string;
  status: "success" | "failed" | "skipped";
  statusCode?: number;
  reason: string;
  latencyMs: number;
}

type ConnectionRow = typeof providerConnections.$inferSelect;
type TierRow = typeof comboTiers.$inferSelect;

interface EnrichedTier {
  tier: TierRow;
  connection: ConnectionRow;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function compressMessages(messages: OpenAIChatMessage[]): {
  messages: OpenAIChatMessage[];
  savedChars: number;
} {
  let savedChars = 0;
  const compressed = messages.map((msg) => {
    if (typeof msg.content === "string") {
      const compacted = msg.content
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      savedChars += Math.max(0, msg.content.length - compacted.length);
      return { ...msg, content: compacted };
    }
    if (Array.isArray(msg.content)) {
      const nextParts = msg.content.map((part) => {
        if (part.type === "text" && part.text) {
          const compacted = part.text
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          savedChars += Math.max(0, part.text.length - compacted.length);
          return { ...part, text: compacted };
        }
        return part;
      });
      return { ...msg, content: nextParts };
    }
    return msg;
  });
  return { messages: compressed, savedChars };
}

export function classifyRequestIntent(
  request: Partial<NormalizedCompletionRequest>
): DetectedIntent {
  const messages = request.messages || [];
  if (hasImageParts(messages)) {
    return "vision";
  }
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    return "tools";
  }

  const combinedText = messages
    .map((m) => extractTextContent(m.content))
    .join("\n")
    .toLowerCase();

  const codingSignal =
    /```|function\s+\w+|const\s+\w+\s*=|import\s+.*from|SELECT\s+.*FROM|def\s+\w+|class\s+\w+|stack trace|typescript|python|sql|refactor|debug|compile|regex|api endpoint/i.test(
      combinedText
    );
  if (codingSignal) {
    return "coding";
  }

  const reasoningSignal =
    combinedText.length > 1000 ||
    /\b(prove|theorem|architecture|trade-off|compare|analyze|root cause|step by step|strategy|evaluate|audit|derive|mathematics|algorithm)\b/i.test(
      combinedText
    );
  if (reasoningSignal) {
    return "reasoning";
  }

  return "fast";
}

function scoreTierForIntent(
  item: EnrichedTier,
  intent: DetectedIntent
): number {
  const modelSpec = getModelSpec(item.connection.provider, item.tier.upstreamModel);
  const modelIdLower = item.tier.upstreamModel.toLowerCase();
  let score = 0;

  if (modelSpec) {
    if (modelSpec.capabilities.includes(intent)) {
      score += 50;
    }
    if (intent === "coding" || intent === "reasoning") {
      if (modelSpec.tierRank === "flagship") score += 25;
      else if (modelSpec.tierRank === "balanced") score += 15;
    } else if (intent === "fast") {
      if (modelSpec.tierRank === "lite") score += 25;
      else if (modelSpec.tierRank === "balanced") score += 15;
    } else if (intent === "vision" || intent === "tools") {
      if (modelSpec.tierRank === "balanced") score += 15;
      else if (modelSpec.tierRank === "flagship") score += 10;
    }
  } else {
    // Heuristic scoring for custom / unlisted model IDs
    if (intent === "coding" || intent === "reasoning") {
      if (/sonnet|opus|pro|neon|carbon|r1|reasoner|o3|o1|gpt-4.5|gpt-4o(?!-mini)/.test(modelIdLower)) {
        score += 35;
      }
    } else if (intent === "fast") {
      if (/mini|lite|haiku|flash|hydrogen|8b|small|instant/.test(modelIdLower)) {
        score += 35;
      }
    }
  }

  // Slight tie-breaker by configured priority & weight
  score += Math.max(0, 10 - item.tier.priority);
  return score;
}

function resolveConnectionApiKey(conn: ConnectionRow): string {
  if (conn.useServerKey && conn.provider === "gemini") {
    return process.env.GEMINI_API_KEY?.trim() || "";
  }
  if (!conn.encryptedApiKey) return "";
  try {
    return decryptSecret(conn.encryptedApiKey);
  } catch {
    return "";
  }
}

function evaluateTierEligibility(
  conn: ConnectionRow,
  now: Date
): { eligible: boolean; reason?: string; promotedToHalfOpen?: boolean } {
  if (!conn.isActive) {
    return { eligible: false, reason: "connection_disabled" };
  }

  // Quota auto-reset check for day/month rollover
  const lastReset = conn.quotaResetAt ? new Date(conn.quotaResetAt) : new Date(0);
  const resetDaily =
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth() ||
    lastReset.getUTCDate() !== now.getUTCDate();

  const resetMonthly =
    lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
    lastReset.getUTCMonth() !== now.getUTCMonth();

  const effectiveTokensToday = resetDaily ? 0 : conn.usedTokensToday;
  const effectiveCostMonth = resetMonthly ? 0 : conn.usedCostMonth;

  if (
    conn.dailyTokenQuota !== null &&
    conn.dailyTokenQuota > 0 &&
    effectiveTokensToday >= conn.dailyTokenQuota
  ) {
    return { eligible: false, reason: "daily_token_quota_exceeded" };
  }
  if (
    conn.monthlyUsdQuota !== null &&
    conn.monthlyUsdQuota > 0 &&
    effectiveCostMonth >= conn.monthlyUsdQuota
  ) {
    return { eligible: false, reason: "monthly_usd_quota_exceeded" };
  }
  if (conn.circuitStatus === "open") {
    if (conn.cooldownUntil && conn.cooldownUntil > now) {
      return { eligible: false, reason: "circuit_open_cooldown" };
    }
    return { eligible: true, promotedToHalfOpen: true };
  }
  return { eligible: true };
}

function orderTiersByStrategy(
  tiers: EnrichedTier[],
  strategy: RoutingStrategy,
  roundRobinCursor: number,
  intent: DetectedIntent
): EnrichedTier[] {
  const copy = [...tiers];
  if (copy.length <= 1) return copy;

  switch (strategy) {
    case "intent_auto":
      return copy.sort(
        (a, b) => scoreTierForIntent(b, intent) - scoreTierForIntent(a, intent)
      );
    case "round_robin": {
      const sorted = copy.sort((a, b) => a.tier.priority - b.tier.priority);
      const offset = roundRobinCursor % sorted.length;
      return [...sorted.slice(offset), ...sorted.slice(0, offset)];
    }
    case "weighted": {
      const remaining = [...copy];
      const ordered: EnrichedTier[] = [];
      while (remaining.length > 0) {
        const totalWeight = remaining.reduce(
          (sum, item) => sum + Math.max(1, item.tier.weight),
          0
        );
        let roll = Math.random() * totalWeight;
        let chosenIdx = 0;
        for (let i = 0; i < remaining.length; i++) {
          roll -= Math.max(1, remaining[i].tier.weight);
          if (roll <= 0) {
            chosenIdx = i;
            break;
          }
        }
        ordered.push(remaining.splice(chosenIdx, 1)[0]);
      }
      return ordered;
    }
    case "least_used":
      return copy.sort((a, b) => {
        const scoreA = a.tier.requestCount + a.connection.usedTokensToday / 1000;
        const scoreB = b.tier.requestCount + b.connection.usedTokensToday / 1000;
        return scoreA - scoreB;
      });
    case "cost_optimized":
      return copy.sort((a, b) => {
        const costA = getModelUnitCost(
          a.connection.provider,
          a.tier.upstreamModel
        );
        const costB = getModelUnitCost(
          b.connection.provider,
          b.tier.upstreamModel
        );
        return costA - costB;
      });
    case "priority":
    default:
      return copy.sort((a, b) => a.tier.priority - b.tier.priority);
  }
}

export async function resolveRoutingTarget(
  userId: string,
  requestedModel: string
): Promise<{
  combo: typeof combos.$inferSelect | null;
  tiers: EnrichedTier[];
  matchedVia: "wildcard" | "combo" | "direct" | "default";
}> {
  const userConns = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.userId, userId));
  const connMap = new Map(userConns.map((c) => [c.id, c]));

  const userCombos = await db
    .select()
    .from(combos)
    .where(and(eq(combos.userId, userId), eq(combos.isActive, true)));

  const userWildcards = await db
    .select()
    .from(wildcardRoutes)
    .where(
      and(eq(wildcardRoutes.userId, userId), eq(wildcardRoutes.isActive, true))
    );

  // 1. Check wildcard routes
  for (const rule of userWildcards) {
    if (globToRegex(rule.pattern).test(requestedModel)) {
      const matchedCombo = userCombos.find((c) => c.id === rule.comboId);
      if (matchedCombo) {
        const rawTiers = await db
          .select()
          .from(comboTiers)
          .where(eq(comboTiers.comboId, matchedCombo.id))
          .orderBy(asc(comboTiers.priority));
        const enriched = rawTiers
          .map((t) => ({ tier: t, connection: connMap.get(t.connectionId)! }))
          .filter((x) => Boolean(x.connection));
        return { combo: matchedCombo, tiers: enriched, matchedVia: "wildcard" };
      }
    }
  }

  // 2. Check exact combo name
  const exactCombo = userCombos.find(
    (c) => c.name.toLowerCase() === requestedModel.toLowerCase()
  );
  if (exactCombo) {
    const rawTiers = await db
      .select()
      .from(comboTiers)
      .where(eq(comboTiers.comboId, exactCombo.id))
      .orderBy(asc(comboTiers.priority));
    const enriched = rawTiers
      .map((t) => ({ tier: t, connection: connMap.get(t.connectionId)! }))
      .filter((x) => Boolean(x.connection));
    return { combo: exactCombo, tiers: enriched, matchedVia: "combo" };
  }

  // 3. Direct provider/model syntax
  const slashIdx = requestedModel.indexOf("/");
  if (slashIdx > 0) {
    const providerPrefix = requestedModel.slice(0, slashIdx).toLowerCase();
    const modelName = requestedModel.slice(slashIdx + 1);
    const matchingConns = userConns.filter(
      (c) => c.provider.toLowerCase() === providerPrefix && c.isActive
    );
    if (matchingConns.length > 0) {
      return {
        combo: null,
        tiers: matchingConns.map((conn, idx) => ({
          tier: {
            id: `direct-${conn.id}`,
            comboId: "direct",
            connectionId: conn.id,
            upstreamModel: modelName,
            priority: idx,
            weight: 100,
            maxRetries: 1,
            requestCount: 0,
            createdAt: new Date(),
          },
          connection: conn,
        })),
        matchedVia: "direct",
      };
    }
  }

  // 4. Auto-inferred provider
  const inferredProvider = requestedModel.startsWith("gemini")
    ? "gemini"
    : requestedModel.startsWith("claude")
      ? "anthropic"
      : requestedModel.startsWith("deepseek")
        ? "deepseek"
        : requestedModel.startsWith("gpt") || requestedModel.startsWith("o3")
          ? "openai"
          : null;

  const matchingConns = inferredProvider
    ? userConns.filter((c) => c.provider === inferredProvider && c.isActive)
    : userConns.filter((c) => c.isActive);

  return {
    combo: null,
    tiers: matchingConns.map((conn, idx) => ({
      tier: {
        id: `auto-${conn.id}`,
        comboId: "auto",
        connectionId: conn.id,
        upstreamModel: requestedModel,
        priority: idx,
        weight: 100,
        maxRetries: 1,
        requestCount: 0,
        createdAt: new Date(),
      },
      connection: conn,
    })),
    matchedVia: "default",
  };
}

export async function executeGatewayChatCompletion(params: {
  userId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string | null;
  request: NormalizedCompletionRequest;
  onStreamDelta?: (delta: StreamDeltaPayload) => void;
}): Promise<{
  id: string;
  model: string;
  resolvedProvider: string;
  resolvedModel: string;
  comboName: string | null;
  detectedIntent: DetectedIntent;
  content: string;
  toolCalls?: OpenAIToolCall[];
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  finishReason: string;
  fallbackAttempts: FallbackHop[];
  compressed: boolean;
}> {
  const startedAt = Date.now();
  const requestId = `chatcmpl-${crypto.randomBytes(8).toString("hex")}`;
  const { userId, apiKeyId, apiKeyPrefix, request, onStreamDelta } = params;

  const detectedIntent = classifyRequestIntent(request);
  const target = await resolveRoutingTarget(userId, request.model);
  const strategy = (target.combo?.strategy || "priority") as RoutingStrategy;
  const cursor = target.combo?.roundRobinCursor ?? 0;

  if (target.combo && strategy === "round_robin") {
    await db
      .update(combos)
      .set({ roundRobinCursor: cursor + 1 })
      .where(eq(combos.id, target.combo.id));
  }

  let effectiveMessages = request.messages;
  let compressed = false;
  if (target.combo?.compressPrompt) {
    const result = compressMessages(request.messages);
    effectiveMessages = result.messages;
    compressed = result.savedChars > 0;
  }

  const orderedTiers = orderTiersByStrategy(
    target.tiers,
    strategy,
    cursor,
    detectedIntent
  );
  const attempts: FallbackHop[] = [];
  const now = new Date();

  if (orderedTiers.length === 0) {
    const latencyMs = Date.now() - startedAt;
    await recordRequestLog({
      userId,
      apiKeyId,
      apiKeyPrefix,
      comboName: target.combo?.name ?? null,
      requestedModel: request.model,
      resolvedProvider: "none",
      resolvedModel: request.model,
      connectionName: null,
      statusCode: 404,
      outcome: "error",
      fallbackAttempts: [],
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      latencyMs,
      compressed,
      detectedIntent,
      errorMessage: `No active provider connections or combo tiers found for "${request.model}".`,
    });
    throw new UpstreamHttpError(
      `No active provider connections or combo tiers configured for model "${request.model}".`,
      404,
      false
    );
  }

  let streamedAnyChunk = false;

  for (const { tier, connection } of orderedTiers) {
    const eligibility = evaluateTierEligibility(connection, now);
    if (!eligibility.eligible) {
      attempts.push({
        tierId: tier.id,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        status: "skipped",
        reason: eligibility.reason || "ineligible",
        latencyMs: 0,
      });
      continue;
    }

    if (eligibility.promotedToHalfOpen) {
      await db
        .update(providerConnections)
        .set({ circuitStatus: "half_open" })
        .where(eq(providerConnections.id, connection.id));
      publishCircuitUpdate(userId, connection.id, "half_open");
    }

    const upstreamKey = resolveConnectionApiKey(connection);
    const tierStart = Date.now();

    publishRouteActivity(userId, {
      requestId,
      phase: "start",
      provider: connection.provider,
      model: tier.upstreamModel,
      connectionId: connection.id,
      connectionName: connection.name,
      requestedModel: request.model,
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await invokeUpstreamCompletion({
        provider: connection.provider,
        model: tier.upstreamModel,
        apiKey: upstreamKey,
        baseUrl: connection.baseUrl,
        request: {
          ...request,
          messages: effectiveMessages,
        },
        onStreamDelta: onStreamDelta
          ? (delta) => {
              streamedAnyChunk = true;
              onStreamDelta(delta);
            }
          : undefined,
      });

      publishRouteActivity(userId, {
        requestId,
        phase: "end",
        provider: connection.provider,
        model: tier.upstreamModel,
        connectionId: connection.id,
        connectionName: connection.name,
        requestedModel: request.model,
        outcome: "success",
        timestamp: new Date().toISOString(),
      });

      const tierLatency = Date.now() - tierStart;
      const totalLatency = Date.now() - startedAt;
      const hadPriorFailure = attempts.some((a) => a.status === "failed");

      attempts.push({
        tierId: tier.id,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        status: "success",
        statusCode: 200,
        reason: hadPriorFailure
          ? "fallback_recovered"
          : strategy === "intent_auto"
            ? `intent:${detectedIntent}`
            : "primary_ok",
        latencyMs: tierLatency,
      });

      const totalTokens = result.promptTokens + result.completionTokens;

      const connLastReset = connection.quotaResetAt
        ? new Date(connection.quotaResetAt)
        : new Date(0);
      const connResetDaily =
        connLastReset.getUTCFullYear() !== now.getUTCFullYear() ||
        connLastReset.getUTCMonth() !== now.getUTCMonth() ||
        connLastReset.getUTCDate() !== now.getUTCDate();

      const connResetMonthly =
        connLastReset.getUTCFullYear() !== now.getUTCFullYear() ||
        connLastReset.getUTCMonth() !== now.getUTCMonth();

      await db
        .update(providerConnections)
        .set({
          circuitStatus: "healthy",
          failureCount: 0,
          cooldownUntil: null,
          lastLatencyMs: tierLatency,
          lastError: null,
          usedTokensToday: connResetDaily
            ? totalTokens
            : sql`${providerConnections.usedTokensToday} + ${totalTokens}`,
          usedCostMonth: connResetMonthly
            ? result.estimatedCostUsd
            : sql`${providerConnections.usedCostMonth} + ${result.estimatedCostUsd}`,
          ...(connResetDaily || connResetMonthly ? { quotaResetAt: now } : {}),
        })
        .where(eq(providerConnections.id, connection.id));

      if (connection.circuitStatus !== "healthy") {
        publishCircuitUpdate(userId, connection.id, "healthy");
      }

      if (
        target.combo &&
        !tier.id.startsWith("direct-") &&
        !tier.id.startsWith("auto-")
      ) {
        await db
          .update(comboTiers)
          .set({ requestCount: sql`${comboTiers.requestCount} + 1` })
          .where(eq(comboTiers.id, tier.id));
      }

      if (apiKeyId) {
        await db
          .update(gatewayApiKeys)
          .set({
            totalRequests: sql`${gatewayApiKeys.totalRequests} + 1`,
            totalTokens: sql`${gatewayApiKeys.totalTokens} + ${totalTokens}`,
            totalCostUsd: sql`${gatewayApiKeys.totalCostUsd} + ${result.estimatedCostUsd}`,
            usedTokensToday: sql`${gatewayApiKeys.usedTokensToday} + ${totalTokens}`,
            usedCostMonth: sql`${gatewayApiKeys.usedCostMonth} + ${result.estimatedCostUsd}`,
            lastUsedAt: new Date(),
          })
          .where(eq(gatewayApiKeys.id, apiKeyId));
      }

      await recordRequestLog({
        userId,
        apiKeyId,
        apiKeyPrefix,
        comboName: target.combo?.name ?? null,
        requestedModel: request.model,
        resolvedProvider: connection.provider,
        resolvedModel: tier.upstreamModel,
        connectionName: connection.name,
        statusCode: 200,
        outcome: hadPriorFailure ? "fallback_success" : "success",
        fallbackAttempts: attempts,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        latencyMs: totalLatency,
        compressed,
        detectedIntent,
        errorMessage: null,
      });

      return {
        id: requestId,
        model: request.model,
        resolvedProvider: connection.provider,
        resolvedModel: tier.upstreamModel,
        comboName: target.combo?.name ?? null,
        detectedIntent,
        content: result.content,
        toolCalls: result.toolCalls,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        latencyMs: totalLatency,
        finishReason: result.finishReason,
        fallbackAttempts: attempts,
        compressed,
      };
    } catch (err: unknown) {
      publishRouteActivity(userId, {
        requestId,
        phase: "end",
        provider: connection.provider,
        model: tier.upstreamModel,
        connectionId: connection.id,
        connectionName: connection.name,
        requestedModel: request.model,
        outcome: "error",
        timestamp: new Date().toISOString(),
      });
      const tierLatency = Date.now() - tierStart;
      const statusCode =
        err instanceof UpstreamHttpError ? err.statusCode : 502;
      const errMessage = err instanceof Error ? err.message : String(err);

      const newFailureCount = connection.failureCount + 1;
      const shouldOpenCircuit =
        statusCode === 429 ||
        statusCode === 401 ||
        statusCode === 403 ||
        newFailureCount >= 2;

      const nextStatus = shouldOpenCircuit ? "open" : connection.circuitStatus;
      const cooldownUntil = shouldOpenCircuit
        ? new Date(Date.now() + (statusCode === 429 ? 30_000 : 45_000))
        : connection.cooldownUntil;

      await db
        .update(providerConnections)
        .set({
          failureCount: newFailureCount,
          circuitStatus: nextStatus,
          cooldownUntil,
          lastLatencyMs: tierLatency,
          lastError: errMessage.slice(0, 300),
        })
        .where(eq(providerConnections.id, connection.id));

      if (shouldOpenCircuit) {
        publishCircuitUpdate(userId, connection.id, "open");
      }

      attempts.push({
        tierId: tier.id,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        status: "failed",
        statusCode,
        reason: errMessage.slice(0, 180),
        latencyMs: tierLatency,
      });

      if (streamedAnyChunk) {
        break;
      }
    }
  }

  const totalLatency = Date.now() - startedAt;
  const lastFailure = [...attempts].reverse().find((a) => a.status === "failed");
  const finalStatus = lastFailure?.statusCode || 503;
  const finalReason =
    lastFailure?.reason ||
    "All candidate tiers skipped due to circuit breakers or exhausted quotas.";

  await recordRequestLog({
    userId,
    apiKeyId,
    apiKeyPrefix,
    comboName: target.combo?.name ?? null,
    requestedModel: request.model,
    resolvedProvider: lastFailure?.provider || "none",
    resolvedModel: lastFailure?.model || request.model,
    connectionName: lastFailure?.connectionName || null,
    statusCode: finalStatus,
    outcome: finalStatus === 429 ? "rate_limited" : "error",
    fallbackAttempts: attempts,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    latencyMs: totalLatency,
    compressed,
    detectedIntent,
    errorMessage: finalReason,
  });

  throw new UpstreamHttpError(finalReason, finalStatus, false);
}

async function recordRequestLog(params: {
  userId: string;
  apiKeyId: string | null;
  apiKeyPrefix: string | null;
  comboName: string | null;
  requestedModel: string;
  resolvedProvider: string;
  resolvedModel: string;
  connectionName: string | null;
  statusCode: number;
  outcome: string;
  fallbackAttempts: FallbackHop[];
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  compressed: boolean;
  detectedIntent: DetectedIntent;
  errorMessage: string | null;
}) {
  const id = `log_${crypto.randomBytes(8).toString("hex")}`;
  const createdAt = new Date();
  const attemptsJson = JSON.stringify(params.fallbackAttempts);

  await db.insert(requestLogs).values({
    id,
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    apiKeyPrefix: params.apiKeyPrefix,
    comboName: params.comboName,
    requestedModel: params.requestedModel,
    resolvedProvider: params.resolvedProvider,
    resolvedModel: params.resolvedModel,
    connectionName: params.connectionName,
    statusCode: params.statusCode,
    outcome: params.outcome,
    fallbackAttempts: attemptsJson,
    promptTokens: params.promptTokens,
    completionTokens: params.completionTokens,
    estimatedCostUsd: params.estimatedCostUsd,
    latencyMs: params.latencyMs,
    compressed: params.compressed,
    detectedIntent: params.detectedIntent,
    errorMessage: params.errorMessage,
    createdAt,
  });

  publishUserLog(params.userId, {
    ...params,
    id,
    fallbackAttempts: attemptsJson,
    createdAt: createdAt.toISOString(),
  });
}

export async function simulateComboRoute(params: {
  userId: string;
  requestedModel: string;
  samplePrompt?: string;
  hasTools?: boolean;
  hasImage?: boolean;
  simulatedFaultConnectionIds?: string[];
}) {
  const target = await resolveRoutingTarget(
    params.userId,
    params.requestedModel
  );
  const strategy = (target.combo?.strategy || "priority") as RoutingStrategy;

  const syntheticRequest: Partial<NormalizedCompletionRequest> = {
    messages: [
      {
        role: "user",
        content: params.hasImage
          ? [
              { type: "text", text: params.samplePrompt || "Analyze image" },
              {
                type: "image_url",
                image_url: { url: "https://example.com/img.png" },
              },
            ]
          : params.samplePrompt || "Hello",
      },
    ],
    tools: params.hasTools
      ? [{ type: "function", function: { name: "sample_tool" } }]
      : undefined,
  };

  const detectedIntent = classifyRequestIntent(syntheticRequest);
  const ordered = orderTiersByStrategy(
    target.tiers,
    strategy,
    target.combo?.roundRobinCursor ?? 0,
    detectedIntent
  );
  const now = new Date();
  const faultSet = new Set(params.simulatedFaultConnectionIds || []);

  const steps: Array<{
    order: number;
    connectionId: string;
    connectionName: string;
    provider: string;
    model: string;
    weight: number;
    decision: "selected" | "fallback_failed" | "skipped";
    reason: string;
  }> = [];

  let winner: string | null = null;

  ordered.forEach(({ tier, connection }, index) => {
    const elig = evaluateTierEligibility(connection, now);
    if (!elig.eligible) {
      steps.push({
        order: index + 1,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        weight: tier.weight,
        decision: "skipped",
        reason: elig.reason || "ineligible",
      });
      return;
    }

    if (winner) {
      steps.push({
        order: index + 1,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        weight: tier.weight,
        decision: "skipped",
        reason: "standby_fallback_tier",
      });
      return;
    }

    if (faultSet.has(connection.id)) {
      steps.push({
        order: index + 1,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        weight: tier.weight,
        decision: "fallback_failed",
        reason: "simulated_429_rate_limit",
      });
      return;
    }

    winner = `${connection.name} (${tier.upstreamModel})`;
    steps.push({
      order: index + 1,
      connectionId: connection.id,
      connectionName: connection.name,
      provider: connection.provider,
      model: tier.upstreamModel,
      weight: tier.weight,
      decision: "selected",
      reason: elig.promotedToHalfOpen
        ? "half_open_probe_selected"
        : strategy === "intent_auto"
          ? `intent:${detectedIntent}`
          : "eligible_primary_selected",
    });
  });

  return {
    requestedModel: params.requestedModel,
    matchedVia: target.matchedVia,
    comboName: target.combo?.name ?? null,
    strategy,
    detectedIntent,
    compressPrompt: target.combo?.compressPrompt ?? false,
    winner,
    steps,
  };
}
