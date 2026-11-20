import crypto from "node:crypto";

const RAW_SECRET =
  process.env.BETTER_AUTH_SECRET?.trim() ||
  process.env.APP_URL?.trim() ||
  "as-router-default-session-and-vault-secret-key-2026";

function deriveEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(RAW_SECRET).digest();
}

export function getAuthSecret(): string {
  if (RAW_SECRET.length >= 32) {
    return RAW_SECRET;
  }
  return crypto.createHash("sha256").update(RAW_SECRET).digest("hex");
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
