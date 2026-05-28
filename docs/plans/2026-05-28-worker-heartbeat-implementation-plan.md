# Worker Heartbeat Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add database-backed worker heartbeat tracking and surface worker online state in the queue observability panel.

**Architecture:** Workers upsert heartbeat rows by `lockKey`, report poll tick status, and refresh periodically. The web queue observability API reads heartbeat rows for the current organization and combines worker liveness with queue health. The UI adds a compact worker section inside the existing operational dashboard.

**Tech Stack:** Prisma 7, PostgreSQL, Vitest, Next.js 16, React 19, TypeScript, existing CSS modules in `globals.css`.

---

### Task 1: DB Heartbeat Helpers

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/202605280001_add_worker_heartbeats/migration.sql`
- Create: `packages/db/src/worker-heartbeats.ts`
- Create: `packages/db/src/worker-heartbeats.test.ts`
- Modify: `packages/db/src/index.ts`

**Steps:**

1. Write failing tests for `upsertWorkerHeartbeat` and `listWorkerHeartbeats`.
2. Run `pnpm --filter @ai-novel/db test -- worker-heartbeats` and verify missing module/helper failure.
3. Add `WorkerHeartbeat` Prisma model and SQL migration.
4. Implement helper functions using `prisma.workerHeartbeat.upsert` and `findMany`.
5. Export helpers from `packages/db/src/index.ts`.
6. Run `pnpm db:generate` and DB tests.
7. Commit with `feat(db): add worker heartbeats`.

### Task 2: Worker Heartbeat Runtime

**Files:**
- Create: `apps/worker/src/heartbeat.ts`
- Create: `apps/worker/src/heartbeat.test.ts`
- Modify: `apps/worker/src/index.ts`

**Steps:**

1. Write failing tests for immediate heartbeat write, periodic refresh, error isolation, and tick status reporting.
2. Run `pnpm --filter @ai-novel/worker test -- heartbeat` and verify expected failure.
3. Implement `createWorkerHeartbeat`.
4. Wire heartbeat into `apps/worker/src/index.ts`.
5. Run worker tests.
6. Commit with `feat(worker): report heartbeat status`.

### Task 3: Queue Observability API

**Files:**
- Modify: `apps/web/src/server/queue-observability.ts`
- Modify: `apps/web/src/server/queue-observability.test.ts`

**Steps:**

1. Add failing tests for worker aggregation and queued jobs with no online workers.
2. Run `pnpm --filter @ai-novel/web test -- queue-observability`.
3. Extend API types and Prisma query.
4. Add worker health classification before ordinary backlog state.
5. Run targeted web tests.
6. Commit with `feat(web): include worker liveness in queue observability`.

### Task 4: Queue Panel UI

**Files:**
- Modify: `apps/web/src/components/projects/queue-observability-panel-model.ts`
- Modify: `apps/web/src/components/projects/queue-observability-panel-model.test.ts`
- Modify: `apps/web/src/components/projects/queue-observability-panel.tsx`
- Modify: `apps/web/src/app/globals.css`

**Steps:**

1. Add failing UI model tests for heartbeat age labels and worker status labels.
2. Run `pnpm --filter @ai-novel/web test -- queue-observability-panel-model`.
3. Implement formatting helpers and compact worker list UI.
4. Apply `ui-ux-pro-max` operational dashboard rules: compact rows, stable dimensions, accessible contrast, responsive wrapping.
5. Run targeted web tests.
6. Commit with `feat(web): show worker heartbeat health`.

### Task 5: Verification

**Files:**
- Modify: `docs/current-progress.md`

**Steps:**

1. Update current progress with Worker heartbeat completion notes.
2. Run:
   - `pnpm db:generate`
   - `pnpm --filter @ai-novel/db test`
   - `pnpm --filter @ai-novel/worker test`
   - `pnpm --filter @ai-novel/web test`
   - `pnpm typecheck`
   - `pnpm test`
   - `git diff --check`
3. Commit with `docs: record worker heartbeat observability`.
