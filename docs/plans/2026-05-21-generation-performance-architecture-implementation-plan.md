# Generation Performance Architecture Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a complete performance-first generation architecture with quality modes, budget enforcement, async diagnostic jobs, job metrics, and workspace visibility.

**Architecture:** Put shared quality-mode and budget normalization in `packages/shared`, extend generation job types for diagnostics, and wrap worker model steps with a budget tracker. Keep chapter persistence on the fast parent path; run heavier quality analysis as separate diagnostic jobs whose failures do not affect saved chapter versions.

**Tech Stack:** TypeScript, Next.js App Router, React, Prisma/PostgreSQL enums and JSON fields, Vitest, Playwright, existing worker fake-model tests.

---

### Task 1: Shared Performance Contract

**Files:**
- Create: `packages/shared/src/generation/performance.ts`
- Create: `packages/shared/src/generation/performance.test.ts`
- Modify: `packages/shared/package.json`

**Step 1: Write the failing tests**

Create `packages/shared/src/generation/performance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createPerformanceTracker,
  normalizePerformanceBudget,
  normalizeQualityMode
} from "./performance";

describe("generation performance options", () => {
  it("defaults to balanced quality mode", () => {
    expect(normalizeQualityMode(undefined)).toBe("balanced");
    expect(normalizeQualityMode("fast")).toBe("fast");
    expect(normalizeQualityMode("deep")).toBe("deep");
    expect(normalizeQualityMode("invalid")).toBe("balanced");
  });

  it("uses mode defaults and clamps caller budgets", () => {
    expect(normalizePerformanceBudget("fast", undefined)).toMatchObject({
      maxModelCalls: 3,
      maxInputTokens: 12000,
      maxOutputTokens: 5000,
      maxLatencyMs: 60000
    });

    expect(normalizePerformanceBudget("balanced", {
      maxModelCalls: 99,
      maxInputTokens: -1,
      maxOutputTokens: 1,
      maxLatencyMs: 1
    })).toEqual({
      maxModelCalls: 12,
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
      maxLatencyMs: 10000
    });
  });

  it("tracks calls, tokens, latency, and skipped steps", () => {
    const tracker = createPerformanceTracker({
      qualityMode: "fast",
      budget: normalizePerformanceBudget("fast", { maxModelCalls: 1 })
    });

    expect(tracker.canRunModelStep("draft", { estimatedInputTokens: 10 })).toEqual({ ok: true });
    tracker.recordModelStep({ inputTokens: 12, outputTokens: 20, latencyMs: 30 });

    expect(tracker.canRunModelStep("review", { estimatedInputTokens: 10 })).toEqual({
      ok: false,
      reason: "budget_model_calls"
    });

    tracker.recordSkippedStep("review", "budget_model_calls");
    expect(tracker.summary()).toMatchObject({
      qualityMode: "fast",
      modelCalls: 1,
      inputTokens: 12,
      outputTokens: 20,
      latencyMs: 30,
      skippedSteps: [{ stepKey: "review", reason: "budget_model_calls" }]
    });
  });
});
```

**Step 2: Run the test to verify RED**

Run:

```bash
pnpm --filter @ai-novel/shared test -- src/generation/performance.test.ts
```

Expected: FAIL because `performance.ts` does not exist.

**Step 3: Implement the shared helpers**

Create `packages/shared/src/generation/performance.ts`:

```ts
export type QualityMode = "fast" | "balanced" | "deep";

export interface PerformanceBudget {
  maxModelCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxLatencyMs: number;
}

export interface PerformanceBudgetInput {
  maxModelCalls?: unknown;
  maxInputTokens?: unknown;
  maxOutputTokens?: unknown;
  maxLatencyMs?: unknown;
}

export type BudgetSkipReason =
  | "quality_mode"
  | "budget_model_calls"
  | "budget_input_tokens"
  | "budget_output_tokens"
  | "budget_latency_ms"
  | "missing_input"
  | "not_applicable";

export interface SkippedStepSummary {
  stepKey: string;
  reason: BudgetSkipReason;
}

export interface PerformanceSummary {
  qualityMode: QualityMode;
  budget: PerformanceBudget;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  skippedSteps: SkippedStepSummary[];
}

const DEFAULT_BUDGETS: Record<QualityMode, PerformanceBudget> = {
  fast: { maxModelCalls: 3, maxInputTokens: 12000, maxOutputTokens: 5000, maxLatencyMs: 60000 },
  balanced: { maxModelCalls: 6, maxInputTokens: 30000, maxOutputTokens: 10000, maxLatencyMs: 120000 },
  deep: { maxModelCalls: 8, maxInputTokens: 45000, maxOutputTokens: 14000, maxLatencyMs: 180000 }
};

const LIMITS = {
  maxModelCalls: { min: 1, max: 12 },
  maxInputTokens: { min: 1000, max: 120000 },
  maxOutputTokens: { min: 1000, max: 40000 },
  maxLatencyMs: { min: 10000, max: 600000 }
} as const;

export function normalizeQualityMode(value: unknown): QualityMode {
  return value === "fast" || value === "balanced" || value === "deep" ? value : "balanced";
}

export function normalizePerformanceBudget(
  qualityMode: QualityMode,
  input: PerformanceBudgetInput | undefined
): PerformanceBudget {
  const defaults = DEFAULT_BUDGETS[qualityMode];
  return {
    maxModelCalls: clampInt(input?.maxModelCalls, defaults.maxModelCalls, LIMITS.maxModelCalls),
    maxInputTokens: clampInt(input?.maxInputTokens, defaults.maxInputTokens, LIMITS.maxInputTokens),
    maxOutputTokens: clampInt(input?.maxOutputTokens, defaults.maxOutputTokens, LIMITS.maxOutputTokens),
    maxLatencyMs: clampInt(input?.maxLatencyMs, defaults.maxLatencyMs, LIMITS.maxLatencyMs)
  };
}

export function createPerformanceTracker(params: {
  qualityMode: QualityMode;
  budget: PerformanceBudget;
}) {
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;
  const skippedSteps: SkippedStepSummary[] = [];

  return {
    canRunModelStep(_stepKey: string, opts: { estimatedInputTokens?: number } = {}):
      | { ok: true }
      | { ok: false; reason: BudgetSkipReason } {
      if (modelCalls >= params.budget.maxModelCalls) return { ok: false, reason: "budget_model_calls" };
      if (inputTokens + (opts.estimatedInputTokens ?? 0) > params.budget.maxInputTokens) {
        return { ok: false, reason: "budget_input_tokens" };
      }
      if (outputTokens >= params.budget.maxOutputTokens) return { ok: false, reason: "budget_output_tokens" };
      if (latencyMs >= params.budget.maxLatencyMs) return { ok: false, reason: "budget_latency_ms" };
      return { ok: true };
    },
    recordModelStep(tokens: { inputTokens: number; outputTokens: number; latencyMs: number }) {
      modelCalls += 1;
      inputTokens += Math.max(0, tokens.inputTokens);
      outputTokens += Math.max(0, tokens.outputTokens);
      latencyMs += Math.max(0, tokens.latencyMs);
    },
    recordSkippedStep(stepKey: string, reason: BudgetSkipReason) {
      skippedSteps.push({ stepKey, reason });
    },
    summary(): PerformanceSummary {
      return {
        qualityMode: params.qualityMode,
        budget: params.budget,
        modelCalls,
        inputTokens,
        outputTokens,
        latencyMs,
        skippedSteps
      };
    }
  };
}

function clampInt(value: unknown, fallback: number, limits: { min: number; max: number }): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(limits.max, Math.max(limits.min, parsed));
}
```

Modify `packages/shared/package.json` exports:

```json
"./generation/performance": "./src/generation/performance.ts"
```

**Step 4: Run the test to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/shared test -- src/generation/performance.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/generation/performance.ts packages/shared/src/generation/performance.test.ts packages/shared/package.json
git commit -m "feat(shared): add generation performance budget helpers"
```

---

### Task 2: Diagnostic Job Types In Prisma And DB Helpers

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/202605210001_add_generation_diagnostics/migration.sql`
- Modify: `packages/db/src/generation-jobs.ts`
- Modify: `packages/db/src/generation-jobs.test.ts`

**Step 1: Write the failing test**

In `packages/db/src/generation-jobs.test.ts`, add a test that creates a diagnostic job through the helper:

```ts
it("creates chapter diagnostic jobs", async () => {
  const job = await createJob({
    organizationId,
    projectId,
    userId,
    jobType: "DIAGNOSE_CHAPTER",
    targetEntityType: "CHAPTER",
    targetEntityId: chapterId,
    input: { chapterId },
    prisma
  });

  expect(job.jobType).toBe("DIAGNOSE_CHAPTER");
  expect(job.targetEntityType).toBe("CHAPTER");
  expect(job.targetEntityId).toBe(chapterId);
});
```

Use the fixture ids already present in that test file; do not introduce a real database dependency beyond the existing test style.

**Step 2: Run the test to verify RED**

Run:

```bash
pnpm --filter @ai-novel/db test -- src/generation-jobs.test.ts
```

Expected: FAIL because the job type union and Prisma enum do not include `DIAGNOSE_CHAPTER`.

**Step 3: Add enum values**

In `packages/db/prisma/schema.prisma`, extend `enum GenerationJobType`:

```prisma
  DIAGNOSE_CHAPTER  @map("diagnose_chapter")
  READER_SIMULATION @map("reader_simulation")
  STYLE_DRIFT_CHECK @map("style_drift_check")
  CONTINUITY_CHECK  @map("continuity_check")
```

Create `packages/db/prisma/migrations/202605210001_add_generation_diagnostics/migration.sql`:

```sql
ALTER TYPE generation_job_type ADD VALUE IF NOT EXISTS 'diagnose_chapter';
ALTER TYPE generation_job_type ADD VALUE IF NOT EXISTS 'reader_simulation';
ALTER TYPE generation_job_type ADD VALUE IF NOT EXISTS 'style_drift_check';
ALTER TYPE generation_job_type ADD VALUE IF NOT EXISTS 'continuity_check';
```

**Step 4: Update DB helper types**

In `packages/db/src/generation-jobs.ts`, add the four diagnostic job type literals to `CreateJobParams["jobType"]`.

**Step 5: Generate Prisma client**

Run:

```bash
pnpm db:generate
```

Expected: Prisma client generation succeeds.

**Step 6: Run the DB test to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/db test -- src/generation-jobs.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/202605210001_add_generation_diagnostics/migration.sql packages/db/src/generation-jobs.ts packages/db/src/generation-jobs.test.ts
git commit -m "feat(db): add generation diagnostic job types"
```

---

### Task 3: Generation Job API Normalizes Quality And Budgets

**Files:**
- Modify: `apps/web/src/app/api/generation-jobs/route.ts`
- Modify: `apps/web/src/app/api/generation-jobs/route.test.ts`
- Modify: `apps/web/src/lib/display-labels.ts`
- Modify: `apps/web/src/lib/display-labels.test.ts`

**Step 1: Write failing route tests**

In `apps/web/src/app/api/generation-jobs/route.test.ts`, add tests:

```ts
it("stores normalized quality mode and performance budget", async () => {
  const request = new Request("http://test.local/api/generation-jobs", {
    method: "POST",
    body: JSON.stringify({
      chapterId,
      jobType: "GENERATE_CHAPTER",
      qualityMode: "fast",
      performanceBudget: { maxModelCalls: 99 }
    })
  });

  const response = await POST(request);
  expect(response.status).toBe(201);
  expect(createJob).toHaveBeenCalledWith(expect.objectContaining({
    input: expect.objectContaining({
      qualityMode: "fast",
      performanceBudget: expect.objectContaining({ maxModelCalls: 12 })
    })
  }));
});

it("rejects invalid quality mode", async () => {
  const request = new Request("http://test.local/api/generation-jobs", {
    method: "POST",
    body: JSON.stringify({ chapterId, qualityMode: "slow" })
  });

  const response = await POST(request);
  expect(response.status).toBe(400);
});

it("requires chapter target for diagnostic jobs", async () => {
  const request = new Request("http://test.local/api/generation-jobs", {
    method: "POST",
    body: JSON.stringify({ projectId, jobType: "DIAGNOSE_CHAPTER" })
  });

  const response = await POST(request);
  expect(response.status).toBe(400);
});
```

Adapt mock names to the current test file.

**Step 2: Run route tests to verify RED**

Run:

```bash
pnpm --filter @ai-novel/web test -- src/app/api/generation-jobs/route.test.ts
```

Expected: FAIL because `qualityMode`, `performanceBudget`, and diagnostic validation are not implemented.

**Step 3: Implement API normalization**

In `apps/web/src/app/api/generation-jobs/route.ts`:

- import `normalizeQualityMode` and `normalizePerformanceBudget`;
- extend `JobType` and `ALLOWED_JOB_TYPES` with the four diagnostic job types;
- add `qualityMode?: unknown` and `performanceBudget?: PerformanceBudgetInput` to the request body;
- reject a present but invalid `qualityMode`;
- require `chapterId` for `DIAGNOSE_CHAPTER`, `READER_SIMULATION`, `STYLE_DRIFT_CHECK`, and `CONTINUITY_CHECK`;
- merge normalized values into `input`:

```ts
const qualityMode = normalizeQualityMode(body.qualityMode);
const input = {
  ...(body.input ?? {}),
  qualityMode,
  performanceBudget: normalizePerformanceBudget(qualityMode, body.performanceBudget),
  ...(body.contextOptions ? { contextOptions: normalizeContextOptions(body.contextOptions) } : {})
};
```

Use a small `isQualityMode(value: unknown)` helper so invalid explicit values return HTTP 400 instead of silently falling back.

**Step 4: Add labels**

In `apps/web/src/lib/display-labels.ts`, add diagnostic labels:

```ts
DIAGNOSE_CHAPTER: "质量诊断",
READER_SIMULATION: "读者模拟",
STYLE_DRIFT_CHECK: "风格漂移",
CONTINUITY_CHECK: "连续性检查"
```

Update the matching label test.

**Step 5: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/web test -- src/app/api/generation-jobs/route.test.ts src/lib/display-labels.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/app/api/generation-jobs/route.ts apps/web/src/app/api/generation-jobs/route.test.ts apps/web/src/lib/display-labels.ts apps/web/src/lib/display-labels.test.ts
git commit -m "feat(web): accept generation quality modes and diagnostics"
```

---

### Task 4: Chapter Pipeline Uses Quality Mode And Budget Guard

**Files:**
- Modify: `apps/worker/src/pipeline/chapter-pipeline.ts`
- Modify: `apps/worker/src/pipeline/chapter-pipeline.test.ts`

**Step 1: Write failing tests**

In `apps/worker/src/pipeline/chapter-pipeline.test.ts`, add tests:

```ts
it("skips review and revise in fast mode", async () => {
  const result = await runChapterPipeline({
    ...baseDeps(),
    performance: {
      qualityMode: "fast",
      budget: normalizePerformanceBudget("fast", undefined)
    }
  });

  expect(result.steps.map((step) => step.stepKey)).toContain("review");
  expect(result.steps.find((step) => step.stepKey === "review")).toMatchObject({
    status: "SKIPPED",
    outputPreview: "quality_mode"
  });
  expect(result.performanceSummary.skippedSteps).toContainEqual({
    stepKey: "review",
    reason: "quality_mode"
  });
});

it("skips optional model steps when the budget is exhausted", async () => {
  const result = await runChapterPipeline({
    ...baseDeps(),
    performance: {
      qualityMode: "balanced",
      budget: normalizePerformanceBudget("balanced", { maxModelCalls: 2 })
    }
  });

  expect(result.steps.find((step) => step.stepKey === "review")).toMatchObject({
    status: "SKIPPED"
  });
  expect(result.performanceSummary.modelCalls).toBe(2);
});
```

Import `normalizePerformanceBudget` from `@ai-novel/shared/generation/performance`.

**Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @ai-novel/worker test -- src/pipeline/chapter-pipeline.test.ts
```

Expected: FAIL because `performance` input and `performanceSummary` do not exist.

**Step 3: Implement minimal pipeline support**

In `apps/worker/src/pipeline/chapter-pipeline.ts`:

- import shared performance types and `createPerformanceTracker`;
- add optional `performance?: { qualityMode: QualityMode; budget: PerformanceBudget }` to `PipelineDeps`;
- add `performanceSummary: PerformanceSummary` to `PipelineResult`;
- create a tracker at the start of `runChapterPipeline`;
- after each model-backed step, call `tracker.recordModelStep`;
- before optional model steps, call `tracker.canRunModelStep`.

Treat these steps as required:

- `plan`
- `draft`

Treat these steps as optional:

- `review`
- `revise`
- `extract_memory`

In `fast` mode:

- skip `review` with reason `quality_mode`;
- skip `revise` with reason `quality_mode`;
- still attempt `extract_memory` if budget allows.

Create skipped step records through a helper:

```ts
async function skipStep(key: string, reason: BudgetSkipReason): Promise<void> {
  const step = await createStep({ stepKey: key });
  await updateStep({
    stepId: step.id,
    status: "SKIPPED",
    outputPreview: reason,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0
  });
  tracker.recordSkippedStep(key, reason);
  steps.push({ stepKey: key, status: "SKIPPED", outputPreview: reason, inputTokens: 0, outputTokens: 0, latencyMs: 0 });
}
```

Use a simple token estimate for preflight checks:

```ts
function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
```

**Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/worker test -- src/pipeline/chapter-pipeline.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/pipeline/chapter-pipeline.ts apps/worker/src/pipeline/chapter-pipeline.test.ts
git commit -m "feat(worker): gate chapter pipeline by performance budget"
```

---

### Task 5: Generate Handler Outputs Performance Summary And Enqueues Deep Diagnostics

**Files:**
- Modify: `apps/worker/src/pipeline/generate-chapter-handler.ts`
- Modify: `apps/worker/src/pipeline/generate-chapter-handler.test.ts`

**Step 1: Write failing tests**

Add tests proving:

- parent job output contains `performanceSummary`;
- `qualityMode: "deep"` enqueues a `DIAGNOSE_CHAPTER` job after finalize succeeds;
- child enqueue failure does not fail the parent job.

Example assertion:

```ts
expect(generationJob.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    output: expect.objectContaining({
      performanceSummary: expect.objectContaining({
        qualityMode: "balanced"
      })
    })
  })
}));
```

For child enqueue, mock `prisma.generationJob.create` and assert:

```ts
expect(prisma.generationJob.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    jobType: "DIAGNOSE_CHAPTER",
    targetEntityType: "CHAPTER",
    targetEntityId: chapterId
  })
}));
```

**Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @ai-novel/worker test -- src/pipeline/generate-chapter-handler.test.ts
```

Expected: FAIL because handler output and child enqueueing are not implemented.

**Step 3: Read performance options from job input**

In `generate-chapter-handler.ts`:

- import `normalizeQualityMode` and `normalizePerformanceBudget`;
- add `performanceSummary` to `PipelineRunResult`;
- pass normalized performance config to `runChapterPipeline`;
- include the returned summary in `commitFinalize`.

**Step 4: Persist summary in final output**

Extend `CommitParams` and `FinalOutput`:

```ts
performanceSummary?: PerformanceSummary;
diagnosticWarning?: string;
```

Add `performanceSummary` to the `output` object inside `commitFinalize`.

**Step 5: Enqueue deep diagnostic child job**

After `commitFinalize` returns successfully, if `qualityMode === "deep"`:

```ts
await prisma.generationJob.create({
  data: {
    organizationId: job.organizationId,
    projectId: job.projectId,
    userId: job.userId,
    jobType: "DIAGNOSE_CHAPTER",
    targetEntityType: "CHAPTER",
    targetEntityId: chapter.id,
    status: "QUEUED",
    progress: "0",
    input: {
      chapterId: chapter.id,
      parentJobId: job.id,
      qualityMode: "deep",
      performanceBudget: normalizePerformanceBudget("balanced", undefined)
    }
  }
});
```

Wrap this enqueue in `try/catch`. If it fails, update the parent job output with `diagnosticWarning` but do not change parent status away from `SUCCEEDED`.

**Step 6: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/worker test -- src/pipeline/generate-chapter-handler.test.ts
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/worker/src/pipeline/generate-chapter-handler.ts apps/worker/src/pipeline/generate-chapter-handler.test.ts
git commit -m "feat(worker): persist performance summaries and deep diagnostics"
```

---

### Task 6: Chapter Diagnostic Handler

**Files:**
- Create: `apps/worker/src/pipeline/diagnose-chapter-handler.ts`
- Create: `apps/worker/src/pipeline/diagnose-chapter-handler.test.ts`

**Step 1: Write failing tests**

Create tests for:

- missing chapter fails with `CHAPTER_NOT_FOUND`;
- valid chapter completes with `diagnosticSummary` and `performanceSummary`;
- malformed model JSON returns a degraded diagnostic summary instead of throwing.

Example valid-output assertion:

```ts
expect(updateJobStatus).toHaveBeenCalledWith(expect.objectContaining({
  jobId: job.id,
  status: "SUCCEEDED",
  output: expect.objectContaining({
    diagnosticSummary: expect.objectContaining({
      readerScore: expect.any(Number),
      abandonRisk: expect.any(String),
      suggestions: expect.any(Array)
    }),
    performanceSummary: expect.objectContaining({
      modelCalls: 1
    })
  })
}));
```

**Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @ai-novel/worker test -- src/pipeline/diagnose-chapter-handler.test.ts
```

Expected: FAIL because the handler does not exist.

**Step 3: Implement handler**

Create `apps/worker/src/pipeline/diagnose-chapter-handler.ts` with:

- same dependency style as `deslop-handler.ts`;
- `resolveModel` support and fake fallback;
- chapter target resolution from `targetEntityId` or `input.chapterId`;
- chapter load including title, outline summary, content, project title, and style brief;
- one model-backed step `diagnose_chapter`;
- prompt asking for strict JSON:

```json
{
  "readerScore": 0,
  "abandonRisk": "low|medium|high",
  "hookStrength": 0,
  "pacingScore": 0,
  "styleDrift": 0,
  "continuityIssues": [{"severity": "info|warning|error", "detail": "", "suggestion": ""}],
  "suggestions": [""]
}
```

Use `safeJson` and clamp numeric scores to `0..100`.

**Step 4: Record step metrics**

Create a `GenerationStep` before the model call and update it after the call with:

- `status: "SUCCEEDED"`;
- `outputPreview`;
- `promptSnapshot`;
- `inputTokens`;
- `outputTokens`;
- `latencyMs`.

Use the shared tracker and include `performanceSummary` in job output.

**Step 5: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/worker test -- src/pipeline/diagnose-chapter-handler.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/pipeline/diagnose-chapter-handler.ts apps/worker/src/pipeline/diagnose-chapter-handler.test.ts
git commit -m "feat(worker): add async chapter diagnostic handler"
```

---

### Task 7: Worker Registration For Diagnostic Jobs

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/poll.test.ts` or add focused handler-map coverage if one exists

**Step 1: Write failing coverage**

Add or extend a worker registration test to prove `DIAGNOSE_CHAPTER`, `READER_SIMULATION`, `STYLE_DRIFT_CHECK`, and `CONTINUITY_CHECK` have handlers.

If there is no direct registration test, extract handler creation into:

```ts
export function createHandlers(deps: HandlerFactoryDeps): Map<string, JobHandler>
```

Then test `createHandlers`.

**Step 2: Run test to verify RED**

Run:

```bash
pnpm --filter @ai-novel/worker test
```

Expected: FAIL until handlers are registered.

**Step 3: Register handlers**

In `apps/worker/src/index.ts`:

- import `createDiagnoseChapterHandler`;
- register `DIAGNOSE_CHAPTER`;
- initially map `READER_SIMULATION`, `STYLE_DRIFT_CHECK`, and `CONTINUITY_CHECK` to the same handler with a distinct `diagnosticType` option, or register them as aliases that produce focused prompt labels.

Do not duplicate large handler code.

**Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/worker test
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/poll.test.ts
git commit -m "feat(worker): register generation diagnostic jobs"
```

---

### Task 8: Workspace UI For Quality Mode, Diagnostics, And Metrics

**Files:**
- Modify: `apps/web/src/components/workspace/ai-panel.tsx`
- Modify: `apps/web/src/components/workspace/use-workspace-data.ts`
- Modify: `apps/web/src/components/workspace/pipeline-timeline.tsx`
- Modify: `apps/web/src/app/(app)/projects/[projectId]/workspace/page.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify related tests if present for the above components

**Step 1: Write failing UI/hook tests**

Add tests proving:

- generate action sends selected `qualityMode`;
- diagnostic action creates `DIAGNOSE_CHAPTER`;
- job timeline renders `performanceSummary`;
- diagnostic job output renders separately from chapter generation status.

Use the existing component test style in `apps/web`.

**Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter @ai-novel/web test -- src/components/workspace
```

If no component test target exists, run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: FAIL until UI support is added.

**Step 3: Update data types**

In `use-workspace-data.ts`, extend `JobSummary` with:

```ts
performanceSummary?: PerformanceSummary;
diagnosticSummary?: ChapterDiagnosticSummary;
```

Import shared types where possible, or define local response-view types if API output remains JSON-shaped.

**Step 4: Add controls**

In `ai-panel.tsx`:

- add a segmented quality mode control with `fast`, `balanced`, `deep`;
- default to `balanced`;
- pass `{ qualityMode }` to `onGenerate`;
- add a secondary "Run diagnostics" button that calls a new `onDiagnose` prop.

Keep controls compact; this is an operational panel, not a landing page.

**Step 5: Wire workspace page**

In `workspace/page.tsx`:

- update `startGeneration` to include `qualityMode`;
- add `startDiagnostics` that posts:

```json
{ "chapterId": "...", "jobType": "DIAGNOSE_CHAPTER", "qualityMode": "balanced" }
```

- refresh/poll jobs after starting diagnostics.

**Step 6: Render metrics**

In `pipeline-timeline.tsx`:

- render model calls, input/output tokens, latency, and skipped count when `performanceSummary` exists;
- render diagnostic summary when `diagnosticSummary` exists;
- keep prompt snapshots and output previews visually separate.

Add CSS classes in `globals.css` with fixed max widths and wrapping text.

**Step 7: Run tests to verify GREEN**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm -C apps/web exec tsc --noEmit --incremental false
```

Expected: PASS.

**Step 8: Commit**

```bash
git add apps/web/src/components/workspace/ai-panel.tsx apps/web/src/components/workspace/use-workspace-data.ts apps/web/src/components/workspace/pipeline-timeline.tsx apps/web/src/app/(app)/projects/[projectId]/workspace/page.tsx apps/web/src/app/globals.css
git commit -m "feat(web): expose generation performance and diagnostics"
```

---

### Task 9: End-To-End Verification And Progress Notes

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `docs/current-progress.md`

**Step 1: Extend e2e smoke**

Update smoke coverage so it:

- creates or opens a project;
- generates a chapter in `balanced` mode;
- runs diagnostics manually;
- observes both generation and diagnostic job statuses reach `SUCCEEDED` under fake-model mode.

**Step 2: Run focused e2e**

Run:

```bash
pnpm test:e2e
```

Expected: PASS.

**Step 3: Run full verification**

Run:

```bash
pnpm db:validate
pnpm typecheck
pnpm test
pnpm test:e2e
git diff --check
```

Expected:

- Prisma schema validates.
- Typecheck passes for all workspaces.
- Unit tests pass.
- E2E tests pass.
- Diff has no whitespace errors.

**Step 4: Update progress notes**

Append a concise section to `docs/current-progress.md` with:

- implemented quality modes;
- performance budget behavior;
- diagnostic job types;
- fake-model verification evidence;
- any known limitations.

**Step 5: Commit**

```bash
git add apps/web/e2e/smoke.spec.ts docs/current-progress.md
git commit -m "docs: record generation performance architecture delivery"
```

---

## Final Verification Checklist

Run this after all tasks:

```bash
pnpm db:validate
pnpm db:generate
pnpm typecheck
pnpm test
pnpm test:e2e
git status --short
```

Expected:

- All commands pass.
- Only intentional files are changed or committed.
- No unrelated pre-existing working tree changes are reverted.

## Notes For Execution

- The current workspace already has unrelated uncommitted work. Stage only files touched by each task.
- Do not rewrite the existing context composer behavior while adding performance architecture.
- Keep `balanced` mode behavior compatible with current generation unless a test explicitly changes it.
- Use fake-model tests for worker behavior; real provider calls are not required for this feature.
