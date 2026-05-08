import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("environment parser", () => {
  it("requires DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow("DATABASE_URL is required");
  });

  it("accepts postgres queue driver", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_novel_platform",
        QUEUE_DRIVER: "postgres"
      }).queueDriver
    ).toBe("postgres");
  });

  it("accepts redis queue driver", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_novel_platform",
        QUEUE_DRIVER: "redis"
      }).queueDriver
    ).toBe("redis");
  });

  it("defaults queue driver to postgres", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_novel_platform"
      }).queueDriver
    ).toBe("postgres");
  });

  it("rejects unknown queue drivers", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/ai_novel_platform",
        QUEUE_DRIVER: "memory"
      })
    ).toThrow("QUEUE_DRIVER must be one of: postgres, redis");
  });
});
