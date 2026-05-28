# Queue Observability Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `/projects` organization queue health panel backed by real `generation_jobs` aggregation.

**Architecture:** Put aggregation in `apps/web/src/server/queue-observability.ts`, expose it through `GET /api/queue-observability`, and render a client component on `/projects`. Keep this phase DB-schema-free and reserve worker heartbeats for a later task.

**Tech Stack:** TypeScript, Next.js App Router, React client component, Prisma/PostgreSQL, Vitest, Playwright.

---

### Task 1: Queue Observability Model

**Files:**
- Create: `apps/web/src/server/queue-observability.ts`
- Create: `apps/web/src/server/queue-observability.test.ts`

**Steps:**
1. Write failing tests for empty data, status counts, oldest queued wait, recent jobs, and health state.
2. Run `pnpm --filter @ai-novel/web test -- queue-observability.test.ts` and confirm RED.
3. Implement `getQueueObservability({ organizationId, prisma, now })`.
4. Run the focused test and confirm GREEN.

### Task 2: API Route

**Files:**
- Create: `apps/web/src/app/api/queue-observability/route.ts`
- Create: `apps/web/src/app/api/queue-observability/route.test.ts`

**Steps:**
1. Write failing tests for normal response, missing organization config, and invalid backend failure.
2. Run `pnpm --filter @ai-novel/web test -- queue-observability`.
3. Implement the route using `getOrganizationId()` and `getQueueObservability()`.
4. Run focused tests and confirm GREEN.

### Task 3: Projects Page UI

**Files:**
- Create: `apps/web/src/components/projects/queue-observability-panel.tsx`
- Create: `apps/web/src/components/projects/queue-observability-panel-model.ts`
- Create: `apps/web/src/components/projects/queue-observability-panel-model.test.ts`
- Modify: `apps/web/src/app/(app)/projects/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Steps:**
1. Write failing pure view-model tests for health labels, status ordering, and stable percentage widths.
2. Run focused tests and confirm RED.
3. Implement the model helpers.
4. Build a compact client panel with loading, error, empty, and populated states.
5. Insert the panel below the organization performance overview.
6. Run focused tests and typecheck.

### Task 4: E2E And Documentation

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `docs/current-progress.md`

**Steps:**
1. Add smoke coverage for the queue health panel heading.
2. Append a concise progress note.
3. Run `pnpm --filter @ai-novel/web test`.
4. Run `pnpm typecheck`.
5. Run `pnpm test:e2e`.
6. Run `git diff --check`.
7. Commit the completed feature.
