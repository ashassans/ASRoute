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
import {
  type ComboPresetId,
  getConnectionPrefix,
  getModelSpec,
  getModelUnitCost,
  isModelKnownFree,
  isSearchProvider,
  matchPresetForConnection,
  READY_MADE_COMBO_PRESETS,
} from "../../shared/catalog.ts";
import { type AuthedRequest, requireSession } from "../middleware/auth.ts";
import {
  clearGatewayResponseCache,
  simulateComboRoute,
} from "../routerEngine.ts";
import { publishWorkspaceMutation } from "../sse.ts";
import { parseAvailableModels, parseModelHealth } from "../utils/connections.ts";

export const combosRouter = Router();

export async function validateLlmComboConnections(
  userId: string,
  connectionIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const uniqueIds = Array.from(new Set(connectionIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { ok: false, error: "Each tier must reference a valid connection." };
  }
  const rows = await db
    .select({
      id: providerConnections.id,
      provider: providerConnections.provider,
    })
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.userId, userId),
        inArray(providerConnections.id, uniqueIds)
      )
    );
  if (rows.length !== uniqueIds.length) {
    return {
      ok: false,
      error: "One or more selected provider connections were not found.",
    };
  }
  if (rows.some((r) => isSearchProvider(r.provider))) {
    return {
      ok: false,
      error:
        "Web search providers (Tavily, Brave Search, Exa) cannot be added to AI combos.",
    };
  }
  return { ok: true };
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
      const tierCheck = await validateLlmComboConnections(userId, tierConnIds);
      if (!tierCheck.ok) {
        return res.status(400).json({ error: tierCheck.error });
      }

      const cleanName = name.trim();
      const existingUserCombos = await db
        .select({ id: combos.id, name: combos.name })
        .from(combos)
        .where(eq(combos.userId, userId));
      if (
        existingUserCombos.some(
          (c) => c.name.trim().toLowerCase() === cleanName.toLowerCase()
        )
      ) {
        return res.status(409).json({
          error: `A combo named "${cleanName}" already exists in your workspace.`,
        });
      }

      const comboId = `combo_${crypto.randomBytes(8).toString("hex")}`;
      const [created] = await db
        .insert(combos)
        .values({
          id: comboId,
          userId,
          name: cleanName,
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
          maxRetries:
            typeof t.maxRetries === "number"
              ? Math.min(3, Math.max(1, Math.round(t.maxRetries)))
              : 1,
        })
      );

      const insertedTiers =
        tierValues.length > 0
          ? await db.insert(comboTiers).values(tierValues).returning()
          : [];

      const comboPayload = { ...created, tiers: insertedTiers };
      publishWorkspaceMutation(userId, {
        entity: "combo",
        action: "upsert",
        id: created.id,
        record: comboPayload,
      });

      return res.status(201).json({
        combo: comboPayload,
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
        if (isSearchProvider(conn.provider)) continue;
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

      const comboPayload = { ...comboRow, tiers: insertedTiers };
      publishWorkspaceMutation(userId, {
        entity: "combo",
        action: "upsert",
        id: comboRow.id,
        record: comboPayload,
      });

      return res.json({
        combo: comboPayload,
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

export function buildReadyMadeComboTiers(
  presetId: ComboPresetId,
  activeConns: Array<typeof providerConnections.$inferSelect>
): Array<{ connectionId: string; upstreamModel: string; score: number }> {
  interface ScoredCandidate {
    connectionId: string;
    upstreamModel: string;
    score: number;
    latencyMs: number;
    healthOk: boolean;
  }

  const candidates: ScoredCandidate[] = [];
  const seen = new Set<string>();

  for (const conn of activeConns) {
    if (isSearchProvider(conn.provider)) continue;
    const prefix = getConnectionPrefix(conn);
    const matchedPreset = matchPresetForConnection(conn);
    const healthMap = parseModelHealth(conn.modelHealth);
    const synced = parseAvailableModels(conn.availableModels);

    const poolModels = Array.from(
      new Set([
        ...(conn.defaultModel ? [conn.defaultModel] : []),
        ...synced.slice(0, 12),
        ...(matchedPreset?.defaultModel ? [matchedPreset.defaultModel] : []),
        ...(conn.provider === "gemini"
          ? ["gemini-4-hydrogen", "gemini-4-argon", "gemini-3.1-flash-lite"]
          : []),
      ])
    ).filter(Boolean);

    for (const modelId of poolModels) {
      const dedupKey = `${conn.id}:${modelId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      if (presetId === "free-pool" && !isModelKnownFree(conn.provider, modelId)) {
        continue;
      }

      const health = healthMap[modelId];
      const healthOk = health ? health.ok : true;
      const latencyMs = health?.latencyMs ?? conn.lastLatencyMs ?? 1200;
      const lower = modelId.toLowerCase();
      const spec = getModelSpec(conn.provider, modelId);
      let score = healthOk ? 20 : -80;
      if (modelId === conn.defaultModel) score += 10;

      if (presetId === "fast-chat") {
        if (["groq", "cerebras", "sambanova"].includes(prefix)) score += 40;
        if (
          /(flash|hydrogen|mini|lite|haiku|instant|nano|8b|fast|luna)/i.test(
            lower
          )
        ) {
          score += 35;
        }
        if (spec?.capabilities.includes("fast")) score += 20;
        if (/(opus|r1|reasoner|405b)/i.test(lower)) score -= 25;
        score += Math.max(0, 20 - Math.floor(latencyMs / 150));
      } else if (presetId === "coding-pro") {
        if (
          /(coder|codestral|sonnet|opus|gpt-6|gpt-5|gpt-4\.1|deepseek|qwen|gemini-4|grok|llama-3\.3-70b|llama-4)/i.test(
            lower
          )
        ) {
          score += 40;
        }
        if (spec?.capabilities.includes("coding")) score += 25;
        if (spec?.capabilities.includes("tools")) score += 10;
        if (/(nano|8b)/i.test(lower)) score -= 15;
      } else if (presetId === "deep-reasoning") {
        if (
          /(r1|reasoner|thinking|o4|o3|o1|argon|carbon|opus|qwq|sonar-reasoning|pro|large|grok-4)/i.test(
            lower
          )
        ) {
          score += 45;
        }
        if (spec?.capabilities.includes("reasoning")) score += 25;
        if (spec?.tierRank === "flagship") score += 15;
        if (/(mini|lite|nano|haiku)/i.test(lower)) score -= 20;
      } else if (presetId === "budget-saver") {
        const unitCost = getModelUnitCost(conn.provider, modelId);
        score += Math.max(0, 60 - Math.round(unitCost * 5));
        if (isModelKnownFree(conn.provider, modelId)) score += 30;
      } else if (presetId === "free-pool") {
        score += Math.max(0, 30 - Math.floor(latencyMs / 120));
      } else {
        // smart-auto: balanced multi-capability mix
        if (spec?.tierRank === "flagship") score += 20;
        else if (spec?.tierRank === "balanced") score += 18;
        if (spec?.capabilities.includes("tools")) score += 10;
        if (spec?.capabilities.includes("coding")) score += 10;
      }

      candidates.push({
        connectionId: conn.id,
        upstreamModel: modelId,
        score,
        latencyMs,
        healthOk,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.latencyMs - b.latencyMs;
  });

  // First pick the top model per unique connection so failover spans multiple providers
  const selected: ScoredCandidate[] = [];
  const usedKeys = new Set<string>();
  const seenConns = new Set<string>();

  for (const item of candidates) {
    if (seenConns.has(item.connectionId)) continue;
    seenConns.add(item.connectionId);
    selected.push(item);
    usedKeys.add(`${item.connectionId}:${item.upstreamModel}`);
    if (selected.length >= 12) break;
  }

  // Fill remaining slots up to 12 with highest-scoring backups
  for (const item of candidates) {
    if (selected.length >= 12) break;
    const key = `${item.connectionId}:${item.upstreamModel}`;
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    selected.push(item);
  }

  return selected.map((s) => ({
    connectionId: s.connectionId,
    upstreamModel: s.upstreamModel,
    score: s.score,
  }));
}

combosRouter.post(
  "/combos/preset",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const presetId = String(req.body?.presetId || "").trim() as ComboPresetId;
      const preset = READY_MADE_COMBO_PRESETS.find((p) => p.id === presetId);
      if (!preset) {
        return res.status(400).json({ error: "Unknown combo preset." });
      }

      const activeConns = await db
        .select()
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.userId, userId),
            eq(providerConnections.isActive, true)
          )
        );

      const activeLlmConns = activeConns.filter(
        (c) => !isSearchProvider(c.provider)
      );
      if (activeLlmConns.length === 0) {
        return res.status(400).json({
          error:
            "Connect and enable at least one AI model provider first. Web search providers cannot be combined into AI combos.",
        });
      }

      const pickedTiers = buildReadyMadeComboTiers(preset.id, activeLlmConns);
      if (pickedTiers.length === 0) {
        return res.status(400).json({
          error:
            preset.id === "free-pool"
              ? "No verified free models found across active providers. Run 'Sync free' on a provider or connect Groq/Gemini/OpenRouter first."
              : "No usable models found across active connections.",
        });
      }

      const userCombos = await db
        .select()
        .from(combos)
        .where(eq(combos.userId, userId));
      const existing = userCombos.find(
        (c) => c.name.trim().toLowerCase() === preset.name.toLowerCase()
      );

      let comboRow: typeof combos.$inferSelect;
      if (existing) {
        const [updated] = await db
          .update(combos)
          .set({
            description: preset.description,
            strategy: preset.strategy,
            compressPrompt: preset.compressPrompt,
            freeOnly: preset.freeOnly,
            enableCache: preset.enableCache,
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
            name: preset.name,
            description: preset.description,
            strategy: preset.strategy,
            compressPrompt: preset.compressPrompt,
            freeOnly: preset.freeOnly,
            enableCache: preset.enableCache,
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
      const insertedTiers = await db
        .insert(comboTiers)
        .values(tierValues)
        .returning();

      const comboPayload = { ...comboRow, tiers: insertedTiers };
      publishWorkspaceMutation(userId, {
        entity: "combo",
        action: "upsert",
        id: comboRow.id,
        record: comboPayload,
      });

      return res.json({
        combo: comboPayload,
        tierCount: insertedTiers.length,
        updated: Boolean(existing),
      });
    } catch (err) {
      console.error("[AS ROUTER] Create ready-made combo error:", err);
      return res
        .status(500)
        .json({ error: "Failed to build ready-made combo" });
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
        const tierCheck = await validateLlmComboConnections(
          userId,
          tierConnIds
        );
        if (!tierCheck.ok) {
          return res.status(400).json({ error: tierCheck.error });
        }
      }

      const updates: Partial<typeof combos.$inferInsert> = {};
      if (typeof name === "string" && name.trim()) {
        const cleanName = name.trim();
        const existingUserCombos = await db
          .select({ id: combos.id, name: combos.name })
          .from(combos)
          .where(eq(combos.userId, userId));
        if (
          existingUserCombos.some(
            (c) =>
              c.id !== id &&
              c.name.trim().toLowerCase() === cleanName.toLowerCase()
          )
        ) {
          return res.status(409).json({
            error: `Another combo named "${cleanName}" already exists.`,
          });
        }
        updates.name = cleanName;
      }
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
            maxRetries:
              typeof t.maxRetries === "number"
                ? Math.min(3, Math.max(1, Math.round(t.maxRetries)))
                : 1,
          })
        );
        currentTiers =
          tierValues.length > 0
            ? await db.insert(comboTiers).values(tierValues).returning()
            : [];
      }

      const comboPayload = { ...updated, tiers: currentTiers };
      publishWorkspaceMutation(userId, {
        entity: "combo",
        action: "upsert",
        id: updated.id,
        record: comboPayload,
      });

      return res.json({ combo: comboPayload });
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
      publishWorkspaceMutation(userId, {
        entity: "combo",
        action: "delete",
        id,
      });
      return res.json({ ok: true, id });
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
      publishWorkspaceMutation(userId, {
        entity: "wildcard",
        action: "upsert",
        id: created.id,
        record: created,
      });
      return res.status(201).json({ wildcard: created });
    } catch (err) {
      console.error("[AS ROUTER] Create wildcard error:", err);
      return res.status(500).json({ error: "Failed to create wildcard route" });
    }
  }
);

combosRouter.patch(
  "/wildcards/:id",
  requireSession,
  async (req: AuthedRequest, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { id } = req.params;
      const { pattern, comboId, isActive } = req.body || {};

      const updates: Partial<typeof wildcardRoutes.$inferInsert> = {};
      if (typeof pattern === "string" && pattern.trim()) {
        updates.pattern = pattern.trim();
      }
      if (typeof comboId === "string" && comboId.trim()) {
        const [ownedCombo] = await db
          .select({ id: combos.id })
          .from(combos)
          .where(and(eq(combos.id, comboId.trim()), eq(combos.userId, userId)));
        if (!ownedCombo) {
          return res.status(400).json({ error: "Target combo not found." });
        }
        updates.comboId = ownedCombo.id;
      }
      if (typeof isActive === "boolean") {
        updates.isActive = isActive;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No wildcard updates provided." });
      }

      const [updated] = await db
        .update(wildcardRoutes)
        .set(updates)
        .where(
          and(eq(wildcardRoutes.id, id), eq(wildcardRoutes.userId, userId))
        )
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Wildcard route not found" });
      }

      publishWorkspaceMutation(userId, {
        entity: "wildcard",
        action: "upsert",
        id: updated.id,
        record: updated,
      });
      return res.json({ wildcard: updated });
    } catch (err) {
      console.error("[AS ROUTER] Update wildcard error:", err);
      return res.status(500).json({ error: "Failed to update wildcard route" });
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
      publishWorkspaceMutation(userId, {
        entity: "wildcard",
        action: "delete",
        id,
      });
      return res.json({ ok: true, id });
    } catch (err) {
      console.error("[AS ROUTER] Delete wildcard error:", err);
      return res.status(500).json({ error: "Failed to delete wildcard route" });
    }
  }
);
