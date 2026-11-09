import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { hmacSha256Hex, sha256Hex } from "./hash";

describe("pure-JS hashing matches Node's crypto", () => {
  it("sha256", () => {
    for (const s of ["", "abc", "a".repeat(55), "a".repeat(64), "é€ unicode ✓", "x".repeat(1000)]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });
  it("hmac-sha256", () => {
    for (const [k, m] of [["key", "BE68539007547034"], ["k".repeat(100), "msg"], ["", ""]]) {
      expect(hmacSha256Hex(k, m)).toBe(createHmac("sha256", k).update(m).digest("hex"));
    }
  });
});
