# Generation Diagnostics Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add post-generation diagnostics so each completed generation job can show the context summary and prompt snapshots used by its pipeline steps.

**Architecture:** Reuse existing `GenerationStep.promptSnapshot` and `GenerationJob.output.contextSummary`. Store a bounded prompt snapshot during worker step updates, return it from the job detail API, and render compact details in the AI panel timeline.

**Tech Stack:** TypeScript, Prisma JSON fields, Next.js App Router, React, Vitest.

---

### Task 1: Persist Prompt Snapshots

**Files:**
- Modify: `apps/worker/src/pipeline/chapter-pipeline.ts`
- Modify: `apps/worker/src/pipeline/chapter-pipeline.test.ts`
- Modify: `apps/worker/src/pipeline/generate-chapter-handler.ts`

**Steps:**
1. Add a failing test that `updateStep` receives `promptSnapshot` for model-backed steps.
2. Extend `PipelineDeps.updateStep` to accept `promptSnapshot?: string`.
3. In `execStep`, pass `promptText.slice(0, 4000)` as `promptSnapshot`.
4. Persist `promptSnapshot` in `generate-chapter-handler` step updates.
5. Run `pnpm --filter @ai-novel/worker test -- src/pipeline/chapter-pipeline.test.ts`.

### Task 2: Expose Prompt Snapshots

**Files:**
- Modify: `apps/web/src/app/api/generation-jobs/[id]/route.ts`
- Modify: `apps/web/src/app/api/generation-jobs/[id]/route.test.ts`
- Modify: `apps/web/src/components/workspace/use-workspace-data.ts`

**Steps:**
1. Add a route test proving step `promptSnapshot` is selected.
2. Include `promptSnapshot` in step select.
3. Add optional `promptSnapshot` to `JobSummary.steps`.
4. Run the focused route test and web typecheck.

### Task 3: Render Diagnostics

**Files:**
- Modify: `apps/web/src/components/workspace/pipeline-timeline.tsx`
- Modify: `apps/web/src/app/globals.css`

**Steps:**
1. Show a `details` block named `查看 prompt 快照` when a step has `promptSnapshot`.
2. Keep output preview and prompt snapshot visually separate.
3. Add compact CSS with fixed max height and wrapped text.
4. Run web typecheck and web tests.

### Task 4: Final Verification

Run:

```bash
pnpm --filter @ai-novel/worker test
pnpm --filter @ai-novel/worker typecheck
pnpm --filter @ai-novel/web test
pnpm -C apps/web exec tsc --noEmit --incremental false
pnpm --filter @ai-novel/web build
git diff --check
```
