# Context Composer Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Context Composer that previews and adjusts one-off chapter generation context before creating a generation job.

**Architecture:** Put shared `contextOptions` types and pure selection helpers in `packages/shared`, expose a web preview API, and pass selected options through `GenerationJob.input` for the worker to consume. Reuse the existing `runChapterPipeline` `buildContext` boundary and avoid schema migrations.

**Tech Stack:** TypeScript, Next.js App Router, React, Prisma/PostgreSQL JSON fields, Vitest, existing fake-model worker tests.

---

### Task 1: Shared Context Composer Contract

**Files:**
- Create: `packages/shared/src/context-composer/types.ts`
- Create: `packages/shared/src/context-composer/options.ts`
- Create: `packages/shared/src/context-composer/options.test.ts`
- Modify: `packages/shared/package.json`

**Step 1: Write the failing tests**

Create `packages/shared/src/context-composer/options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeContextOptions, resolveTokenBudget } from "./options";

describe("context composer options", () => {
  it("defaults to standard budget and empty override lists", () => {
    expect(normalizeContextOptions(undefined)).toEqual({
      budgetPreset: "standard",
      excludedAssetIds: [],
      forcedAssetIds: []
    });
  });

  it("drops duplicate and non-string ids", () => {
    expect(normalizeContextOptions({
      budgetPreset: "rich",
      excludedAssetIds: ["a", "a", "", 42],
      forcedAssetIds: ["b", "b", null]
    })).toEqual({
      budgetPreset: "rich",
      excludedAssetIds: ["a"],
      forcedAssetIds: ["b"]
    });
  });

  it("maps budget presets to token budgets", () => {
    expect(resolveTokenBudget("compact")).toBe(2400);
    expect(resolveTokenBudget("standard")).toBe(4000);
    expect(resolveTokenBudget("rich")).toBe(7000);
  });
});
```

**Step 2: Verify RED**

Run: `pnpm --filter @ai-novel/shared test -- src/context-composer/options.test.ts`

Expected: FAIL because the files/functions do not exist.

**Step 3: Implement minimal shared contract**

Create `packages/shared/src/context-composer/types.ts`:

```ts
export type ContextBudgetPreset = "compact" | "standard" | "rich";

export interface ContextOptions {
  budgetPreset?: ContextBudgetPreset;
  excludedAssetIds?: unknown[];
  forcedAssetIds?: unknown[];
}

export interface NormalizedContextOptions {
  budgetPreset: ContextBudgetPreset;
  excludedAssetIds: string[];
  forcedAssetIds: string[];
}

export type ContextAssetType =
  | "character"
  | "world_item"
  | "plot_thread"
  | "memory"
  | "style"
  | "methodology";

export interface ContextAsset {
  id: string;
  sourceType: ContextAssetType;
  name: string;
  content: string;
  priority: number;
  reason: string;
  matchedKeywords: string[];
  tokenEstimate: number;
  required?: boolean;
}
```

Create `packages/shared/src/context-composer/options.ts`:

```ts
import type { ContextBudgetPreset, ContextOptions, NormalizedContextOptions } from "./types";

const PRESETS: Record<ContextBudgetPreset, number> = {
  compact: 2400,
  standard: 4000,
  rich: 7000
};

export function normalizeContextOptions(input: ContextOptions | undefined): NormalizedContextOptions {
  return {
    budgetPreset: isPreset(input?.budgetPreset) ? input.budgetPreset : "standard",
    excludedAssetIds: uniqueStrings(input?.excludedAssetIds),
    forcedAssetIds: uniqueStrings(input?.forcedAssetIds)
  };
}

export function resolveTokenBudget(preset: ContextBudgetPreset): number {
  return PRESETS[preset];
}

function isPreset(value: unknown): value is ContextBudgetPreset {
  return value === "compact" || value === "standard" || value === "rich";
}

function uniqueStrings(values: unknown[] | undefined): string[] {
  return [...new Set((values ?? []).filter((v): v is string => typeof v === "string" && v.length > 0))];
}
```

Modify `packages/shared/package.json` exports:

```json
"./context-composer/options": "./src/context-composer/options.ts",
"./context-composer/types": "./src/context-composer/types.ts",
```

**Step 4: Verify GREEN**

Run: `pnpm --filter @ai-novel/shared test -- src/context-composer/options.test.ts`

Expected: PASS.

---

### Task 2: Context Packet Selection Result

**Files:**
- Modify: `apps/worker/src/context/build-context-packet.ts`
- Modify: `apps/worker/src/context/build-context-packet.test.ts`

**Step 1: Write failing tests**

Add tests proving the builder returns included/trimmed metadata and applies one-off options:

```ts
it("reports included and trimmed assets", () => {
  const result = buildContextPacket({ ...baseInput, tokenBudget: 200 });
  expect(result.assets.included.length).toBeGreaterThan(0);
  expect(result.assets.trimmed.length).toBeGreaterThan(0);
});

it("excludes optional assets by id", () => {
  const result = buildContextPacket({
    ...baseInput,
    contextOptions: { excludedAssetIds: ["ch2"] }
  });
  expect(result.prompt).not.toContain("林薇");
  expect(result.assets.excluded.map((a) => a.id)).toContain("ch2");
});

it("forces available assets into context", () => {
  const result = buildContextPacket({
    ...baseInput,
    currentChapter: { ...baseInput.currentChapter, outlineSummary: "只写主角行动" },
    contextOptions: { forcedAssetIds: ["w1"] }
  });
  expect(result.prompt).toContain("星门");
  expect(result.assets.forced.map((a) => a.id)).toContain("w1");
});
```

Use the existing mojibake strings if needed to match the test fixture; keep new ids ASCII.

**Step 2: Verify RED**

Run: `pnpm --filter @ai-novel/worker test -- src/context/build-context-packet.test.ts`

Expected: FAIL because `contextOptions` and `assets` are not implemented.

**Step 3: Implement selection metadata**

Update `PacketInput` to accept:

```ts
contextOptions?: import("@ai-novel/shared/context-composer/types").NormalizedContextOptions;
```

Return:

```ts
assets: {
  required: ContextAsset[];
  included: ContextAsset[];
  trimmed: ContextAsset[];
  available: ContextAsset[];
  excluded: ContextAsset[];
  forced: ContextAsset[];
  estimatedTokens: number;
  tokenBudget: number;
}
```

Implementation rules:

- Convert characters, activated world items, plot threads, memories, style items, and methodology review items into `ContextAsset`.
- Required items are style brief/methodology guide blocks already injected in the static sections.
- Apply `excludedAssetIds` only to optional assets.
- Add `forcedAssetIds` from all available candidates before budgeting.
- Keep budget sorting by priority.
- Preserve existing prompt content and existing tests.

**Step 4: Verify GREEN**

Run: `pnpm --filter @ai-novel/worker test -- src/context/build-context-packet.test.ts`

Expected: PASS.

---

### Task 3: Server Context Preview Loader

**Files:**
- Create: `apps/web/src/server/context-preview.ts`
- Create: `apps/web/src/server/context-preview.test.ts`

**Step 1: Write failing tests**

Test behaviors:

- returns `null` when chapter is missing
- loads project/chapter/assets for the organization
- passes normalized context options to the packet builder
- returns included/available/trimmed groups

Mock a Prisma-like object and avoid real database access.

**Step 2: Verify RED**

Run: `pnpm --filter @ai-novel/web test -- src/server/context-preview.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Implement loader**

Implement:

```ts
export async function buildChapterContextPreview(params: {
  organizationId: string;
  chapterId: string;
  rawOptions?: ContextOptions;
  prisma: PrismaClient;
}): Promise<ContextPreview | null>
```

Queries:

- `chapter.findFirst` with project and target outlines or `outline.findFirst` for summary.
- `character.findMany` active non-deleted.
- `worldItem.findMany` active non-deleted.
- `plotThread.findMany` active/planted/progressing/deferred non-deleted.
- `projectMemory.findMany` accepted only, newest first, `take: 20`.
- active `styleProfile.findFirst`.
- active `writingMethodology.findFirst`.

Transform DB rows into `PacketInput`, call `buildContextPacket`, and return the preview response.

**Step 4: Verify GREEN**

Run: `pnpm --filter @ai-novel/web test -- src/server/context-preview.test.ts`

Expected: PASS.

---

### Task 4: Context Preview API Route

**Files:**
- Create: `apps/web/src/app/api/chapters/[chapterId]/context-preview/route.ts`
- Create: `apps/web/src/app/api/chapters/[chapterId]/context-preview/route.test.ts`

**Step 1: Write failing route tests**

Cover:

- `GET` returns preview for default options.
- `POST` accepts `contextOptions`.
- invalid options return 400.
- missing chapter returns 404.

**Step 2: Verify RED**

Run: `pnpm --filter @ai-novel/web test -- src/app/api/chapters/[chapterId]/context-preview/route.test.ts`

Expected: FAIL because the route does not exist.

**Step 3: Implement route**

Implement:

- `GET` reads `budgetPreset`, repeated `excludedAssetIds`, repeated `forcedAssetIds` from search params.
- `POST` reads JSON body `{ contextOptions }`.
- call `buildChapterContextPreview`.
- use existing `getOrganizationId`.

**Step 4: Verify GREEN**

Run: `pnpm --filter @ai-novel/web test -- src/app/api/chapters/[chapterId]/context-preview/route.test.ts`

Expected: PASS.

---

### Task 5: Store Context Options on Job Creation

**Files:**
- Modify: `apps/web/src/app/api/generation-jobs/route.ts`
- Modify: `apps/web/src/app/api/generation-jobs/route.test.ts`
- Modify: `apps/web/src/components/workspace/use-workspace-data.ts`

**Step 1: Write failing tests**

Add a route test:

```ts
it("stores contextOptions in job input", async () => {
  p().chapter.findFirst.mockResolvedValue({ id: "ch-1", projectId: "proj-1" });
  cj().mockResolvedValue({ id: "job-1", jobType: "GENERATE_CHAPTER", status: "QUEUED", projectId: "proj-1" });

  const res = await POST(req({
    chapterId: "ch-1",
    jobType: "GENERATE_CHAPTER",
    contextOptions: { budgetPreset: "compact", excludedAssetIds: ["ch2"] }
  }));

  expect(res.status).toBe(201);
  expect(cj()).toHaveBeenCalledWith(expect.objectContaining({
    input: expect.objectContaining({
      contextOptions: expect.objectContaining({ budgetPreset: "compact" })
    })
  }));
});
```

**Step 2: Verify RED**

Run: `pnpm --filter @ai-novel/web test -- src/app/api/generation-jobs/route.test.ts`

Expected: FAIL because `contextOptions` is ignored.

**Step 3: Implement API and hook changes**

Route:

- add `contextOptions?: ContextOptions` to body.
- normalize it.
- merge into `input` as `{ ...body.input, contextOptions }`.

Hook:

- change `startJob(chapterId, jobType?, contextOptions?)`.
- include `contextOptions` in POST body only for `GENERATE_CHAPTER`.

**Step 4: Verify GREEN**

Run:

- `pnpm --filter @ai-novel/web test -- src/app/api/generation-jobs/route.test.ts`
- `pnpm -C apps/web exec tsc --noEmit --incremental false`

Expected: PASS and typecheck clean.

---

### Task 6: Worker Applies Context Options

**Files:**
- Create: `apps/worker/src/context/load-context-packet.ts`
- Create: `apps/worker/src/context/load-context-packet.test.ts`
- Modify: `apps/worker/src/pipeline/generate-chapter-handler.ts`
- Modify: `apps/worker/src/pipeline/generate-chapter-handler.test.ts`

**Step 1: Write failing tests**

Add tests proving:

- handler passes `job.input.contextOptions` into `buildContextPacket`.
- final job output includes `contextSummary` with included/trimmed counts.

**Step 2: Verify RED**

Run: `pnpm --filter @ai-novel/worker test -- src/pipeline/generate-chapter-handler.test.ts`

Expected: FAIL.

**Step 3: Implement worker integration**

- Normalize `job.input.contextOptions`.
- Add `loadContextPacketForChapter({ prisma, organizationId, projectId, chapterId, contextOptions })` in `apps/worker/src/context/load-context-packet.ts`.
- The worker loader should query the same asset families as the web preview loader and then call `buildContextPacket`.
- Keep the worker loader local to `apps/worker`; do not import from `apps/web/src/server`.
- Replace the current placeholder `buildContext` callback in `generate-chapter-handler.ts` with this worker loader.
- Add `contextSummary` to finalize output:

```ts
contextSummary: {
  budgetPreset,
  includedCount,
  trimmedCount,
  forcedCount,
  excludedCount
}
```

**Step 4: Verify GREEN**

Run: `pnpm --filter @ai-novel/worker test -- src/pipeline/generate-chapter-handler.test.ts`

Expected: PASS.

---

### Task 7: Workspace Context Composer UI

**Files:**
- Create: `apps/web/src/components/workspace/context-composer.tsx`
- Create: `apps/web/src/components/workspace/context-composer.test.tsx` if the repo has React component test support; otherwise test the hook only.
- Modify: `apps/web/src/components/workspace/ai-panel.tsx`
- Modify: `apps/web/src/components/workspace/use-workspace-data.ts`
- Modify: `apps/web/src/app/(app)/projects/[projectId]/workspace/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Step 1: Write failing tests**

Preferred test: a hook/unit test proving `startJob` sends context options. If component tests are awkward, keep UI verified by typecheck and route/hook tests.

**Step 2: Verify RED**

Run focused web tests.

**Step 3: Implement UI**

Component responsibilities:

- load preview for `chapterId`.
- maintain local `budgetPreset`, `excludedAssetIds`, `forcedAssetIds`.
- refresh preview when options change.
- expose current normalized options to parent via `onOptionsChange`.
- render:
  - budget segmented control
  - counters
  - included list with checkboxes
  - available list with add buttons
  - trimmed list read-only
  - prompt preview in `<details>`

Wire `WorkspacePage.handleGenerate` to call:

```ts
await startJob(activeChapterId, "GENERATE_CHAPTER", contextOptions);
```

**Step 4: Verify GREEN**

Run:

- `pnpm -C apps/web exec tsc --noEmit --incremental false`
- `pnpm --filter @ai-novel/web test`

Expected: PASS.

---

### Task 8: Job Trace Display

**Files:**
- Modify: `apps/web/src/components/workspace/use-workspace-data.ts`
- Modify: `apps/web/src/components/workspace/pipeline-timeline.tsx`
- Modify: `apps/web/src/app/api/generation-jobs/[id]/route.test.ts` if coverage exists for output fields

**Step 1: Write failing tests**

Add or update a test to prove job output can include `contextSummary` without type errors.

**Step 2: Implement display**

- Extend `JobSummary` with optional `output`.
- In `PipelineTimeline` or AI panel, show context summary for completed generation jobs:
  - budget preset
  - included count
  - trimmed count
  - forced count
  - excluded count

**Step 3: Verify**

Run:

- `pnpm -C apps/web exec tsc --noEmit --incremental false`
- `pnpm --filter @ai-novel/web test`

Expected: PASS.

---

### Task 9: Final Verification

**Files:**
- No new files unless fixing test failures.

**Step 1: Run full affected checks**

Run:

- `pnpm --filter @ai-novel/shared test`
- `pnpm --filter @ai-novel/worker test`
- `pnpm -C apps/web exec tsc --noEmit --incremental false`
- `pnpm --filter @ai-novel/web test`
- `pnpm --filter @ai-novel/web build`

**Step 2: Clean generated noise**

If `apps/web/next-env.d.ts` changes from:

```ts
import "./.next/dev/types/routes.d.ts";
```

to:

```ts
import "./.next/types/routes.d.ts";
```

restore only that line with `apply_patch`.

**Step 3: Review status**

Run:

- `git status --short`
- `git diff --check`

Expected: only intentional source/doc changes and the existing `.claude/` untracked directory.
