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
  isModelKnownFree,
  type DetectedIntent,
  type RoutingStrategy,
} from "../shared/catalog.ts";
import type { ModelHealthEntry } from "../types/gateway.ts";
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

// ---------------------------------------------------------------------------
// In-Memory RPM Pacing Queue & Exact Response Cache
// ---------------------------------------------------------------------------

const rpmWindowMap = new Map<string, number[]>();

interface CachedCompletionEntry {
  key: string;
  userId: string;
  resolvedProvider: string;
  resolvedModel: string;
  comboName: string | null;
  detectedIntent: DetectedIntent;
  content: string;
  toolCalls?: OpenAIToolCall[];
  promptTokens: number;
  completionTokens: number;
  finishReason: string;
  expiresAt: number;
}

const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;
const RESPONSE_CACHE_MAX = 400;
const responseCache = new Map<string, CachedCompletionEntry>();

export function clearGatewayResponseCache(userId?: string): number {
  if (!userId) {
    const count = responseCache.size;
    responseCache.clear();
    return count;
  }
  let cleared = 0;
  for (const [key, entry] of responseCache.entries()) {
    if (entry.userId === userId) {
      responseCache.delete(key);
      cleared += 1;
    }
  }
  return cleared;
}

function buildCacheKey(params: {
  userId: string;
  requestedModel: string;
  freeOnly: boolean;
  messages: OpenAIChatMessage[];
  tools?: NormalizedCompletionRequest["tools"];
  toolChoice?: NormalizedCompletionRequest["tool_choice"];
}): string {
  const payload = JSON.stringify({
    u: params.userId,
    m: params.requestedModel,
    f: params.freeOnly,
    msgs: params.messages,
    t: params.tools || null,
    tc: params.toolChoice || null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function getCachedCompletion(key: string): CachedCompletionEntry | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedCompletion(entry: CachedCompletionEntry) {
  if (responseCache.size >= RESPONSE_CACHE_MAX) {
    const firstKey = responseCache.keys().next().value;
    if (firstKey) responseCache.delete(firstKey);
  }
  responseCache.set(entry.key, entry);
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

async function applyRpmPacing(
  connection: ConnectionRow,
  hasRemainingTier: boolean
): Promise<{ proceed: boolean; queuedMs: number }> {
  const rpm = connection.rpmLimit;
  if (!rpm || rpm <= 0) {
    return { proceed: true, queuedMs: 0 };
  }

  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (rpmWindowMap.get(connection.id) || []).filter((ts) => ts > windowStart);

  if (recent.length < rpm) {
    recent.push(now);
    rpmWindowMap.set(connection.id, recent);
    return { proceed: true, queuedMs: 0 };
  }

  const oldestTs = recent[0];
  const waitMs = Math.max(50, oldestTs + 60_050 - now);
  const maxQueueWait = hasRemainingTier ? 350 : 5000;

  if (waitMs > maxQueueWait) {
    rpmWindowMap.set(connection.id, recent);
    return { proceed: false, queuedMs: 0 };
  }

  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const afterNow = Date.now();
  const refreshed = (rpmWindowMap.get(connection.id) || []).filter(
    (ts) => ts > afterNow - 60_000
  );
  refreshed.push(afterNow);
  rpmWindowMap.set(connection.id, refreshed);
  return { proceed: true, queuedMs: waitMs };
}

function scoreTierForIntent(
  item: EnrichedTier,
  intent: DetectedIntent
): number {
  const modelSpec = getModelSpec(item.connection.provider, item.tier.upstreamModel);
  const modelIdLower = item.tier.upstreamModel.toLowerCase();
  const healthMap = parseModelHealth(item.connection.modelHealth);
  const health = healthMap[item.tier.upstreamModel];
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
    // Capability-aware heuristics for custom / free aggregator models
    if (intent === "tools") {
      if (/(flash|hydrogen|llama-4|llama-3\.3|llama-3\.1|qwen|mistral|deepseek-chat|deepseek-v3|gpt-6|gpt-5|gpt-4o|claude|step|command)/i.test(modelIdLower)) {
        score += 35;
      }
      if (/(gemma|deepseek-r1|reasoner|:thinking|-thinking)/i.test(modelIdLower)) {
        score -= 45;
      }
    } else if (intent === "vision") {
      if (/(flash|hydrogen|neon|argon|carbon|terra|sol|astra|gpt-6|gpt-5|gpt-4o|claude|llama-4|vision|-vl|pixtral|llava|gemini-3|gemini-4|gemini-2)/i.test(modelIdLower)) {
        score += 40;
      } else {
        score -= 20;
      }
    } else if (intent === "coding" || intent === "reasoning") {
      if (/(sonnet|opus|fable|pro|neon|argon|carbon|astra|sol|gpt-6|gpt-5|qwen|coder|deepseek|r1|reasoner|o4|o3|o1|gpt-4\.5|gpt-4o(?!-mini)|llama-4-maverick|llama-3\.3-70b|mistral-large)/i.test(modelIdLower)) {
        score += 35;
      }
    } else if (intent === "fast") {
      if (/(mini|lite|haiku|flash|hydrogen|luna|8b|small|instant|nano)/i.test(modelIdLower)) {
        score += 35;
      }
    }
  }

  // Model-level uptime & tool capability feedback
  if (health) {
    const testedAgeMs = Date.now() - new Date(health.testedAt).getTime();
    if (testedAgeMs < 15 * 60 * 1000) {
      if (!health.ok) score -= 65;
      else if (health.latencyMs > 0 && health.latencyMs < 1800) score += 12;
    }
    if (intent === "tools" && health.supportsTools === false) {
      score -= 75;
    }
  }

  // Slight tie-breaker by configured priority
  score += Math.max(0, 10 - item.tier.priority);
  return score;
}

function resolveConnectionApiKeys(conn: ConnectionRow): {
  keys: string[];
  cursor: number;
} {
  const allKeys: string[] = [];
  if (conn.encryptedApiKey) {
    try {
      const primary = decryptSecret(conn.encryptedApiKey);
      if (primary) allKeys.push(primary);
    } catch {
      // ignore corrupted entry
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
              if (dec && !allKeys.includes(dec)) allKeys.push(dec);
            } catch {
              // skip invalid encrypted pool item
            }
          }
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  if (allKeys.length <= 1) {
    return { keys: allKeys, cursor: 0 };
  }
  const cursor = ((conn.keyPoolCursor || 0) % allKeys.length + allKeys.length) % allKeys.length;
  const rotated = [...allKeys.slice(cursor), ...allKeys.slice(0, cursor)];
  return { keys: rotated, cursor };
}

function isCapabilityMismatchError(
  statusCode: number,
  errMessage: string,
  hasTools: boolean
): boolean {
  if (statusCode !== 400 && statusCode !== 404 && statusCode !== 422) return false;
  if (hasTools && /tool|function|tool_choice|tools is not supported/i.test(errMessage)) {
    return true;
  }
  return /developer instruction|system instruction|image|multimodal|vision|response_format/i.test(
    errMessage
  );
}

function buildToolEmulatedMessages(
  messages: OpenAIChatMessage[],
  tools: NonNullable<NormalizedCompletionRequest["tools"]>
): OpenAIChatMessage[] {
  const toolSpecText = JSON.stringify(
    tools.map((t) => ({
      name: t.function.name,
      description: t.function.description || "",
      parameters: t.function.parameters || {},
    })),
    null,
    2
  );
  const instruction =
    `You have access to the following tools:\n${toolSpecText}\n\n` +
    `If a tool call is needed to answer accurately, respond ONLY with valid JSON in this exact format:\n` +
    `{"tool_calls":[{"name":"<tool_name>","arguments":{...}}]}\n` +
    `Otherwise answer the user directly in plain text.`;

  return [{ role: "system", content: instruction }, ...messages];
}

function parseEmulatedToolCalls(text: string): OpenAIToolCall[] | undefined {
  const trimmed = (text || "").trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (!jsonMatch) return undefined;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      tool_calls?: Array<{ name?: string; arguments?: unknown }>;
    };
    if (!Array.isArray(parsed.tool_calls) || parsed.tool_calls.length === 0) {
      return undefined;
    }
    const calls: OpenAIToolCall[] = parsed.tool_calls
      .filter((tc) => Boolean(tc?.name))
      .map((tc) => ({
        id: `call_${crypto.randomBytes(6).toString("hex")}`,
        type: "function" as const,
        function: {
          name: String(tc.name),
          arguments:
            typeof tc.arguments === "string"
              ? tc.arguments
              : JSON.stringify(tc.arguments || {}),
        },
      }));
    return calls.length > 0 ? calls : undefined;
  } catch {
    return undefined;
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

  const effectiveRequestsToday = resetDaily ? 0 : conn.usedRequestsToday;
  const effectiveTokensToday = resetDaily ? 0 : conn.usedTokensToday;
  const effectiveCostMonth = resetMonthly ? 0 : conn.usedCostMonth;

  if (
    conn.rpdLimit !== null &&
    conn.rpdLimit > 0 &&
    effectiveRequestsToday >= conn.rpdLimit
  ) {
    return { eligible: false, reason: "daily_request_quota_exceeded" };
  }
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

function connHasModel(conn: ConnectionRow, modelName: string): boolean {
  if (conn.defaultModel === modelName) return true;
  if (!conn.availableModels) return false;
  try {
    const parsed = JSON.parse(conn.availableModels);
    return Array.isArray(parsed) && parsed.includes(modelName);
  } catch {
    return false;
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
  const trimmedModel = requestedModel.trim();
  const comboLookupName = trimmedModel
    .replace(/^(as-router-combo|combo)\//i, "")
    .trim();

  const [userConns, userCombos, userWildcards, allUserTierRows] =
    await Promise.all([
      db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.userId, userId)),
      db
        .select()
        .from(combos)
        .where(and(eq(combos.userId, userId), eq(combos.isActive, true))),
      db
        .select()
        .from(wildcardRoutes)
        .where(
          and(eq(wildcardRoutes.userId, userId), eq(wildcardRoutes.isActive, true))
        ),
      db
        .select({ tier: comboTiers })
        .from(comboTiers)
        .innerJoin(combos, eq(comboTiers.comboId, combos.id))
        .where(eq(combos.userId, userId))
        .orderBy(asc(comboTiers.priority)),
    ]);

  const connMap = new Map(userConns.map((c) => [c.id, c]));
  const tiersByComboId = new Map<string, TierRow[]>();
  for (const row of allUserTierRows) {
    const list = tiersByComboId.get(row.tier.comboId) || [];
    list.push(row.tier);
    tiersByComboId.set(row.tier.comboId, list);
  }

  // 1. Check wildcard routes
  for (const rule of userWildcards) {
    if (
      globToRegex(rule.pattern).test(trimmedModel) ||
      globToRegex(rule.pattern).test(comboLookupName)
    ) {
      const matchedCombo = userCombos.find((c) => c.id === rule.comboId);
      if (matchedCombo) {
        const rawTiers = tiersByComboId.get(matchedCombo.id) || [];
        const enriched = rawTiers
          .map((t) => ({ tier: t, connection: connMap.get(t.connectionId)! }))
          .filter((x) => Boolean(x.connection));
        return { combo: matchedCombo, tiers: enriched, matchedVia: "wildcard" };
      }
    }
  }

  // 2. Check exact combo name (including optional combo/ prefix)
  const exactCombo = userCombos.find(
    (c) =>
      c.name.trim().toLowerCase() === trimmedModel.toLowerCase() ||
      c.name.trim().toLowerCase() === comboLookupName.toLowerCase()
  );
  if (exactCombo) {
    const rawTiers = tiersByComboId.get(exactCombo.id) || [];
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
    const matchingConns = userConns
      .filter((c) => c.provider.toLowerCase() === providerPrefix && c.isActive)
      .sort((a, b) => {
        const aOwns = connHasModel(a, modelName) ? 1 : 0;
        const bOwns = connHasModel(b, modelName) ? 1 : 0;
        return bOwns - aOwns;
      });
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
  freeOnly?: boolean;
  useCache?: boolean;
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
  cached?: boolean;
}> {
  const startedAt = Date.now();
  const requestId = `chatcmpl-${crypto.randomBytes(8).toString("hex")}`;
  const { userId, apiKeyId, apiKeyPrefix, request, onStreamDelta } = params;

  const detectedIntent = classifyRequestIntent(request);
  const target = await resolveRoutingTarget(userId, request.model);
  const strategy = (target.combo?.strategy || "priority") as RoutingStrategy;
  const cursor = target.combo?.roundRobinCursor ?? 0;
  const enforceFreeOnly = Boolean(params.freeOnly || target.combo?.freeOnly);
  const cacheEnabled = Boolean(target.combo?.enableCache || params.useCache);

  const pendingDbWrites: Promise<unknown>[] = [];

  if (target.combo && strategy === "round_robin") {
    pendingDbWrites.push(
      db
        .update(combos)
        .set({ roundRobinCursor: cursor + 1 })
        .where(eq(combos.id, target.combo.id))
    );
  }

  let effectiveMessages = request.messages;
  let compressed = false;
  if (target.combo?.compressPrompt) {
    const result = compressMessages(request.messages);
    effectiveMessages = result.messages;
    compressed = result.savedChars > 0;
  }

  const cacheKey =
    cacheEnabled &&
    !request.stream &&
    (request.temperature === undefined || request.temperature <= 0.7)
      ? buildCacheKey({
          userId,
          requestedModel: request.model,
          freeOnly: enforceFreeOnly,
          messages: effectiveMessages,
          tools: request.tools,
          toolChoice: request.tool_choice,
        })
      : null;

  if (cacheKey) {
    const cached = getCachedCompletion(cacheKey);
    if (cached) {
      const totalLatency = Math.max(1, Date.now() - startedAt);
      const hitAttempts: FallbackHop[] = [
        {
          tierId: "cache",
          connectionId: "cache",
          connectionName: "Response Cache",
          provider: cached.resolvedProvider,
          model: cached.resolvedModel,
          status: "success",
          statusCode: 200,
          reason: "exact_response_cache_hit",
          latencyMs: totalLatency,
        },
      ];
      await recordRequestLog({
        userId,
        apiKeyId,
        apiKeyPrefix,
        comboName: target.combo?.name ?? cached.comboName,
        requestedModel: request.model,
        resolvedProvider: cached.resolvedProvider,
        resolvedModel: cached.resolvedModel,
        connectionName: "Response Cache",
        statusCode: 200,
        outcome: "cache_hit",
        fallbackAttempts: hitAttempts,
        promptTokens: 0,
        completionTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: totalLatency,
        compressed,
        detectedIntent,
        errorMessage: null,
      });
      return {
        id: requestId,
        model: request.model,
        resolvedProvider: cached.resolvedProvider,
        resolvedModel: cached.resolvedModel,
        comboName: target.combo?.name ?? cached.comboName,
        detectedIntent,
        content: cached.content,
        toolCalls: cached.toolCalls,
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
        estimatedCostUsd: 0,
        latencyMs: totalLatency,
        finishReason: cached.finishReason,
        fallbackAttempts: hitAttempts,
        compressed,
        cached: true,
      };
    }
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
  let blockedByFreeOnlyCount = 0;
  let toolFallbackCandidate: {
    tier: TierRow;
    connection: ConnectionRow;
    apiKey: string;
  } | null = null;

  for (let tierIdx = 0; tierIdx < orderedTiers.length; tierIdx++) {
    if (tierIdx > 0 && Date.now() - startedAt > 20_000) {
      break;
    }

    const { tier, connection } = orderedTiers[tierIdx];

    if (enforceFreeOnly && !isModelKnownFree(connection.provider, tier.upstreamModel)) {
      blockedByFreeOnlyCount += 1;
      attempts.push({
        tierId: tier.id,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        status: "skipped",
        statusCode: 403,
        reason: "blocked_by_free_only_lock",
        latencyMs: 0,
      });
      continue;
    }

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

    const hasRemainingTier = orderedTiers.slice(tierIdx + 1).some((nextItem) => {
      if (
        enforceFreeOnly &&
        !isModelKnownFree(nextItem.connection.provider, nextItem.tier.upstreamModel)
      ) {
        return false;
      }
      return evaluateTierEligibility(nextItem.connection, now).eligible;
    });

    const pacing = await applyRpmPacing(connection, hasRemainingTier);
    if (!pacing.proceed) {
      attempts.push({
        tierId: tier.id,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        status: "skipped",
        statusCode: 429,
        reason: "rpm_window_busy_skipped",
        latencyMs: 0,
      });
      continue;
    }

    if (eligibility.promotedToHalfOpen) {
      pendingDbWrites.push(
        db
          .update(providerConnections)
          .set({ circuitStatus: "half_open" })
          .where(eq(providerConnections.id, connection.id))
      );
      publishCircuitUpdate(userId, connection.id, "half_open");
    }

    const { keys: candidateKeys, cursor: startCursor } =
      resolveConnectionApiKeys(connection);
    const tierStart = Date.now();
    const tierTimeoutMs = hasRemainingTier ? 5500 : 25000;

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

    let lastTierError: unknown = null;
    let tierSucceeded = false;

    for (let keyIdx = 0; keyIdx < Math.max(1, candidateKeys.length); keyIdx++) {
      const upstreamKey = candidateKeys[keyIdx] || "";
      try {
        const result = await invokeUpstreamCompletion({
          provider: connection.provider,
          model: tier.upstreamModel,
          apiKey: upstreamKey,
          baseUrl: connection.baseUrl,
          timeoutMs: tierTimeoutMs,
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

        tierSucceeded = true;
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

        const reasonNotes: string[] = [];
        if (hadPriorFailure) reasonNotes.push("fallback_recovered");
        else if (strategy === "intent_auto") reasonNotes.push(`intent:${detectedIntent}`);
        else reasonNotes.push("primary_ok");
        if (keyIdx > 0) reasonNotes.push(`pool_key_${keyIdx + 1}`);
        if (pacing.queuedMs > 0) reasonNotes.push(`queued_${pacing.queuedMs}ms`);

        attempts.push({
          tierId: tier.id,
          connectionId: connection.id,
          connectionName: connection.name,
          provider: connection.provider,
          model: tier.upstreamModel,
          status: "success",
          statusCode: 200,
          reason: reasonNotes.join(" · "),
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

        const nextPoolCursor =
          candidateKeys.length > 1
            ? (startCursor + keyIdx) % candidateKeys.length
            : connection.keyPoolCursor;

        const nextHealth = parseModelHealth(connection.modelHealth);
        nextHealth[tier.upstreamModel] = {
          ok: true,
          latencyMs: tierLatency,
          supportsTools:
            request.tools && request.tools.length > 0
              ? true
              : nextHealth[tier.upstreamModel]?.supportsTools,
          testedAt: now.toISOString(),
        };

        const postSuccessWrites: Promise<unknown>[] = [
          ...pendingDbWrites,
          db
            .update(providerConnections)
            .set({
              circuitStatus: "healthy",
              failureCount: 0,
              cooldownUntil: null,
              lastLatencyMs: tierLatency,
              lastError: null,
              keyPoolCursor: nextPoolCursor,
              modelHealth: JSON.stringify(nextHealth),
              usedRequestsToday: connResetDaily
                ? 1
                : sql`${providerConnections.usedRequestsToday} + 1`,
              usedTokensToday: connResetDaily
                ? totalTokens
                : sql`${providerConnections.usedTokensToday} + ${totalTokens}`,
              usedCostMonth: connResetMonthly
                ? result.estimatedCostUsd
                : sql`${providerConnections.usedCostMonth} + ${result.estimatedCostUsd}`,
              ...(connResetDaily || connResetMonthly ? { quotaResetAt: now } : {}),
            })
            .where(eq(providerConnections.id, connection.id)),
          recordRequestLog({
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
          }),
        ];

        if (connection.circuitStatus !== "healthy") {
          publishCircuitUpdate(userId, connection.id, "healthy");
        }

        if (
          target.combo &&
          !tier.id.startsWith("direct-") &&
          !tier.id.startsWith("auto-")
        ) {
          postSuccessWrites.push(
            db
              .update(comboTiers)
              .set({ requestCount: sql`${comboTiers.requestCount} + 1` })
              .where(eq(comboTiers.id, tier.id))
          );
        }

        if (apiKeyId) {
          postSuccessWrites.push(
            db
              .update(gatewayApiKeys)
              .set({
                totalRequests: sql`${gatewayApiKeys.totalRequests} + 1`,
                totalTokens: sql`${gatewayApiKeys.totalTokens} + ${totalTokens}`,
                totalCostUsd: sql`${gatewayApiKeys.totalCostUsd} + ${result.estimatedCostUsd}`,
                usedTokensToday: sql`${gatewayApiKeys.usedTokensToday} + ${totalTokens}`,
                usedCostMonth: sql`${gatewayApiKeys.usedCostMonth} + ${result.estimatedCostUsd}`,
                lastUsedAt: new Date(),
              })
              .where(eq(gatewayApiKeys.id, apiKeyId))
          );
        }

        if (cacheKey) {
          setCachedCompletion({
            key: cacheKey,
            userId,
            resolvedProvider: connection.provider,
            resolvedModel: tier.upstreamModel,
            comboName: target.combo?.name ?? null,
            detectedIntent,
            content: result.content,
            toolCalls: result.toolCalls,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            finishReason: result.finishReason,
            expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
          });
        }

        await Promise.allSettled(postSuccessWrites);

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
          cached: false,
        };
      } catch (err: unknown) {
        lastTierError = err;
        const sc = err instanceof UpstreamHttpError ? err.statusCode : 502;
        const canRotatePoolKey =
          !streamedAnyChunk &&
          keyIdx + 1 < candidateKeys.length &&
          (sc === 429 || sc === 401 || sc === 403 || sc >= 500);
        if (canRotatePoolKey) {
          continue;
        }
        break;
      }
    }

    if (!tierSucceeded && lastTierError) {
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
        lastTierError instanceof UpstreamHttpError ? lastTierError.statusCode : 502;
      const errMessage =
        lastTierError instanceof Error
          ? lastTierError.message
          : String(lastTierError);

      const hasTools = Boolean(request.tools && request.tools.length > 0);
      const capabilityMismatch = isCapabilityMismatchError(
        statusCode,
        errMessage,
        hasTools
      );

      if (capabilityMismatch && hasTools && !toolFallbackCandidate && candidateKeys[0]) {
        toolFallbackCandidate = {
          tier,
          connection,
          apiKey: candidateKeys[0],
        };
      }

      if (capabilityMismatch && hasTools) {
        const nextHealth = parseModelHealth(connection.modelHealth);
        const existing = nextHealth[tier.upstreamModel];
        nextHealth[tier.upstreamModel] = {
          ok: existing?.ok ?? true,
          latencyMs: existing?.latencyMs ?? tierLatency,
          supportsTools: false,
          testedAt: now.toISOString(),
        };
        pendingDbWrites.push(
          db
            .update(providerConnections)
            .set({ modelHealth: JSON.stringify(nextHealth) })
            .where(eq(providerConnections.id, connection.id))
        );
      } else {
        const isModelSpecificClientError =
          statusCode === 400 || statusCode === 404 || statusCode === 422;
        const newFailureCount = isModelSpecificClientError
          ? connection.failureCount
          : connection.failureCount + 1;
        const shouldOpenCircuit =
          !isModelSpecificClientError &&
          (statusCode === 429 ||
            statusCode === 401 ||
            statusCode === 403 ||
            newFailureCount >= 2);

        const nextStatus = shouldOpenCircuit ? "open" : connection.circuitStatus;
        const cooldownUntil = shouldOpenCircuit
          ? new Date(Date.now() + (statusCode === 429 ? 30_000 : 45_000))
          : connection.cooldownUntil;

        pendingDbWrites.push(
          db
            .update(providerConnections)
            .set({
              failureCount: newFailureCount,
              circuitStatus: nextStatus,
              cooldownUntil,
              lastLatencyMs: tierLatency,
              lastError: errMessage.slice(0, 300),
            })
            .where(eq(providerConnections.id, connection.id))
        );

        if (shouldOpenCircuit) {
          publishCircuitUpdate(userId, connection.id, "open");
        }
      }

      attempts.push({
        tierId: tier.id,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        status: "failed",
        statusCode,
        reason: capabilityMismatch
          ? `capability_mismatch: ${errMessage.slice(0, 140)}`
          : errMessage.slice(0, 180),
        latencyMs: tierLatency,
      });

      if (streamedAnyChunk) {
        break;
      }
    }
  }

  // Tool-Call Fallback Adapter: emulate tools via prompt if upstream rejected native tools[]
  if (
    toolFallbackCandidate &&
    request.tools &&
    request.tools.length > 0 &&
    !streamedAnyChunk
  ) {
    const adapterStart = Date.now();
    try {
      const emulatedMessages = buildToolEmulatedMessages(
        effectiveMessages,
        request.tools
      );
      const adapterResult = await invokeUpstreamCompletion({
        provider: toolFallbackCandidate.connection.provider,
        model: toolFallbackCandidate.tier.upstreamModel,
        apiKey: toolFallbackCandidate.apiKey,
        baseUrl: toolFallbackCandidate.connection.baseUrl,
        request: {
          model: request.model,
          messages: emulatedMessages,
          stream: false,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
        },
      });

      const emulatedCalls = parseEmulatedToolCalls(adapterResult.content);
      const finalContent = emulatedCalls ? "" : adapterResult.content;
      const finalFinish = emulatedCalls ? "tool_calls" : adapterResult.finishReason;

      if (onStreamDelta && finalContent) {
        onStreamDelta({ content: finalContent });
      }

      const adapterLatency = Date.now() - adapterStart;
      const totalLatency = Date.now() - startedAt;
      attempts.push({
        tierId: toolFallbackCandidate.tier.id,
        connectionId: toolFallbackCandidate.connection.id,
        connectionName: toolFallbackCandidate.connection.name,
        provider: toolFallbackCandidate.connection.provider,
        model: toolFallbackCandidate.tier.upstreamModel,
        status: "success",
        statusCode: 200,
        reason: "tool_adapter_emulated",
        latencyMs: adapterLatency,
      });

      const totalTokens =
        adapterResult.promptTokens + adapterResult.completionTokens;
      await db
        .update(providerConnections)
        .set({
          usedRequestsToday: sql`${providerConnections.usedRequestsToday} + 1`,
          usedTokensToday: sql`${providerConnections.usedTokensToday} + ${totalTokens}`,
          lastLatencyMs: adapterLatency,
        })
        .where(eq(providerConnections.id, toolFallbackCandidate.connection.id));

      await recordRequestLog({
        userId,
        apiKeyId,
        apiKeyPrefix,
        comboName: target.combo?.name ?? null,
        requestedModel: request.model,
        resolvedProvider: toolFallbackCandidate.connection.provider,
        resolvedModel: toolFallbackCandidate.tier.upstreamModel,
        connectionName: toolFallbackCandidate.connection.name,
        statusCode: 200,
        outcome: "fallback_success",
        fallbackAttempts: attempts,
        promptTokens: adapterResult.promptTokens,
        completionTokens: adapterResult.completionTokens,
        estimatedCostUsd: adapterResult.estimatedCostUsd,
        latencyMs: totalLatency,
        compressed,
        detectedIntent,
        errorMessage: null,
      });

      return {
        id: requestId,
        model: request.model,
        resolvedProvider: toolFallbackCandidate.connection.provider,
        resolvedModel: toolFallbackCandidate.tier.upstreamModel,
        comboName: target.combo?.name ?? null,
        detectedIntent,
        content: finalContent,
        toolCalls: emulatedCalls,
        promptTokens: adapterResult.promptTokens,
        completionTokens: adapterResult.completionTokens,
        estimatedCostUsd: adapterResult.estimatedCostUsd,
        latencyMs: totalLatency,
        finishReason: finalFinish,
        fallbackAttempts: attempts,
        compressed,
        cached: false,
      };
    } catch {
      // fall through to standard failure recording
    }
  }

  const totalLatency = Date.now() - startedAt;
  const lastFailure = [...attempts].reverse().find((a) => a.status === "failed");
  const allBlockedFreeOnly =
    enforceFreeOnly &&
    blockedByFreeOnlyCount > 0 &&
    blockedByFreeOnlyCount === orderedTiers.length;

  const finalStatus = allBlockedFreeOnly
    ? 403
    : lastFailure?.statusCode || 503;
  const finalReason = allBlockedFreeOnly
    ? `Blocked by Strict Free-Only Lock: "${request.model}" does not resolve to a verified free model.`
    : lastFailure?.reason ||
      "All candidate tiers skipped due to circuit breakers or exhausted quotas.";

  await Promise.allSettled([
    ...pendingDbWrites,
    recordRequestLog({
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
    }),
  ]);

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
  freeOnly?: boolean;
  simulatedFaultConnectionIds?: string[];
}) {
  const target = await resolveRoutingTarget(
    params.userId,
    params.requestedModel
  );
  const strategy = (target.combo?.strategy || "priority") as RoutingStrategy;
  const enforceFreeOnly = Boolean(params.freeOnly || target.combo?.freeOnly);

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
    if (enforceFreeOnly && !isModelKnownFree(connection.provider, tier.upstreamModel)) {
      steps.push({
        order: index + 1,
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        model: tier.upstreamModel,
        weight: tier.weight,
        decision: "skipped",
        reason: "blocked_by_free_only_lock",
      });
      return;
    }

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
