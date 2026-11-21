import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type Response } from "express";
import { db } from "../../db/index.ts";
import { gatewayApiKeys } from "../../db/schema.ts";
import { generateGatewayApiKey } from "../crypto.ts";
import { type AuthedRequest, requireSession } from "../middleware/auth.ts";

export const keysRouter = Router();

keysRouter.post(
  "/",
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

keysRouter.patch(
  "/:id",
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

keysRouter.delete(
  "/:id",
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
