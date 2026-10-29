import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, deletionChallengeResponse, encrypt } from "@/lib/crypto";

describe("encrypt / decrypt", () => {
  const key = randomBytes(32).toString("base64");

  it("round-trips a refresh token", () => {
    const token = "v^1.1#i^1#r^1#p^3#f^0#t^Ul4xMF8yOj" + "x".repeat(200);
    const enc = encrypt(token, key);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(enc).not.toContain(token);
    expect(decrypt(enc, key)).toBe(token);
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("rejects a tampered value", () => {
    const enc = encrypt("secret", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const enc = encrypt("secret", key);
    expect(() => decrypt(enc, randomBytes(32).toString("base64"))).toThrow();
  });

  it("accepts a non-base64 secret by deriving a key", () => {
    const secret = "a long passphrase that is not base64 encoded at all!!";
    expect(decrypt(encrypt("x", secret), secret)).toBe("x");
  });
});

describe("eBay account deletion challenge", () => {
  it("hashes challenge code + verification token + endpoint, in that order", () => {
    const code = "a8628072-3d33-45ee-9004-bee86830a22d";
    const token = "71745723-d031-455c-bfa5-f90d11b4f20a-and-more-chars";
    const endpoint = "https://lister.example.com/api/ebay/account-deletion";
    const expected = createHash("sha256").update(code + token + endpoint).digest("hex");
    expect(deletionChallengeResponse(code, token, endpoint)).toBe(expected);
  });
});
