// Browser replacement for src/lib/crypto.ts. There are no server credentials to
// encrypt in the GitHub Pages edition; identifier hashing uses the shared pure-JS helper.
import { hashIdentifierWith, sha256Hex } from "@/lib/hash";

export function hashIdentifier(value: string): string {
  return hashIdentifierWith("local-edition", value);
}

export function sha256(value: string): string {
  return sha256Hex(value);
}

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encryptJson(): string {
  throw new Error("Credential storage is not available in the GitHub Pages edition");
}

export function decryptJson<T>(): T {
  throw new Error("Credential storage is not available in the GitHub Pages edition");
}
