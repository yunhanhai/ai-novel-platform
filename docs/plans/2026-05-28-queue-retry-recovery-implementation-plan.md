# Queue Retry And Recovery Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add retry scheduling and expired lease recovery for generation jobs, then expose retry state in queue observability.

**Architecture:** Keep the existing job status enum and model retry delay as `QUEUED + nextRunAt > now`. Add DB helper functions for scheduling retries, terminal failures, claim filtering, and lease recovery. The worker uses these helpers when handlers fail and before polling for work. Queue observability derives retry metrics from the same fields.

**Tech Stack:** Prisma 7, PostgreSQL, TypeScript, Vitest, Next.js App Router, React 19, existing CSS in `apps/web/src/app/globals.css`.

---

### Task 1: DB Retry Schema And Helpers

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/202605280002_add_generation_job_retry_fields/migration.sql`
- Modify: `packages/db/src/generation-jobs.ts`
- Modify: `packages/db/src/generation-jobs.test.ts`

**Step 1: Write failing tests**

Add tests that expect:

- `createJob` writes `attemptCount: 0`, `maxAttempts: 3`, `nextRunAt: null`.
- `claimNextJob` filters out queued jobs with future `nextRunAt`.
- `scheduleJobRetry` increments attempt count, clears lease fields, and keeps error info.
- `markJobFailed` sets final failure fields.
- `recoverExpiredJobLeases` updates expired running jobs in a batch.

**Step 2: Run red test**

Run:

```bash
pnpm --filter @ai-novel/db test -- generation-jobs
```

Expected: FAIL because retry fields/helpers do not exist.

**Step 3: Add schema and migration**

Add to `GenerationJob`:

```prisma
attemptCount Int       @default(0) @map("attempt_count")
maxAttempts  Int       @default(3) @map("max_attempts")
nextRunAt    DateTime? @map("next_run_at") @db.Timestamptz(6)
```

Add index:

```prisma
@@index([organizationId, status, nextRunAt, createdAt], map: "idx_generation_jobs_org_status_next_run")
```

Migration:

```sql
ALTER TABLE "generation_jobs"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "next_run_at" TIMESTAMPTZ(6);

CREATE INDEX "idx_generation_jobs_org_status_next_run"
  ON "generation_jobs"("organization_id", "status", "next_run_at", "created_at");
```

**Step 4: Implement helpers**

Add:

- `computeRetryDelayMs(attemptNumber: number): number`
- `scheduleJobRetry(params)`
- `markJobFailed(params)`
- `recoverExpiredJobLeases(params)`

Update `claimNextJob` to filter `nextRunAt <= now OR null`.

**Step 5: Generate and verify**

Run:

```bash
pnpm db:generate
pnpm --filter @ai-novel/db test -- generation-jobs
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/202605280002_add_generation_job_retry_fields/migration.sql packages/db/src/generation-jobs.ts packages/db/src/generation-jobs.test.ts
git commit -m "feat(db): add generation job retry metadata"
```

### Task 2: Worker Retry Behavior

**Files:**
- Modify: `apps/worker/src/poll.ts`
- Modify: `apps/worker/src/poll.test.ts`
- Modify: `apps/worker/src/index.ts`

**Step 1: Write failing tests**

Add worker tests that expect:

- handler exceptions call `scheduleJobRetry` when attempts remain;
- exhausted attempts call final failure helper;
- missing handlers remain terminal;
- poller calls `recoverExpiredLeases` before claiming work.

**Step 2: Run red test**

Run:

```bash
pnpm --filter @ai-novel/worker test -- poll
```

Expected: FAIL because poller does not accept retry/recovery deps.

**Step 3: Implement worker dependencies**

Extend `createPoller` deps with:

- `scheduleJobRetry`
- `markJobFailed`
- `recoverExpiredLeases`
- `now`

Keep `updateJobStatus` for successful handler-owned flows if still needed, but route poller-level errors through retry helpers.

**Step 4: Wire index**

Import DB helpers and pass them to `createPoller`.

**Step 5: Verify**

Run:

```bash
pnpm --filter @ai-novel/worker test -- poll
pnpm --filter @ai-novel/worker test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/worker/src/poll.ts apps/worker/src/poll.test.ts apps/worker/src/index.ts
git commit -m "feat(worker): retry transient generation failures"
```

### Task 3: Queue Observability Retry Metrics

**Files:**
- Modify: `apps/web/src/server/queue-observability.ts`
- Modify: `apps/web/src/server/queue-observability.test.ts`

**Step 1: Write failing tests**

Add tests that expect:

- retrying queued jobs are counted separately from ready queued jobs;
- oldest retrying job includes `nextRunAt` and `retryInMs`;
- health state becomes `backlog` or `attention` with a retry-focused label when only retry-delayed jobs exist.

**Step 2: Run red test**

Run:

```bash
pnpm --filter @ai-novel/web test -- queue-observability
```

Expected: FAIL because retry fields are not returned.

**Step 3: Implement API aggregation**

Extend job selection with:

- `attemptCount`
- `maxAttempts`
- `nextRunAt`

Add `retrying` to totals and derive it from queued jobs whose `nextRunAt > now`.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test -- queue-observability
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/server/queue-observability.ts apps/web/src/server/queue-observability.test.ts
git commit -m "feat(web): expose queue retry metrics"
```

### Task 4: Queue Panel Retry UI

**Files:**
- Modify: `apps/web/src/components/projects/queue-observability-panel-model.ts`
- Modify: `apps/web/src/components/projects/queue-observability-panel-model.test.ts`
- Modify: `apps/web/src/components/projects/queue-observability-panel.tsx`
- Modify: `apps/web/src/app/globals.css`

**Step 1: Write failing UI model tests**

Add tests for:

- retry wait formatting;
- retry status bucket display;
- recent jobs showing attempt count.

**Step 2: Run red test**

Run:

```bash
pnpm --filter @ai-novel/web test -- queue-observability-panel-model
```

Expected: FAIL because retry UI helpers do not exist.

**Step 3: Implement UI**

Apply `ui-ux-pro-max` operational dashboard rules:

- keep retry metrics inside the existing queue panel;
- add a compact "等待重试" metric;
- show `attemptCount/maxAttempts` in recent job rows;
- use stable row grids and avoid overflow on mobile.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test -- queue-observability-panel-model
pnpm --filter @ai-novel/web test -- queue-observability
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/projects/queue-observability-panel-model.ts apps/web/src/components/projects/queue-observability-panel-model.test.ts apps/web/src/components/projects/queue-observability-panel.tsx apps/web/src/app/globals.css
git commit -m "feat(web): show queue retry state"
```

### Task 5: Verification And Progress Notes

**Files:**
- Modify: `docs/current-progress.md`

**Step 1: Update notes**

Append:

- retry metadata and defaults;
- worker retry behavior;
- expired lease recovery;
- queue UI retry state;
- migration note.

**Step 2: Run verification**

Run:

```bash
pnpm db:validate
pnpm db:generate
pnpm --filter @ai-novel/db test
pnpm --filter @ai-novel/worker test
pnpm --filter @ai-novel/web test
pnpm typecheck
pnpm test
pnpm test:e2e
git diff --check
git status --short
```

Expected: PASS. If `pnpm db:migrate` detects local drift, use `prisma migrate deploy` for local verification and do not reset the database without explicit user approval.

**Step 3: Commit**

```bash
git add docs/current-progress.md
git commit -m "docs: record queue retry recovery"
```
