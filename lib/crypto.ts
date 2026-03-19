import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/**
 * Lightweight AES-256-GCM field-level encryption for Room content.
 *
 * Design principles:
 * - Fast: AES-GCM is hardware-accelerated on all modern CPUs (~1GB/s)
 * - Minimal overhead: ~28 bytes per encrypted field (12 IV + 16 auth tag)
 * - No E2E/TEE complexity: Server-side encryption at rest
 * - User perception: Content is encrypted in transit (TLS) + at rest (AES-GCM)
 * - Does NOT impact performance: <0.1ms per encrypt/decrypt operation
 *
 * The encryption key is derived from ROOM_ENCRYPTION_KEY env var.
 * If not set, falls back to a deterministic key from DATABASE_URL (still encrypted, just not independently keyed).
 */

function getEncryptionKey(): Buffer {
  const envKey = process.env.ROOM_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 32) {
    return createHash("sha256").update(envKey).digest();
  }
  // Fallback: derive from DATABASE_URL so content is still encrypted at rest
  const fallback = process.env.DATABASE_URL || "avep-default-key-change-me";
  return createHash("sha256").update(fallback).digest();
}

const KEY = getEncryptionKey();

/**
 * Encrypt a string using AES-256-GCM.
 * Returns: base64 string of (IV + ciphertext + authTag)
 * Overhead: ~28 bytes + base64 expansion (~37%)
 * Speed: <0.1ms for typical Room messages (1-10KB)
 */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Pack: IV(12) + authTag(16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Input: base64 string from encryptField()
 * Returns: original plaintext
 */
export function decryptField(ciphertext: string): string {
  const packed = Buffer.from(ciphertext, "base64");
  const iv = packed.subarray(0, 12);
  const authTag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Check if a string looks like it's already encrypted (base64 with correct structure).
 */
export function isEncrypted(value: string): boolean {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length >= 28 && value === buf.toString("base64");
  } catch {
    return false;
  }
}

/**
 * Smart encrypt: only encrypt if not already encrypted.
 */
export function smartEncrypt(value: string): string {
  if (isEncrypted(value)) return value;
  return encryptField(value);
}

/**
 * Smart decrypt: only decrypt if it looks encrypted; otherwise return as-is.
 * This enables backward compatibility with existing unencrypted data.
 */
export function smartDecrypt(value: string): string {
  if (!isEncrypted(value)) return value;
  try {
    return decryptField(value);
  } catch {
    // Not actually encrypted or wrong key - return as-is
    return value;
  }
}
