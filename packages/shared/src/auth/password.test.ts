import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password utilities", () => {
  it("hashes a password without returning the original string", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");

    expect(passwordHash).not.toBe("correct horse battery staple");
    expect(passwordHash).toMatch(/^scrypt:v1:/);
  });

  it("verifies the correct password", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", passwordHash)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("wrong password", passwordHash)).resolves.toBe(false);
  });
});
