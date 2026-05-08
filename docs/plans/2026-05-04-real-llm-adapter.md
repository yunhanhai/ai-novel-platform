# Real LLM Adapter 实施计划

> 创建：2026-05-04
> 分支：`feature/real-llm-adapter`
> Worktree：`.worktrees/llm-adapter`
> 状态：设计已确认（D1-D10），待执行

---

## 0. 阅读说明（给新窗口的接力卡）

新窗口接手时只需做三件事：

1. 读完本文档（约 500 行，自包含）
2. 按 §6 的 Sprint 顺序执行（默认从 Sprint 1 开始；如已有进度看 §11 完成清单）
3. 每个 Sprint 完成立即跑 `pnpm -r typecheck && pnpm -r test`，全绿才能进下一个

**核心约束**：
- 严格 TDD：先写测试（RED）→ 实现（GREEN）→ 提交。每 Sprint 一次提交。
- 不动 `apps/worker/src/pipeline/fake-model.ts`（84 个测试依赖）。
- 不改 `chapter-pipeline.ts` 的 `FakeModelLike` 接口（新 adapter 满足同形状）。
- 测试全部 mock SDK，**不打真实 API**。

---

## 1. 背景与目标

### 背景
当前 `apps/worker` 的 chapter-pipeline 通过 `createFakeModel()` 跑了 6 步流水线（plan/draft/review/revise/persist/extract），所有 LLM 调用都是 mock。Schema 已经支持 `ModelProvider`（5 种 providerType）+ `ModelProfile`（按 taskType 分流）+ `GenerationJob.modelProfileId`，但 worker 没有任何真实 LLM 适配器，且 `apps/worker/src/index.ts:9` 的 `handlers = new Map()` 是**空 Map**——意味着 worker 进程启动后看到任何 job 都返回 `"no_handler"`，整个 worker 在生产从未真正跑过。

### 目标
在不改动现有 pipeline 测试的前提下，引入：

1. **OpenAI / Anthropic 两个真实 adapter**（DEEPSEEK / CUSTOM 复用 OpenAI adapter）
2. **API Key 解析**（USER_KEY 解密 / PLATFORM_KEY 走 env）
3. **ModelProfile 五级路由**（按 job → project+taskType → org+taskType 优先级查找）
4. **GENERATE_CHAPTER handler 注册到 worker index**（修复空 Map 问题）
5. **USE_FAKE_MODEL 开发兜底开关**

### 不做（明确推迟到第二阶段）
- ❌ Streaming（pipeline 一次性 await，不需要）
- ❌ Step 级不同 model（单 model 跑全 pipeline）
- ❌ Retry / 退避（失败直接 FAILED，poll 已处理）
- ❌ UsageEvent 写入（计费埋点放第二阶段）
- ❌ Gemini adapter（命中报 UNSUPPORTED_PROVIDER）
- ❌ Token cost 估算

---

## 2. 现状分析（关键事实）

### 已就位
| 项 | 位置 | 备注 |
|---|---|---|
| Schema | `packages/db/prisma/schema.prisma` | `ModelProvider` / `ModelProfile.taskType` / `GenerationJob.modelProfileId` 全齐 |
| 加密 | `packages/shared/src/crypto/encryption.ts` | AES-256-GCM，`encrypt(plaintext, key)` / `decrypt(encoded, key)`，导出路径 `@ai-novel/shared/crypto/encryption` |
| Pipeline | `apps/worker/src/pipeline/chapter-pipeline.ts` | 6 步流水线，通过 DI 注入 `model: FakeModelLike` |
| Fake model | `apps/worker/src/pipeline/fake-model.ts` | `generate(prompt) → { text, inputTokens, outputTokens }` |
| Poll loop | `apps/worker/src/poll.ts` + `index.ts` | `claimNextJob → handler → updateJobStatus` 链路完整 |
| Web → Job | `apps/web/src/app/api/generation-jobs/route.ts` | POST 已透传 `modelProfileId` |
| 加密 key 读取约定 | `apps/web/src/server/model-providers.ts:21-28` | `process.env.ENCRYPTION_KEY`，64-char hex（32 字节） |

### 关键空洞（必须修）
- **`apps/worker/src/index.ts:9` `handlers = new Map()` 是空 Map** → worker 看到任何 job 都返回 `"no_handler"`
- 没有任何 LLM adapter
- `apps/worker/package.json` 无 `openai` / `@anthropic-ai/sdk` 依赖
- `.env.example` 缺 `ENCRYPTION_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
- 没有按 taskType 路由 ModelProfile 的逻辑

### 关键接口契约（不能破）
```ts
// fake-model.ts 已对齐，新 adapter 必须满足
interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// chapter-pipeline.ts 的 FakeModelLike
interface FakeModelLike {
  generate: (prompt: string) => Promise<ModelResult>;
}
```

### Schema 关键字段（参考用）
```prisma
enum ProviderType {
  OPENAI_COMPATIBLE  // openai-adapter
  ANTHROPIC          // anthropic-adapter
  GEMINI             // 第一阶段 UNSUPPORTED
  DEEPSEEK           // 复用 openai-adapter (DeepSeek 兼容 OpenAI)
  CUSTOM             // 复用 openai-adapter (自定义 baseUrl)
}

enum AuthMode { USER_KEY, PLATFORM_KEY }

model ModelProvider {
  providerType    ProviderType
  baseUrl         String?      // OPENAI_COMPATIBLE / DEEPSEEK / CUSTOM 必填
  encryptedApiKey String?      // USER_KEY 时存这里（已加密）
  authMode        AuthMode
}

model ModelProfile {
  organizationId  String
  projectId       String?      // null = 组织级；非 null = 项目级
  providerId      String
  modelName       String       // 如 "gpt-4o-mini" / "claude-haiku-4-5"
  taskType        String       // "generate_chapter" / "default" / ...
  temperature     Decimal?
  topP            Decimal?
  maxOutputTokens Int?
}

model GenerationJob {
  modelProfileId  String?      // 用户在 UI 显式选的 profile
  jobType         GenerationJobType  // 例如 GENERATE_CHAPTER
}
```

---

## 3. 设计方案

### 3.1 ModelAdapter 接口（新建）

```ts
// apps/worker/src/models/types.ts
export interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelGenerateOptions {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
}

export interface ModelAdapter {
  generate(prompt: string, options?: ModelGenerateOptions): Promise<ModelResult>;
  readonly modelName: string;
  readonly providerType: string;
}
```

> `FakeModel` 天然满足 `generate(prompt) → ModelResult`，pipeline 测试无需改动。
> `options` 是新增的可选参数，pipeline 当前不传，等后续接入。

### 3.2 文件结构（新增）

```
apps/worker/src/
├── models/
│   ├── types.ts                     # ModelAdapter 接口
│   ├── openai-adapter.ts            # OPENAI_COMPATIBLE / DEEPSEEK / CUSTOM
│   ├── openai-adapter.test.ts
│   ├── anthropic-adapter.ts         # ANTHROPIC
│   ├── anthropic-adapter.test.ts
│   ├── adapter-factory.ts           # providerType → adapter；API key 解析
│   ├── adapter-factory.test.ts
│   ├── model-resolver.ts            # taskType → ModelProfile 五级查找
│   └── model-resolver.test.ts
└── handlers/
    ├── generate-chapter-handler.ts  # 串 resolver + factory + pipeline
    └── generate-chapter-handler.test.ts
```

### 3.3 修改清单（最小化变动）

| 文件 | 变更 |
|------|------|
| `apps/worker/src/index.ts` | 解空 `handlers` Map，注册 `GENERATE_CHAPTER` handler |
| `apps/worker/package.json` | + `openai@^4` `@anthropic-ai/sdk@^0.30` |
| `.env.example` | + `ENCRYPTION_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `USE_FAKE_MODEL` |
| `apps/worker/src/pipeline/fake-model.ts` | **不动** |
| `apps/worker/src/pipeline/chapter-pipeline.ts` | **不动** |

### 3.4 ProviderType → Adapter 映射

| providerType | Adapter | SDK | 备注 |
|---|---|---|---|
| `ANTHROPIC` | `createAnthropicAdapter` | `@anthropic-ai/sdk` | messages API |
| `OPENAI_COMPATIBLE` | `createOpenAIAdapter` | `openai` | chat.completions |
| `DEEPSEEK` | `createOpenAIAdapter` | `openai` | DeepSeek 官方兼容 OpenAI 格式，需 `baseUrl` |
| `CUSTOM` | `createOpenAIAdapter` | `openai` | 自定义 `baseUrl` |
| `GEMINI` | 不实现 | — | factory 抛 `UNSUPPORTED_PROVIDER` |

### 3.5 API Key 三优先级（adapter-factory 内）

```
1. provider.authMode === USER_KEY:
     decrypt(provider.encryptedApiKey, ENCRYPTION_KEY)
2. provider.authMode === PLATFORM_KEY:
     ANTHROPIC                          → process.env.ANTHROPIC_API_KEY
     OPENAI_COMPATIBLE/DEEPSEEK/CUSTOM  → process.env.OPENAI_API_KEY
3. 都没有 → throw "API_KEY_NOT_RESOLVED"
```

`ENCRYPTION_KEY` 复用 `apps/web/src/server/model-providers.ts:21-28` 的约定：64-char hex string，前 32 字节作为 AES key。

### 3.6 ModelProfile 五级路由（model-resolver 内）

按优先级依次查找，命中即返回：

```
1. job.modelProfileId 显式指定（用户在 UI 选了某个）
2. project + taskType=GENERATE_CHAPTER（项目级 + 任务对齐）
3. project + taskType=default（项目级兜底）
4. organization + taskType=GENERATE_CHAPTER（组织级 + 任务对齐）
5. organization + taskType=default（组织级兜底）
6. 全部 miss → 返回 null
```

调用方根据 `null` 处理：
- `USE_FAKE_MODEL=true` → 用 fake-model（开发兜底）
- 否则 → job FAILED + `errorCode=NO_MODEL_PROFILE`

`taskType` 字符串约定 = `GenerationJobType.toLowerCase()`（如 `"generate_chapter"`），外加一个 `"default"` 兜底。

### 3.7 Worker handler 注册（修复空 Map）

```ts
// apps/worker/src/index.ts （示意）
import { createGenerateChapterHandler } from "./handlers/generate-chapter-handler";

const handlers = new Map();
handlers.set("GENERATE_CHAPTER", createGenerateChapterHandler({
  prisma,
  encryptionKey: getEncryptionKey(),
  useFakeModel: process.env.USE_FAKE_MODEL === "true"
}));
```

---

## 4. 决策记录（D1-D10，已确认）

| 编号 | 决策 | 选择 |
|------|------|------|
| D1 | 是否本次顺手填 worker index.ts 空 handlers Map | ✅ 是 |
| D2 | OpenAI SDK 版本 | `openai@^4` |
| D3 | Anthropic SDK 版本 | `@anthropic-ai/sdk@^0.30` |
| D4 | DEEPSEEK / CUSTOM 复用 OpenAI adapter | ✅ 是 |
| D5 | GEMINI 第一阶段不做 | ✅ 是（命中抛 UNSUPPORTED） |
| D6 | taskType 字符串 = `GenerationJobType.toLowerCase()` | ✅ 是 |
| D7 | 全 miss 时是否兜底 fake-model | 由 `USE_FAKE_MODEL` 控制；默认 false |
| D8 | Streaming / retry / usage_events 推迟 | ✅ 推迟到第二阶段 |
| D9 | 测试 mock SDK，不打真实 API | ✅ 是 |
| D10 | 启 git worktree 隔离 | ✅ 是 (`.worktrees/llm-adapter`) |

---

## 5. 范围限定（YAGNI 红线）

**做**：
- ✅ OpenAI / Anthropic adapter
- ✅ ModelProfile 路由
- ✅ API Key 解析（USER_KEY + PLATFORM_KEY）
- ✅ GENERATE_CHAPTER handler 注册到 worker index
- ✅ USE_FAKE_MODEL 开关

**不做**（任何 sprint 都不要悄悄加进去）：
- ❌ Streaming
- ❌ Step 级不同 model
- ❌ Retry / 退避
- ❌ UsageEvent 写入
- ❌ Gemini adapter
- ❌ Token cost 估算
- ❌ 任何 UI 改动

---

## 6. 7-Sprint 拆分（每 Sprint 一次提交）

每个 Sprint 完成的判定：
- 全部测试用例 RED → GREEN
- `pnpm --filter @ai-novel/worker typecheck` 绿
- `pnpm --filter @ai-novel/worker test` 绿
- 不破坏任何现有测试

| # | Sprint | 关键交付 | 提交信息 |
|---|--------|---------|---------|
| 1 | 依赖与接口 | `package.json` + `models/types.ts` | `chore(worker): add openai + anthropic deps + ModelAdapter type` |
| 2 | OpenAI adapter | `openai-adapter.ts` + tests | `feat(worker): OpenAI compatible adapter (TDD)` |
| 3 | Anthropic adapter | `anthropic-adapter.ts` + tests | `feat(worker): Anthropic adapter (TDD)` |
| 4 | adapter-factory | `adapter-factory.ts` + tests | `feat(worker): adapter factory with API key resolution (TDD)` |
| 5 | model-resolver | `model-resolver.ts` + tests | `feat(worker): model profile resolver by taskType (TDD)` |
| 6 | handler + index | `generate-chapter-handler.ts` + 改 `index.ts` | `feat(worker): wire generate-chapter handler + register in index (TDD)` |
| 7 | env 文档 | `.env.example` | `docs(env): update .env.example with LLM keys` |

---

## 7. 每个 Sprint 详细任务

### Sprint 1：依赖与接口

**目标**：依赖装好，接口契约定下来。

**步骤**：
1. 编辑 `apps/worker/package.json`，在 `dependencies` 加：
   ```json
   "openai": "^4.77.0",
   "@anthropic-ai/sdk": "^0.30.1"
   ```
2. 在仓库根跑 `pnpm install`
3. 创建 `apps/worker/src/models/types.ts`（内容见 §3.1）
4. 跑 `pnpm --filter @ai-novel/worker typecheck` 验证

**完成判定**：
- `pnpm --filter @ai-novel/worker typecheck` 绿
- `node_modules/openai` 和 `node_modules/@anthropic-ai/sdk` 存在

**注意**：本 Sprint 没有测试文件（types.ts 只是类型定义，无运行时逻辑）。

---

### Sprint 2：OpenAI adapter（TDD）

**目标**：实现 OPENAI_COMPATIBLE / DEEPSEEK / CUSTOM 共用的 adapter。

**先写测试 `openai-adapter.test.ts`（RED）**，覆盖：

| 用例 | 关键断言 |
|------|---------|
| 1. 基本调用返回 ModelResult | text/inputTokens/outputTokens 字段都正确从 SDK response 解析 |
| 2. 透传 temperature / topP / maxOutputTokens | mock SDK 收到这些参数 |
| 3. baseUrl 透传给 SDK constructor | mock OpenAI constructor 收到正确 baseUrl |
| 4. modelName 注入 chat.completions 调用 | request 的 model 字段 = 构造时传入的 modelName |
| 5. SDK 抛错时 adapter 也抛 | 错误传播不被吞 |
| 6. response 缺 usage 字段 → tokens 退化为 0 | 不崩 |

**Mock 方式**：使用 `vi.mock("openai", ...)` 替换 OpenAI 类的 chat.completions.create。

**实现 `openai-adapter.ts`（GREEN）** 签名：
```ts
import OpenAI from "openai";
import type { ModelAdapter, ModelResult, ModelGenerateOptions } from "./types";

export interface OpenAIAdapterConfig {
  apiKey: string;
  baseUrl?: string;
  modelName: string;
  providerType: string;  // 给 ModelAdapter.providerType 用
}

export function createOpenAIAdapter(config: OpenAIAdapterConfig): ModelAdapter {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {})
  });

  async function generate(prompt: string, options?: ModelGenerateOptions): Promise<ModelResult> {
    const response = await client.chat.completions.create({
      model: config.modelName,
      messages: [{ role: "user", content: prompt }],
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.topP !== undefined ? { top_p: options.topP } : {}),
      ...(options?.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {})
    });

    const text = response.choices[0]?.message?.content ?? "";
    return {
      text,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0
    };
  }

  return {
    generate,
    modelName: config.modelName,
    providerType: config.providerType
  };
}
```

---

### Sprint 3：Anthropic adapter（TDD）

**先写测试 `anthropic-adapter.test.ts`（RED）**，覆盖：

| 用例 | 关键断言 |
|------|---------|
| 1. 基本调用返回 ModelResult | content blocks 拼接成 text |
| 2. 多个 text block 顺序拼接 | 多块 text content 用 "" 拼起来 |
| 3. usage.input_tokens / output_tokens 解析 | 字段映射正确 |
| 4. 透传 temperature / topP / maxOutputTokens | messages.create 收到 |
| 5. 不传 maxOutputTokens 时使用默认值（如 4096） | Anthropic 强制要求 max_tokens，必须有兜底 |
| 6. SDK 抛错时 adapter 也抛 | 错误传播 |

**实现 `anthropic-adapter.ts`** 签名：
```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ModelAdapter, ModelResult, ModelGenerateOptions } from "./types";

const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicAdapterConfig {
  apiKey: string;
  modelName: string;
  providerType: string;
}

export function createAnthropicAdapter(config: AnthropicAdapterConfig): ModelAdapter {
  const client = new Anthropic({ apiKey: config.apiKey });

  async function generate(prompt: string, options?: ModelGenerateOptions): Promise<ModelResult> {
    const response = await client.messages.create({
      model: config.modelName,
      max_tokens: options?.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.topP !== undefined ? { top_p: options.topP } : {})
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens
    };
  }

  return {
    generate,
    modelName: config.modelName,
    providerType: config.providerType
  };
}
```

---

### Sprint 4：adapter-factory（TDD）

**先写测试 `adapter-factory.test.ts`（RED）**，覆盖：

| 用例 | 关键断言 |
|------|---------|
| 1. USER_KEY → 解密 encryptedApiKey | 调用 `decrypt`，结果作为 apiKey 传入 adapter |
| 2. PLATFORM_KEY + ANTHROPIC → 用 `ANTHROPIC_API_KEY` env | 没有 env 时抛 `API_KEY_NOT_RESOLVED` |
| 3. PLATFORM_KEY + OPENAI_COMPATIBLE → 用 `OPENAI_API_KEY` env | 同上 |
| 4. providerType=ANTHROPIC → createAnthropicAdapter | 路由正确 |
| 5. providerType=OPENAI_COMPATIBLE/DEEPSEEK/CUSTOM → createOpenAIAdapter | 路由正确，baseUrl 透传 |
| 6. providerType=GEMINI → 抛 `UNSUPPORTED_PROVIDER` | 第一阶段明确不支持 |
| 7. USER_KEY 但 encryptedApiKey 为 null → 抛 `API_KEY_NOT_RESOLVED` | |

**Mock 方式**：spy `decrypt` 函数；`vi.mock` 两个 adapter 模块以验证调用。

**实现 `adapter-factory.ts`** 签名：
```ts
import { decrypt } from "@ai-novel/shared/crypto/encryption";
import { createOpenAIAdapter } from "./openai-adapter";
import { createAnthropicAdapter } from "./anthropic-adapter";
import type { ModelAdapter } from "./types";

export interface ProviderRecord {
  providerType: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "CUSTOM";
  authMode: "USER_KEY" | "PLATFORM_KEY";
  baseUrl: string | null;
  encryptedApiKey: string | null;
}

export interface AdapterFactoryDeps {
  encryptionKey: Buffer;
  env?: NodeJS.ProcessEnv;  // 默认 process.env，便于测试
}

export async function createAdapter(
  provider: ProviderRecord,
  modelName: string,
  deps: AdapterFactoryDeps
): Promise<ModelAdapter> {
  const apiKey = await resolveApiKey(provider, deps);

  switch (provider.providerType) {
    case "ANTHROPIC":
      return createAnthropicAdapter({ apiKey, modelName, providerType: provider.providerType });

    case "OPENAI_COMPATIBLE":
    case "DEEPSEEK":
    case "CUSTOM":
      return createOpenAIAdapter({
        apiKey,
        modelName,
        providerType: provider.providerType,
        ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {})
      });

    case "GEMINI":
      throw new Error("UNSUPPORTED_PROVIDER: GEMINI not implemented in phase 1");

    default:
      throw new Error(`UNSUPPORTED_PROVIDER: ${provider.providerType as string}`);
  }
}

async function resolveApiKey(provider: ProviderRecord, deps: AdapterFactoryDeps): Promise<string> {
  const env = deps.env ?? process.env;

  if (provider.authMode === "USER_KEY") {
    if (!provider.encryptedApiKey) {
      throw new Error("API_KEY_NOT_RESOLVED: USER_KEY mode but encryptedApiKey is null");
    }
    return decrypt(provider.encryptedApiKey, deps.encryptionKey);
  }

  // PLATFORM_KEY
  const envKey = provider.providerType === "ANTHROPIC" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  const value = env[envKey];
  if (!value) {
    throw new Error(`API_KEY_NOT_RESOLVED: ${envKey} not set`);
  }
  return value;
}
```

---

### Sprint 5：model-resolver（TDD）

**先写测试 `model-resolver.test.ts`（RED）**，覆盖：

| 用例 | 关键断言 |
|------|---------|
| 1. job.modelProfileId 命中 → 直接返回该 profile | 查询次数 = 1 |
| 2. project + taskType=generate_chapter 命中 | 五级里第 2 级 |
| 3. project + taskType=default 命中（项目级兜底） | 第 3 级 |
| 4. organization + taskType=generate_chapter 命中 | 第 4 级 |
| 5. organization + taskType=default 命中 | 第 5 级 |
| 6. 全 miss → 返回 null | 不抛错 |
| 7. taskType 大小写：传入 GENERATE_CHAPTER 自动 toLowerCase | 查询条件正确 |

**Mock 方式**：mock prisma client 的 `modelProfile.findUnique` 和 `modelProfile.findFirst`。

**实现 `model-resolver.ts`** 签名：
```ts
import type { PrismaClient } from "@ai-novel/db";

export interface ResolverInput {
  organizationId: string;
  projectId: string;
  modelProfileId?: string | null;
  taskType: string;  // GenerationJobType 的字符串形式（大小写不敏感）
}

export interface ResolvedProfile {
  id: string;
  organizationId: string;
  projectId: string | null;
  providerId: string;
  modelName: string;
  taskType: string;
  temperature: number | null;
  topP: number | null;
  maxOutputTokens: number | null;
  provider: {
    id: string;
    providerType: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "CUSTOM";
    authMode: "USER_KEY" | "PLATFORM_KEY";
    baseUrl: string | null;
    encryptedApiKey: string | null;
  };
}

export async function resolveModelProfile(
  input: ResolverInput,
  prisma: PrismaClient
): Promise<ResolvedProfile | null> {
  const taskKey = input.taskType.toLowerCase();
  const include = { provider: true } as const;

  // 1. 显式 modelProfileId
  if (input.modelProfileId) {
    const profile = await prisma.modelProfile.findUnique({
      where: { id: input.modelProfileId },
      include
    });
    if (profile) return profile as ResolvedProfile;
  }

  // 2. project + taskType
  // 3. project + default
  // 4. organization + taskType
  // 5. organization + default
  for (const condition of [
    { projectId: input.projectId, taskType: taskKey },
    { projectId: input.projectId, taskType: "default" },
    { projectId: null, organizationId: input.organizationId, taskType: taskKey },
    { projectId: null, organizationId: input.organizationId, taskType: "default" }
  ]) {
    const profile = await prisma.modelProfile.findFirst({ where: condition, include });
    if (profile) return profile as ResolvedProfile;
  }

  return null;
}
```

---

### Sprint 6：generate-chapter handler + 注册到 index（TDD）

**先写测试 `generate-chapter-handler.test.ts`（RED）**，覆盖：

| 用例 | 关键断言 |
|------|---------|
| 1. profile 命中 → 用真 adapter 跑 pipeline | resolver/factory/pipeline 三方调用顺序正确，job 状态 SUCCEEDED |
| 2. profile miss + USE_FAKE_MODEL=true → 用 fake-model | createFakeModel 被调用 |
| 3. profile miss + USE_FAKE_MODEL=false → job FAILED + errorCode=NO_MODEL_PROFILE | updateJobStatus 调用参数正确 |
| 4. pipeline 抛错 → job FAILED + errorMessage 透传 | 错误不被吞 |

**Mock 方式**：mock `resolveModelProfile`、`createAdapter`、`runChapterPipeline`、`updateJobStatus`。

**实现 `generate-chapter-handler.ts`** 签名（核心结构）：
```ts
import { runChapterPipeline } from "../pipeline/chapter-pipeline";
import { createFakeModel } from "../pipeline/fake-model";
import { resolveModelProfile } from "../models/model-resolver";
import { createAdapter } from "../models/adapter-factory";
// ... buildContext / persistVersion / step CRUD 都从已有 generate-chapter.ts 复用

export interface HandlerDeps {
  prisma: PrismaClient;
  encryptionKey: Buffer;
  useFakeModel: boolean;
}

export function createGenerateChapterHandler(deps: HandlerDeps) {
  return async function handle(job: {
    id: string;
    organizationId: string;
    projectId: string;
    userId: string;
    jobType: string;
    modelProfileId?: string | null;
    input: unknown;
  }): Promise<void> {
    // 1. resolve profile
    const profile = await resolveModelProfile({
      organizationId: job.organizationId,
      projectId: job.projectId,
      modelProfileId: job.modelProfileId,
      taskType: job.jobType  // 内部会 toLowerCase
    }, deps.prisma);

    // 2. pick model
    let model;
    if (profile) {
      model = await createAdapter(profile.provider, profile.modelName, {
        encryptionKey: deps.encryptionKey
      });
    } else if (deps.useFakeModel) {
      model = createFakeModel();
    } else {
      // 抛错让 poll loop 把 job 标 FAILED
      const err = new Error("NO_MODEL_PROFILE: no model profile resolved and USE_FAKE_MODEL is false");
      (err as Error & { errorCode?: string }).errorCode = "NO_MODEL_PROFILE";
      throw err;
    }

    // 3. run pipeline（buildContext / persistVersion / steps 走真 prisma）
    // 这部分逻辑已经在现有 generate-chapter.ts 里，直接复用或抽出来
    await runChapterPipeline({ /* deps */ });
  };
}
```

> **注意**：现有 `apps/worker/src/pipeline/generate-chapter.ts` 已经实现了 buildContext/persistVersion/step 写入的真实 prisma 逻辑。Sprint 6 应该**复用**它，而不是重写。如果它的接口需要小调整以接受外部 model，做最小改动。

**修改 `apps/worker/src/index.ts`**：
```ts
import { createGenerateChapterHandler } from "./handlers/generate-chapter-handler";

function getEncryptionKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length < 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-char hex string");
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}

const handlers = new Map();
handlers.set("GENERATE_CHAPTER", createGenerateChapterHandler({
  prisma,
  encryptionKey: getEncryptionKey(),
  useFakeModel: process.env.USE_FAKE_MODEL === "true"
}));
```

> **关键**：在 worker 启动时调用 `getEncryptionKey()` 会立即校验 env，避免运行时才暴露问题。但要注意：USE_FAKE_MODEL=true 模式下其实不需要 ENCRYPTION_KEY（因为不会走真 adapter）。考虑做成"惰性校验"——在 handler 里第一次需要 decrypt 时才校验；或者在 USE_FAKE_MODEL=true 时跳过启动校验。**采用惰性校验**：worker 启动时只读 env，handler 内部用到时才检查。

---

### Sprint 7：env 文档

**修改 `.env.example`**：
```bash
# 数据库
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
REDIS_URL="redis://localhost:6379"
APP_URL="http://localhost:3000"

# 加密 key（64-char hex，用 `openssl rand -hex 32` 生成）
ENCRYPTION_KEY=""

# LLM API keys（PLATFORM_KEY 模式使用）
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""

# 开发兜底：true 时无 ModelProfile 也跑 fake-model
USE_FAKE_MODEL="false"
```

---

## 8. 验证步骤

### 自动验证（每 Sprint 必跑）
```bash
pnpm --filter @ai-novel/worker typecheck
pnpm --filter @ai-novel/worker test
```

### 全局验证（最后跑一次）
```bash
pnpm -r typecheck
pnpm -r test
```

### 手工验证（可选，在 Sprint 6 后）
1. 设置 `USE_FAKE_MODEL=true` + 数据库就绪
2. 启 worker：`pnpm --filter @ai-novel/worker dev`
3. 通过 web 创建一个 GENERATE_CHAPTER job
4. 观察 worker log，应该看到 6 步 pipeline 跑完，job 进 SUCCEEDED

---

## 9. 风险与限制

| 风险 | 应对 |
|------|------|
| openai/anthropic SDK 版本变更打破 mock | 在 package.json 锁主版本 (`^4` / `^0.30`) |
| Anthropic SDK content blocks 类型变化 | 测试覆盖多 block 拼接，CI 会捕获 |
| ENCRYPTION_KEY 在 worker 进程缺失 | 惰性校验 + 启动 log 提示 |
| `USE_FAKE_MODEL=true` 在生产被误用 | .env.example 注释写清"开发兜底"；可考虑加启动 warn |
| 现有 generate-chapter.ts 与新 handler 重复 | Sprint 6 复用，不重写；如有重复，在 PR review 阶段决定收口 |

---

## 10. 参考文件清单

读这些文件就够了，**不要全量读 schema.prisma**：

| 文件 | 用途 |
|------|------|
| `apps/worker/src/index.ts` | 看 handlers Map 在哪 |
| `apps/worker/src/poll.ts` | 看 handler 签名（只读 50 行） |
| `apps/worker/src/pipeline/chapter-pipeline.ts` | 看 FakeModelLike 接口（已写在本文 §2） |
| `apps/worker/src/pipeline/fake-model.ts` | 看 ModelResult 形状（已写在本文 §3.1） |
| `apps/worker/src/pipeline/generate-chapter.ts` | Sprint 6 复用 buildContext/persistVersion |
| `packages/shared/src/crypto/encryption.ts` | encrypt/decrypt 签名（已写在本文 §2） |
| `apps/web/src/server/model-providers.ts:21-28` | ENCRYPTION_KEY 读取约定 |
| `packages/db/prisma/schema.prisma` | 仅在需要确认字段时 Grep，不要 Read 全文件 |

---

## 11. Sprint 完成清单（接力时勾选）

接手者：每完成一个 Sprint 就勾选下一项。如果新窗口接手时这里有勾选，说明已经做了一部分。

- [ ] Sprint 1：依赖 + types.ts
- [ ] Sprint 2：openai-adapter + tests
- [ ] Sprint 3：anthropic-adapter + tests
- [ ] Sprint 4：adapter-factory + tests
- [ ] Sprint 5：model-resolver + tests
- [ ] Sprint 6：generate-chapter-handler + index.ts 注册 + tests
- [ ] Sprint 7：.env.example 更新

---

## 12. 执行前最后核对

新窗口开工前，确认环境：

```bash
# 1. 在 worktree 路径
pwd  # 应该是 .../base/.worktrees/llm-adapter

# 2. 在正确分支
git branch --show-current  # 应该是 feature/real-llm-adapter

# 3. 依赖未装（Sprint 1 第一步装）
ls apps/worker/node_modules/openai 2>/dev/null  # 应该不存在
```

如果上面三项都对，就从 Sprint 1 开始。

---

**END OF PLAN**
