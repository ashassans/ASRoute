import crypto from "node:crypto";

const globalCryptoState = globalThis as typeof globalThis & {
  _asRouterAuthSecret?: string;
  _asRouterVaultSecret?: string;
  _asRouterWarnedSecret?: boolean;
};

export function getAuthSecret(): string {
  const envSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (envSecret) {
    if (envSecret.length >= 32) return envSecret;
    return crypto.createHash("sha256").update(envSecret).digest("hex");
  }

  if (!globalCryptoState._asRouterAuthSecret) {
    globalCryptoState._asRouterAuthSecret = crypto
      .randomBytes(32)
      .toString("hex");
    if (
      process.env.NODE_ENV === "production" &&
      !globalCryptoState._asRouterWarnedSecret
    ) {
      globalCryptoState._asRouterWarnedSecret = true;
      console.warn(
        "[AS ROUTER] BETTER_AUTH_SECRET is not set. Using an ephemeral random signing secret for this process."
      );
    }
  }
  return globalCryptoState._asRouterAuthSecret;
}

function deriveEncryptionKey(): Buffer {
  const secretSource =
    process.env.BETTER_AUTH_SECRET?.trim() ||
    globalCryptoState._asRouterVaultSecret ||
    getAuthSecret();
  return crypto.createHash("sha256").update(secretSource).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential payload");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = deriveEncryptionKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function maskSecret(plaintext: string): string {
  if (!plaintext) return "••••";
  if (plaintext.length <= 10) return "••••" + plaintext.slice(-2);
  return `${plaintext.slice(0, 6)}••••${plaintext.slice(-4)}`;
}

export function generateGatewayApiKey(): {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const randomPart = crypto.randomBytes(24).toString("base64url");
  const rawKey = `sk-asr-${randomPart}`;
  const keyPrefix = `${rawKey.slice(0, 11)}••••${rawKey.slice(-4)}`;
  const keyHash = hashGatewayApiKey(rawKey);
  return { rawKey, keyPrefix, keyHash };
}

export function hashGatewayApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}
