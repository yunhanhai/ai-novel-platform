import { describe, expect, it } from "vitest";
import { classifyModelError, isConfigError } from "./model-error-classifier";

function withStatus(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

describe("classifyModelError", () => {
  it.each([
    ["ENCRYPTION_KEY_NOT_RESOLVED: USER_KEY mode requires ENCRYPTION_KEY", "CONFIG_ENCRYPTION_KEY", "ENCRYPTION_KEY"],
    ["ENCRYPTION_KEY_INVALID: expected exactly 64 hexadecimal characters", "CONFIG_ENCRYPTION_KEY", "64"],
    ["API_KEY_NOT_RESOLVED: OPENAI_API_KEY not set", "CONFIG_API_KEY_MISSING", "API key"],
    ["API_KEY_NOT_RESOLVED: USER_KEY mode but encryptedApiKey is null", "CONFIG_API_KEY_MISSING", "API key"],
    ["API_KEY_DECRYPTION_FAILED: unable to decrypt stored credentials", "CONFIG_API_KEY_DECRYPTION", "解密"],
    ["UNSUPPORTED_PROVIDER: GEMINI not implemented in phase 1", "CONFIG_UNSUPPORTED_PROVIDER", "供应商"],
    ["MODEL_PROFILE_INVALID: missing provider or model name", "CONFIG_MODEL_PROFILE_INVALID", "模型档案"]
  ])("classifies local setup failure %s without retrying", (message, kind, hint) => {
    const result = classifyModelError(new Error(message));

    expect(result.kind).toBe(kind);
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toContain(hint);
    expect(result.userMessage).not.toBe(message);
  });

  it("classifies auth failures by status code", () => {
    const result = classifyModelError(withStatus(401, "Invalid API key"));
    expect(result.kind).toBe("CONFIG_INVALID_KEY");
    expect(result.retryable).toBe(false);
    expect(result.userMessage).toContain("API key 无效");
  });

  it("classifies 403 as an invalid key", () => {
    expect(classifyModelError(withStatus(403, "Forbidden")).kind).toBe("CONFIG_INVALID_KEY");
  });

  it("classifies payment required as insufficient quota", () => {
    const result = classifyModelError(withStatus(402, "Insufficient credits"));
    expect(result.kind).toBe("CONFIG_INSUFFICIENT_QUOTA");
    expect(result.retryable).toBe(false);
  });

  it("classifies 404 as model not found", () => {
    expect(classifyModelError(withStatus(404, "model x does not exist")).kind).toBe(
      "CONFIG_MODEL_NOT_FOUND"
    );
  });

  it("classifies 429 as a retryable rate limit", () => {
    const result = classifyModelError(withStatus(429, "Too many requests"));
    expect(result.kind).toBe("TRANSIENT_RATE_LIMIT");
    expect(result.retryable).toBe(true);
  });

  it("classifies 5xx as a retryable server error", () => {
    expect(classifyModelError(withStatus(503, "upstream unavailable")).kind).toBe(
      "TRANSIENT_SERVER"
    );
  });

  it("falls back to text matching when the SDK gives no status", () => {
    expect(classifyModelError(new Error("Incorrect API key provided")).kind).toBe(
      "CONFIG_INVALID_KEY"
    );
    expect(classifyModelError(new Error("fetch failed")).kind).toBe("CONFIG_BAD_BASE_URL");
    expect(classifyModelError(new Error("Request timed out")).kind).toBe("TRANSIENT_TIMEOUT");
    expect(classifyModelError(new Error("model gpt-9 not found")).kind).toBe(
      "CONFIG_MODEL_NOT_FOUND"
    );
  });

  it("keeps DNS/connection failures non-retryable as configuration problems", () => {
    const result = classifyModelError(new Error("getaddrinfo ENOTFOUND api.example.com"));
    expect(result.kind).toBe("CONFIG_BAD_BASE_URL");
    expect(result.retryable).toBe(false);
  });

  it("returns UNKNOWN with a readable message for unmatched errors", () => {
    const result = classifyModelError(new Error("something odd"));
    expect(result.kind).toBe("UNKNOWN");
    expect(result.retryable).toBe(true);
    expect(result.userMessage).toContain("服务端日志");
  });

  it("handles non-Error throws", () => {
    const result = classifyModelError("plain string failure");
    expect(result.kind).toBe("UNKNOWN");
    expect(result.raw).toBe("plain string failure");
  });
});

describe("isConfigError", () => {
  it("only config kinds are non-retryable", () => {
    expect(isConfigError("CONFIG_INVALID_KEY")).toBe(true);
    expect(isConfigError("TRANSIENT_RATE_LIMIT")).toBe(false);
    expect(isConfigError("UNKNOWN")).toBe(false);
  });
});
