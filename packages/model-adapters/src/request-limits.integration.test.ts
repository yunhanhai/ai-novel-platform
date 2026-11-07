import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIAdapter } from "./openai-adapter";
import { createAnthropicAdapter } from "./anthropic-adapter";
import type { ModelAdapter } from "./types";

async function loopback() {
  let requests = 0;
  let sawRequest!: () => void;
  let sawClose!: () => void;
  const received = new Promise<void>(resolve => { sawRequest = resolve; });
  const closed = new Promise<void>(resolve => { sawClose = resolve; });
  let respondWithError = false;
  const server = createServer((req, res) => {
    requests++;
    req.resume();
    res.on("close", sawClose);
    sawRequest();
    if (respondWithError) {
      res.writeHead(503, { "content-type": "application/json", "retry-after": "0" });
      res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "loopback-only failure" } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("loopback listener unavailable");
  return { server, url: `http://127.0.0.1:${address.port}`, received, closed, count: () => requests, fail: () => { respondWithError = true; } };
}

async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function adapter(kind: "openai" | "anthropic", url: string): ModelAdapter {
  if (kind === "openai") return createOpenAIAdapter({ apiKey: "loopback-placeholder", baseUrl: `${url}/v1`, modelName: "loopback-model", providerType: "OPENAI_COMPATIBLE" });
  vi.stubEnv("ANTHROPIC_BASE_URL", url);
  return createAnthropicAdapter({ apiKey: "loopback-placeholder", modelName: "loopback-model", providerType: "ANTHROPIC" });
}

async function bounded(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("loopback observation timed out")), 3000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

afterEach(() => { vi.unstubAllEnvs(); });
describe.each(["openai", "anthropic"] as const)("%s SDK request limits through real local HTTP", kind => {
  it("closes the underlying HTTP request when the signal is aborted", async () => {
    const local = await loopback();
    try {
      const controller = new AbortController();
      const result = adapter(kind, local.url).generate("local-only probe", { signal: controller.signal, maxOutputTokens: 1, timeoutMs: 2000, maxRetries: 0 });
      const rejected = expect(result).rejects.toThrow("Request was aborted.");
      await bounded(local.received);
      controller.abort();
      await rejected;
      await bounded(local.closed);
      expect(local.count()).toBe(1);
    } finally { await stop(local.server); }
  });

  it("does not retry a 503 response when maxRetries is zero", async () => {
    const local = await loopback();
    try {
      local.fail();
      await expect(adapter(kind, local.url).generate("local-only probe", { maxOutputTokens: 1, timeoutMs: 2000, maxRetries: 0 })).rejects.toMatchObject({ status: 503 });
      expect(local.count()).toBe(1);
    } finally { await stop(local.server); }
  });

  it("enforces the explicit transport timeout without another attempt", async () => {
    const local = await loopback();
    try {
      await expect(adapter(kind, local.url).generate("local-only probe", { maxOutputTokens: 1, timeoutMs: 100, maxRetries: 0 })).rejects.toThrow("Request timed out.");
      await bounded(local.closed);
      expect(local.count()).toBe(1);
    } finally { await stop(local.server); }
  });
});
