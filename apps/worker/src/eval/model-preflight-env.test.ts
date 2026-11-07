import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { readWebModelEnv } from "./model-preflight-env";

describe("Next environment preflight", () => {
  it("uses Next dollar expansion while preserving the distinct Node worker literal", () => {
    const tempParent = resolve(process.cwd(), "../web/test-results");
    mkdirSync(tempParent, { recursive: true });
    const fixture = mkdtempSync(resolve(tempParent, "model-env-"));
    const text = 'READINESS_TEST_REF=local-placeholder\nOPENAI_API_KEY=$READINESS_TEST_REF\nUSE_FAKE_MODEL=false\n';
    writeFileSync(resolve(fixture, ".env.local"), text);
    const inherited: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development" as const };
    for (const key of ["READINESS_TEST_REF", "OPENAI_API_KEY", "USE_FAKE_MODEL", "__NEXT_PROCESSED_ENV"]) delete inherited[key];
    const web = readWebModelEnv(fixture, inherited);
    expect(web.OPENAI_API_KEY).toBe("local-placeholder");
    expect(parseEnv(text).OPENAI_API_KEY).toBe("$READINESS_TEST_REF");
    expect(inherited.OPENAI_API_KEY).toBeUndefined();
  });
});
