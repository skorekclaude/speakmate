/**
 * SpeakMate — BYOK Encryption (AES-256-GCM)
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): string {
  const key = process.env.BYOK_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("BYOK_ENCRYPTION_KEY must be 64 hex chars (32 bytes).");
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const secret = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, Buffer.from(secret, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(data: string): string {
  const secret = getEncryptionKey();
  const parts = data.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted data format");
  const [ivHex, tagHex, cipherHex] = parts;
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(secret, "hex"), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(cipherHex, "hex", "utf8") + decipher.final("utf8");
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 7) + "***..." + key.slice(-3);
}
