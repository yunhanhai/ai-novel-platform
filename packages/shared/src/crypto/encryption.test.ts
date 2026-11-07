import { describe, expect, it } from "vitest";
import { encrypt, decrypt, generateEncryptionKey, parseEncryptionKey } from "./encryption";

const testKey = generateEncryptionKey();

describe("encryption", () => {
  it("round-trips plaintext through encrypt/decrypt", async () => {
    const original = "sk-test-12345-secret-key";
    const encrypted = await encrypt(original, testKey);
    expect(encrypted).not.toBe(original);
    expect(encrypted).not.toContain("sk-test");

    const decrypted = await decrypt(encrypted, testKey);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertexts for the same input", async () => {
    const plaintext = "same-key-twice";
    const first = await encrypt(plaintext, testKey);
    const second = await encrypt(plaintext, testKey);

    expect(first).not.toBe(second);
  });

  it("throws when decrypting with wrong key", async () => {
    const encrypted = await encrypt("secret", testKey);
    const wrongKey = generateEncryptionKey();

    await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
  });

  it("throws when decrypting corrupted data", async () => {
    await expect(decrypt("not-valid-base64!!!", testKey)).rejects.toThrow();
  });
});

describe("strict encryption key configuration", () => {
  it("parses only a complete 32-byte hexadecimal key", () => {
    expect(parseEncryptionKey("AB".repeat(32))).toEqual(Buffer.from("AB".repeat(32), "hex"));
  });
  it.each([undefined, "", "a".repeat(63), "a".repeat(65), "z".repeat(64), "a".repeat(64) + "suffix", "a".repeat(62) + "zz"])("rejects malformed key without truncation: %s", value => {
    expect(parseEncryptionKey(value)).toBeNull();
  });
});