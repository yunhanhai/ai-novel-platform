# Queue Recovery Actions Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add safe manual queue recovery actions for failed jobs and expired running leases.

**Architecture:** Add a DB helper for failed-job retry and reuse the existing expired-lease recovery helper. Expose both through current organization-scoped API routes, then add compact action controls to the existing queue observability panel.

**Tech Stack:** Prisma 7, PostgreSQL, TypeScript, Vitest, Next.js App Router, React 19, existing CSS in `apps/web/src/app/globals.css`.

---

### Task 1: DB Failed Job Retry Helper

**Files:**
- Modify: `packages/db/src/generation-jobs.ts`
- Modify: `packages/db/src/generation-jobs.test.ts`
- Modify: `packages/db/src/index.ts`

**Step 1: Write failing tests**

Add tests that expect:

- `retryFailedJob` moves a failed job in the same organization to ready `QUEUED`.
- It clears `errorCode`, `errorMessage`, `lockKey`, `leaseExpiresAt`, `startedAt`, `finishedAt`, `nextRunAt`, and resets `progress` to `"0"`.
- It returns `{ ok: false, reason: "not_found" }` when no job matches `id + organizationId`.
- It returns `{ ok: false, reason: "invalid_status" }` when the job is not `FAILED`.

**Step 2: Run red test**

Run:

```bash
pnpm --filter @ai-novel/db test -- generation-jobs
```

Expected: FAIL because `retryFailedJob` does not exist.

**Step 3: Implement helper**

Add:

```ts
export type RetryFailedJobResult =
  | { ok: true; job: Awaited<ReturnType<PrismaClient["generationJob"]["update"]>> }
  | { ok: false; reason: "not_found" | "invalid_status"; status?: string };
```

Implement `retryFailedJob({ organizationId, jobId, now, prisma })` with a first `findFirst` scoped to `organizationId`, then an update only for `FAILED`.

**Step 4: Export helper**

Add `retryFailedJob` to `packages/db/src/index.ts`.

**Step 5: Verify and commit**

Run:

```bash
pnpm --filter @ai-novel/db test -- generation-jobs
pnpm --filter @ai-novel/db test
pnpm typecheck
```

Commit:

```bash
git add packages/db/src/generation-jobs.ts packages/db/src/generation-jobs.test.ts packages/db/src/index.ts
git commit -m "feat(db): add manual failed job retry helper"
```

### Task 2: Queue Recovery API Actions

**Files:**
- Modify: `apps/web/src/app/api/generation-jobs/[id]/route.ts`
- Modify: `apps/web/src/app/api/generation-jobs/[id]/route.test.ts`
- Modify: `apps/web/src/app/api/queue-observability/route.ts`
- Modify: `apps/web/src/app/api/queue-observability/route.test.ts`

**Step 1: Write failing route tests**

Add tests that expect:

- `POST /api/generation-jobs/[id]` with `{ action: "retry" }` calls `retryFailedJob` with current organization id.
- It returns 200 on success, 404 on `not_found`, 409 on `invalid_status`, 400 on unknown action.
- `POST /api/queue-observability` with `{ action: "recover-expired-leases" }` calls `recoverExpiredJobLeases` with current organization id and returns recovered/failed counts.

**Step 2: Run red tests**

Run:

```bash
pnpm --filter @ai-novel/web test -- generation-jobs/[id] queue-observability
```

Expected: FAIL because POST actions do not exist.

**Step 3: Implement routes**

- Import `retryFailedJob` into `[id]/route.ts`.
- Add a body parser that accepts only `{ action: "retry" }`.
- Import `recoverExpiredJobLeases` into `queue-observability/route.ts`.
- Add a body parser that accepts only `{ action: "recover-expired-leases" }`.

**Step 4: Verify and commit**

Run:

```bash
pnpm --filter @ai-novel/web test -- generation-jobs/[id] queue-observability
pnpm --filter @ai-novel/web test
pnpm typecheck
```

Commit:

```bash
git add apps/web/src/app/api/generation-jobs/[id]/route.ts apps/web/src/app/api/generation-jobs/[id]/route.test.ts apps/web/src/app/api/queue-observability/route.ts apps/web/src/app/api/queue-observability/route.test.ts
git commit -m "feat(web): add queue recovery actions api"
```

### Task 3: Queue Panel Recovery UI

**Files:**
- Modify: `apps/web/src/components/projects/queue-observability-panel-model.ts`
- Modify: `apps/web/src/components/projects/queue-observability-panel-model.test.ts`
- Modify: `apps/web/src/components/projects/queue-observability-panel.tsx`
- Modify: `apps/web/src/app/globals.css`

**Step 1: Write failing UI model tests**

Add tests that expect:

- `canRetryJob(job)` is true only for `FAILED`.
- `getQueueActionCopy("recover-expired-leases")` returns stable labels.

**Step 2: Run red test**

Run:

```bash
pnpm --filter @ai-novel/web test -- queue-observability-panel-model
```

Expected: FAIL because helpers do not exist.

**Step 3: Implement UI**

Apply `ui-ux-pro-max` operational dashboard rules:

- Add one compact action row under the queue header.
- Add a `回收过期租约` button.
- Add `重试` buttons only to failed recent jobs.
- Disable buttons while a matching request is running.
- Reuse the existing panel error area for operation errors.

**Step 4: Verify and commit**

Run:

```bash
pnpm --filter @ai-novel/web test -- queue-observability-panel-model
pnpm --filter @ai-novel/web test -- queue-observability
pnpm typecheck
```

Commit:

```bash
git add apps/web/src/components/projects/queue-observability-panel-model.ts apps/web/src/components/projects/queue-observability-panel-model.test.ts apps/web/src/components/projects/queue-observability-panel.tsx apps/web/src/app/globals.css
git commit -m "feat(web): add queue recovery controls"
```

### Task 4: Documentation And Verification

**Files:**
- Modify: `docs/current-progress.md`

**Step 1: Update progress notes**

Record:

- Manual retry helper and API.
- Manual expired lease recovery API.
- Queue panel recovery controls.
- Verification results.

**Step 2: Run verification**

Run:

```bash
pnpm db:validate
pnpm --filter @ai-novel/db test
pnpm --filter @ai-novel/worker test
pnpm --filter @ai-novel/web test
pnpm typecheck
pnpm test
pnpm test:e2e
git diff --check
git status --short
```

Expected: PASS. If `pnpm db:migrate` reports existing local drift, do not reset the database.

**Step 3: Commit**

```bash
git add docs/current-progress.md
git commit -m "docs: record queue recovery actions"
```
