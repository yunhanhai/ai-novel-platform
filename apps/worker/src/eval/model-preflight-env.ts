import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const MODEL_ENV_KEYS = ["DATABASE_URL", "USE_FAKE_MODEL", "ENCRYPTION_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

/** Load Next's actual dev environment in an isolated process so its expansion cannot alter worker env. */
export function readWebModelEnv(webDirectory: string, inherited: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const webRequire = createRequire(resolve(webDirectory, "package.json"));
  const nextPackage = webRequire.resolve("next/package.json");
  const nextRequire = createRequire(resolve(dirname(nextPackage), "package.json"));
  const nextEnvModule = nextRequire.resolve("@next/env");
  const childScript = `
    const {loadEnvConfig}=require(process.argv[1]);
    const {combinedEnv}=loadEnvConfig(process.argv[2],true,{info(){},error(){}},true);
    const keys=JSON.parse(process.argv[3]);
    process.stdout.write(JSON.stringify(Object.fromEntries(keys.map(key=>[key,combinedEnv[key]]))));
  `;
  const output = execFileSync(process.execPath, ["-e", childScript, nextEnvModule, webDirectory, JSON.stringify(MODEL_ENV_KEYS)], {
    env: inherited, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 10000
  });
  return JSON.parse(output) as Record<string, string | undefined>;
}
