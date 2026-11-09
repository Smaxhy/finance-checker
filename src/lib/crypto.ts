import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Application-level encryption for OAuth refresh tokens and bank session ids.
 * AES-256-GCM with a random 96-bit IV. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 * TOKEN_ENCRYPTION_KEY must be 32 bytes, given as base64 or 64 hex chars.
 */
function key(): Buffer {
  const raw = env.tokenEncryptionKey;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set; refusing to store credentials unencrypted.");
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return buf;
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptJson<T>(payload: string): T {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}

/** Keyed hash used to match IBANs (e.g. own-account transfers) without storing them in clear. */
export function hashIdentifier(value: string): string {
  const normalised = value.replace(/\s+/g, "").toUpperCase();
  const secret = env.tokenEncryptionKey ?? "unkeyed";
  return createHmac("sha256", secret).update(normalised).digest("hex").slice(0, 32);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
