import type { Request } from "express";
import { providerConnections } from "../../db/schema.ts";
import type { ModelHealthEntry } from "../../types/gateway.ts";
import { decryptSecret, encryptSecret, maskSecret } from "../crypto.ts";

export function parseAvailableModels(raw: string | null | undefined): string[] {
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

export function serializeAvailableModels(input: unknown): string | null {
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

export function parseModelHealth(
  raw: string | null | undefined
): Record<string, ModelHealthEntry> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, ModelHealthEntry>)
      : {};
  } catch {
    return {};
  }
}

export function parseExtraApiKeyInput(input: unknown): string[] {
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

export function serializeEncryptedKeyPool(rawKeys: string[]): string | null {
  if (rawKeys.length === 0) return null;
  const encrypted = rawKeys.map((k) => encryptSecret(k));
  return JSON.stringify(encrypted);
}

export function decryptConnectionAllKeys(
  conn: typeof providerConnections.$inferSelect
): string[] {
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

export function sanitizeConnection(
  c: typeof providerConnections.$inferSelect
) {
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

export function getGatewayBaseUrl(req: Request, port: number): string {
  if (process.env.APP_URL?.trim()) {
    return `${process.env.APP_URL.replace(/\/+$/, "")}/v1`;
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host =
    req.headers["x-forwarded-host"] || req.get("host") || `localhost:${port}`;
  return `${proto}://${host}/v1`;
}
