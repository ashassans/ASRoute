import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { db } from "../../db/index.ts";
import { providerConnections } from "../../db/schema.ts";
import { decryptSecret, encryptSecret } from "../crypto.ts";
import { type AuthedRequest, requireSession } from "../middleware/auth.ts";
import {
  fetchProviderModels,
  probeProviderFreeModels,
  testProviderConnection,
} from "../providers.ts";
import { publishCircuitUpdate, publishWorkspaceMutation } from "../sse.ts";
import { validateOutboundUrl } from "../urlSafety.ts";
import {
  decryptConnectionAllKeys,
  parseAvailableModels,
  parseExtraApiKeyInput,
  parseModelHealth,
  sanitizeConnection,
  serializeAvailableModels,
  serializeEncryptedKeyPool,
} from "../utils/connections.ts";

export const providersRouter = Router();

providersRouter.post(
  "/fetch-models",
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

      if (resolvedBaseUrl) {
        try {
          validateOutboundUrl(resolvedBaseUrl, "provider base URL");
        } catch (urlErr: unknown) {
          return res.status(400).json({
            error:
              urlErr instanceof Error
                ? urlErr.message
                : "Invalid provider base URL.",
          });
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

      let updatedConnPayload: ReturnType<typeof sanitizeConnection> | undefined;
      if (typeof connectionId === "string" && connectionId.trim()) {
        const [updatedConn] = await db
          .update(providerConnections)
          .set({
            availableModels: JSON.stringify(models),
          })
          .where(
            and(
              eq(providerConnections.id, connectionId.trim()),
              eq(providerConnections.userId, userId)
            )
          )
          .returning();
        if (updatedConn) {
          updatedConnPayload = sanitizeConnection(updatedConn);
          publishWorkspaceMutation(userId, {
            entity: "provider",
            action: "upsert",
            id: updatedConn.id,
            record: updatedConnPayload,
          });
        }
      }

      return res.json({ models, connection: updatedConnPayload });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch upstream models";
      return res.status(502).json({ error: message });
    }
  }
);

providersRouter.post(
  "/",
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

      const trimmedBaseUrl =
        baseUrl && String(baseUrl).trim() ? String(baseUrl).trim() : null;
      if (trimmedBaseUrl) {
        try {
          validateOutboundUrl(trimmedBaseUrl, "provider base URL");
        } catch (urlErr: unknown) {
          return res.status(400).json({
            error:
              urlErr instanceof Error
                ? urlErr.message
                : "Invalid provider base URL.",
          });
        }
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
          baseUrl: trimmedBaseUrl,
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
            rpmLimit && Number(rpmLimit) > 0
              ? Math.round(Number(rpmLimit))
              : null,
          rpdLimit:
            rpdLimit && Number(rpdLimit) > 0
              ? Math.round(Number(rpdLimit))
              : null,
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

      const sanitized = sanitizeConnection(created);
      publishWorkspaceMutation(userId, {
        entity: "provider",
        action: "upsert",
        id: created.id,
        record: sanitized,
      });

      return res.status(201).json({
        connection: sanitized,
      });
    } catch (err) {
      console.error("[AS ROUTER] Create provider error:", err);
      return res
        .status(500)
        .json({ error: "Failed to create provider connection" });
    }
  }
);

providersRouter.patch(
  "/:id",
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
        const trimmedBaseUrl =
          baseUrl && String(baseUrl).trim() ? String(baseUrl).trim() : null;
        if (trimmedBaseUrl) {
          try {
            validateOutboundUrl(trimmedBaseUrl, "provider base URL");
          } catch (urlErr: unknown) {
            return res.status(400).json({
              error:
                urlErr instanceof Error
                  ? urlErr.message
                  : "Invalid provider base URL.",
            });
          }
        }
        updates.baseUrl = trimmedBaseUrl;
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
          rpmLimit && Number(rpmLimit) > 0
            ? Math.round(Number(rpmLimit))
            : null;
      }
      if (rpdLimit !== undefined) {
        updates.rpdLimit =
          rpdLimit && Number(rpdLimit) > 0
            ? Math.round(Number(rpdLimit))
            : null;
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

      const sanitized = sanitizeConnection(updated);
      publishWorkspaceMutation(userId, {
        entity: "provider",
        action: "upsert",
        id: updated.id,
        record: sanitized,
      });

      return res.json({
        connection: sanitized,
      });
    } catch (err) {
      console.error("[AS ROUTER] Update provider error:", err);
      return res
        .status(500)
        .json({ error: "Failed to update provider connection" });
    }
  }
);

providersRouter.post(
  "/:id/test",
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

      const [updatedConn] = await db
        .update(providerConnections)
        .set({
          lastLatencyMs: result.latencyMs,
          lastError: result.ok ? null : result.detail,
          circuitStatus: result.ok ? "healthy" : conn.circuitStatus,
          failureCount: result.ok ? 0 : conn.failureCount,
          cooldownUntil: result.ok ? null : conn.cooldownUntil,
        })
        .where(eq(providerConnections.id, conn.id))
        .returning();

      if (result.ok && conn.circuitStatus !== "healthy") {
        publishCircuitUpdate(userId, conn.id, "healthy");
      }

      const sanitized = updatedConn ? sanitizeConnection(updatedConn) : undefined;
      if (sanitized) {
        publishWorkspaceMutation(userId, {
          entity: "provider",
          action: "upsert",
          id: conn.id,
          record: sanitized,
        });
      }

      return res.json({ ...result, connection: sanitized });
    } catch (err) {
      console.error("[AS ROUTER] Test provider error:", err);
      return res
        .status(500)
        .json({ error: "Failed to test provider connection" });
    }
  }
);

providersRouter.post(
  "/:id/probe-free",
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

      const [updatedConn] = await db
        .update(providerConnections)
        .set({
          modelHealth: JSON.stringify(probeResult.healthMap),
          ...(fastestHealthy ? { lastLatencyMs: fastestHealthy.latencyMs } : {}),
        })
        .where(eq(providerConnections.id, conn.id))
        .returning();

      const sanitized = updatedConn ? sanitizeConnection(updatedConn) : undefined;
      if (sanitized) {
        publishWorkspaceMutation(userId, {
          entity: "provider",
          action: "upsert",
          id: conn.id,
          record: sanitized,
        });
      }

      return res.json({ ...probeResult, connection: sanitized });
    } catch (err) {
      console.error("[AS ROUTER] Probe free models error:", err);
      return res.status(500).json({ error: "Failed to probe free models" });
    }
  }
);

providersRouter.post(
  "/:id/reset-circuit",
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
      const sanitized = sanitizeConnection(updated);
      publishCircuitUpdate(userId, updated.id, "healthy");
      publishWorkspaceMutation(userId, {
        entity: "provider",
        action: "upsert",
        id: updated.id,
        record: sanitized,
      });
      return res.json({ ok: true, connection: sanitized });
    } catch (err) {
      console.error("[AS ROUTER] Reset circuit error:", err);
      return res.status(500).json({ error: "Failed to reset circuit breaker" });
    }
  }
);

providersRouter.delete(
  "/:id",
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
      publishWorkspaceMutation(userId, {
        entity: "provider",
        action: "delete",
        id,
      });
      return res.json({ ok: true, id });
    } catch (err) {
      console.error("[AS ROUTER] Delete provider error:", err);
      return res
        .status(500)
        .json({ error: "Failed to delete provider connection" });
    }
  }
);
