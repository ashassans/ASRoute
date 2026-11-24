import { and, asc, desc, eq, gt, gte, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { databaseMode, db, isNeonConfigured } from "../../db/index.ts";
import {
  account,
  combos,
  comboTiers,
  gatewayApiKeys,
  providerConnections,
  requestLogs,
  wildcardRoutes,
} from "../../db/schema.ts";
import { type AuthedRequest, requireSession } from "../middleware/auth.ts";
import { isGmailMailerConfigured } from "../mailer.ts";
import { publishWorkspaceMutation, subscribeUserLogs } from "../sse.ts";
import { isLocalProvidersAllowed } from "../urlSafety.ts";
import {
  getGatewayBaseUrl,
  parseModelHealth,
  sanitizeConnection,
} from "../utils/connections.ts";

export const analyticsRouter = Router();

const PORT = Number(process.env.PORT || 3000);

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

analyticsRouter.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "AS ROUTER",
    databaseMode,
    neonConfigured: isNeonConfigured,
    googleOAuthEnabled: Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim() &&
        process.env.GOOGLE_CLIENT_SECRET?.trim()
    ),
    emailVerificationEnabled: isGmailMailerConfigured(),
    serverGeminiKeyAvailable: Boolean(process.env.GEMINI_API_KEY?.trim()),
    allowLocalProviders: isLocalProvidersAllowed(),
  });
});

analyticsRouter.get(
  "/bootstrap",
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

      const now = new Date();
      const sanitizedKeys = keys.map((k) => {
        const lastReset = k.quotaResetAt ? new Date(k.quotaResetAt) : new Date(0);
        const resetDaily =
          lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
          lastReset.getUTCMonth() !== now.getUTCMonth() ||
          lastReset.getUTCDate() !== now.getUTCDate();
        const resetMonthly =
          lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
          lastReset.getUTCMonth() !== now.getUTCMonth();
        return {
          ...k,
          keyHash: undefined,
          usedTokensToday: resetDaily ? 0 : k.usedTokensToday,
          usedCostMonth: resetMonthly ? 0 : k.usedCostMonth,
        };
      });

      return res.json({
        user: {
          ...req.authUser,
          hasPassword,
          authProviders,
        },
        environment: {
          databaseMode,
          neonConfigured: isNeonConfigured,
          gatewayEndpoint: getGatewayBaseUrl(req, PORT),
          serverGeminiKeyAvailable: Boolean(process.env.GEMINI_API_KEY?.trim()),
          emailVerificationEnabled: isGmailMailerConfigured(),
          allowLocalProviders: isLocalProvidersAllowed(),
        },
        keys: sanitizedKeys,
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

analyticsRouter.get(
  "/logs",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const rows = await db
        .select()
        .from(requestLogs)
        .where(eq(requestLogs.userId, userId))
        .orderBy(desc(requestLogs.createdAt))
        .limit(limit + 1)
        .offset(offset);
      const hasMore = rows.length > limit;
      const logs = hasMore ? rows.slice(0, limit) : rows;
      return res.json({ logs, hasMore, nextOffset: offset + logs.length });
    } catch (err) {
      console.error("[AS ROUTER] Fetch logs error:", err);
      return res.status(500).json({ error: "Failed to load request logs" });
    }
  }
);

analyticsRouter.delete(
  "/logs",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      await db.delete(requestLogs).where(eq(requestLogs.userId, userId));
      publishWorkspaceMutation(userId, { entity: "logs", action: "clear" });
      return res.json({ ok: true });
    } catch (err) {
      console.error("[AS ROUTER] Clear logs error:", err);
      return res.status(500).json({ error: "Failed to clear logs" });
    }
  }
);

analyticsRouter.get(
  "/logs/stream",
  requireSession,
  (req: AuthedRequest, res: Response) => {
    const userId = req.authUser!.id;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    req.socket?.setNoDelay?.(true);
    res.flushHeaders?.();

    if (process.env.VERCEL === "1") {
      res.write("event: serverless_mode\ndata: {\"vercel\":true}\n\n");
      res.end();
      return;
    }

    const unsubscribe = subscribeUserLogs(userId, res);
    req.on("close", () => {
      unsubscribe();
    });
  }
);

analyticsRouter.get(
  "/live",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const sinceRaw =
        typeof req.query.since === "string" ? req.query.since.trim() : "";
      const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN;
      const hasSince = Number.isFinite(sinceMs) && sinceMs > 0;
      const sinceDate = hasSince ? new Date(sinceMs) : null;

      const [logsRows, conns, keys, userCombos] = await Promise.all([
        sinceDate
          ? db
              .select()
              .from(requestLogs)
              .where(
                and(
                  eq(requestLogs.userId, userId),
                  gt(requestLogs.createdAt, sinceDate)
                )
              )
              .orderBy(desc(requestLogs.createdAt))
              .limit(50)
          : db
              .select()
              .from(requestLogs)
              .where(eq(requestLogs.userId, userId))
              .orderBy(desc(requestLogs.createdAt))
              .limit(25),
        db
          .select({
            id: providerConnections.id,
            isActive: providerConnections.isActive,
            circuitStatus: providerConnections.circuitStatus,
            failureCount: providerConnections.failureCount,
            cooldownUntil: providerConnections.cooldownUntil,
            lastLatencyMs: providerConnections.lastLatencyMs,
            lastError: providerConnections.lastError,
            usedRequestsToday: providerConnections.usedRequestsToday,
            usedTokensToday: providerConnections.usedTokensToday,
            usedCostMonth: providerConnections.usedCostMonth,
            modelHealth: providerConnections.modelHealth,
          })
          .from(providerConnections)
          .where(eq(providerConnections.userId, userId)),
        db
          .select({
            id: gatewayApiKeys.id,
            isActive: gatewayApiKeys.isActive,
            usedTokensToday: gatewayApiKeys.usedTokensToday,
            usedCostMonth: gatewayApiKeys.usedCostMonth,
            quotaResetAt: gatewayApiKeys.quotaResetAt,
            totalRequests: gatewayApiKeys.totalRequests,
            totalTokens: gatewayApiKeys.totalTokens,
            totalCostUsd: gatewayApiKeys.totalCostUsd,
            lastUsedAt: gatewayApiKeys.lastUsedAt,
          })
          .from(gatewayApiKeys)
          .where(eq(gatewayApiKeys.userId, userId)),
        db
          .select({
            id: combos.id,
            roundRobinCursor: combos.roundRobinCursor,
          })
          .from(combos)
          .where(eq(combos.userId, userId)),
      ]);

      const comboIds = userCombos.map((c) => c.id);
      const tierCounts =
        comboIds.length > 0
          ? await db
              .select({
                id: comboTiers.id,
                comboId: comboTiers.comboId,
                requestCount: comboTiers.requestCount,
              })
              .from(comboTiers)
              .where(inArray(comboTiers.comboId, comboIds))
          : [];

      const now = new Date();
      return res.json({
        serverTime: now.toISOString(),
        incremental: Boolean(sinceDate),
        logs: logsRows,
        connections: conns.map((c) => ({
          ...c,
          modelHealth: parseModelHealth(c.modelHealth),
        })),
        keys: keys.map((k) => {
          const lastReset = k.quotaResetAt
            ? new Date(k.quotaResetAt)
            : new Date(0);
          const resetDaily =
            lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
            lastReset.getUTCMonth() !== now.getUTCMonth() ||
            lastReset.getUTCDate() !== now.getUTCDate();
          const resetMonthly =
            lastReset.getUTCFullYear() !== now.getUTCFullYear() ||
            lastReset.getUTCMonth() !== now.getUTCMonth();
          return {
            id: k.id,
            isActive: k.isActive,
            usedTokensToday: resetDaily ? 0 : k.usedTokensToday,
            usedCostMonth: resetMonthly ? 0 : k.usedCostMonth,
            totalRequests: k.totalRequests,
            totalTokens: k.totalTokens,
            totalCostUsd: k.totalCostUsd,
            lastUsedAt: k.lastUsedAt,
          };
        }),
        combos: userCombos.map((c) => ({
          id: c.id,
          roundRobinCursor: c.roundRobinCursor,
          tiers: tierCounts.filter((t) => t.comboId === c.id),
        })),
      });
    } catch (err) {
      console.error("[AS ROUTER] Live sync error:", err);
      return res.status(500).json({ error: "Failed to sync live telemetry" });
    }
  }
);

analyticsRouter.get(
  "/analytics",
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
          .select({
            requestedModel: requestLogs.requestedModel,
            resolvedProvider: requestLogs.resolvedProvider,
            resolvedModel: requestLogs.resolvedModel,
            comboName: requestLogs.comboName,
            apiKeyId: requestLogs.apiKeyId,
            apiKeyPrefix: requestLogs.apiKeyPrefix,
            outcome: requestLogs.outcome,
            promptTokens: requestLogs.promptTokens,
            completionTokens: requestLogs.completionTokens,
            estimatedCostUsd: requestLogs.estimatedCostUsd,
            latencyMs: requestLogs.latencyMs,
            createdAt: requestLogs.createdAt,
          })
          .from(requestLogs)
          .where(
            and(
              eq(requestLogs.userId, userId),
              gte(requestLogs.createdAt, prevStart)
            )
          )
          .orderBy(asc(requestLogs.createdAt)),
        db
          .select({
            id: gatewayApiKeys.id,
            name: gatewayApiKeys.name,
            keyPrefix: gatewayApiKeys.keyPrefix,
          })
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

        const keyMapId =
          row.apiKeyId || row.apiKeyPrefix || "dashboard-playground";
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
