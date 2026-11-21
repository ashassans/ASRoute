import crypto from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type Response } from "express";
import { db } from "../../db/index.ts";
import {
  combos,
  comboTiers,
  providerConnections,
  wildcardRoutes,
} from "../../db/schema.ts";
import { isModelKnownFree } from "../../shared/catalog.ts";
import { type AuthedRequest, requireSession } from "../middleware/auth.ts";
import {
  clearGatewayResponseCache,
  simulateComboRoute,
} from "../routerEngine.ts";
import { parseAvailableModels, parseModelHealth } from "../utils/connections.ts";

export const combosRouter = Router();

async function verifyOwnedConnections(
  userId: string,
  connectionIds: string[]
): Promise<boolean> {
  const uniqueIds = Array.from(new Set(connectionIds.filter(Boolean)));
  if (uniqueIds.length === 0) return false;
  const rows = await db
    .select({ id: providerConnections.id })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        inArray(providerConnections.id, uniqueIds)
      )
    );
  return rows.length === uniqueIds.length;
}

combosRouter.post(
  "/combos",
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

      const tierConnIds = tiers.map((t: { connectionId?: unknown }) =>
        String(t?.connectionId || "").trim()
      );
      if (tierConnIds.some((cid) => !cid)) {
        return res
          .status(400)
          .json({ error: "Each tier must reference a valid connection." });
      }
      const allOwned = await verifyOwnedConnections(userId, tierConnIds);
      if (!allOwned) {
        return res.status(400).json({
          error: "One or more selected provider connections were not found.",
        });
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
          connectionId: String(t.connectionId).trim(),
          upstreamModel: String(t.upstreamModel).trim(),
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

combosRouter.post(
  "/combos/free-auto",
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
            description:
              "Auto-built failover pool across all connected free models",
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
            description:
              "Auto-built failover pool across all connected free models",
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
      return res
        .status(500)
        .json({ error: "Failed to build free-auto combo" });
    }
  }
);

combosRouter.patch(
  "/combos/:id",
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

      if (Array.isArray(tiers)) {
        if (tiers.length === 0) {
          return res
            .status(400)
            .json({ error: "At least one provider tier is required." });
        }
        const tierConnIds = tiers.map((t: { connectionId?: unknown }) =>
          String(t?.connectionId || "").trim()
        );
        if (tierConnIds.some((cid) => !cid)) {
          return res
            .status(400)
            .json({ error: "Each tier must reference a valid connection." });
        }
        const allOwned = await verifyOwnedConnections(userId, tierConnIds);
        if (!allOwned) {
          return res.status(400).json({
            error: "One or more selected provider connections were not found.",
          });
        }
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

      const updated =
        Object.keys(updates).length > 0
          ? (
              await db
                .update(combos)
                .set(updates)
                .where(and(eq(combos.id, id), eq(combos.userId, userId)))
                .returning()
            )[0]
          : existing;

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
            connectionId: String(t.connectionId).trim(),
            upstreamModel: String(t.upstreamModel).trim(),
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

combosRouter.delete(
  "/combos/:id",
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

combosRouter.post(
  "/combos/simulate",
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

combosRouter.post(
  "/cache/clear",
  requireSession,
  (req: AuthedRequest, res: Response) => {
    const cleared = clearGatewayResponseCache(req.authUser!.id);
    return res.json({ ok: true, cleared });
  }
);

combosRouter.post(
  "/wildcards",
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

      const [ownedCombo] = await db
        .select({ id: combos.id })
        .from(combos)
        .where(
          and(
            eq(combos.id, String(comboId).trim()),
            eq(combos.userId, userId)
          )
        );
      if (!ownedCombo) {
        return res.status(400).json({
          error: "Target combo not found in your workspace.",
        });
      }

      const [created] = await db
        .insert(wildcardRoutes)
        .values({
          id: `wc_${crypto.randomBytes(8).toString("hex")}`,
          userId,
          pattern: String(pattern).trim(),
          comboId: ownedCombo.id,
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

combosRouter.delete(
  "/wildcards/:id",
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
