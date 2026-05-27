# Performance Health Insights Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deterministic performance health insights to the trend DTO and organization overview.

**Architecture:** Extend the existing `getPerformanceTrends` aggregation output with an `insights` array derived from already-computed totals and breakdowns. Render the insights in the existing `/projects` organization performance overview without adding storage or new routes.

**Tech Stack:** TypeScript, Prisma-backed Next.js server helper, React client components, existing CSS, Vitest, Playwright.

---

## Task 1: Backend Insight Generation

**Files:**
- Modify: `apps/web/src/server/performance-trends.ts`
- Modify: `apps/web/src/server/performance-trends.test.ts`

**Steps:**

1. Write failing tests for no-data, missing-cost, high-latency project, high-token project, and concentrated-usage insights.
2. Run `pnpm --filter @ai-novel/web test -- performance-trends.test.ts` and confirm failure.
3. Add `PerformanceInsight` type and `insights` field to `PerformanceTrends`.
4. Implement deterministic `buildInsights`.
5. Run focused tests and typecheck.
6. Commit as `feat(web): add performance health insights`.

## Task 2: Organization Overview UI

**Files:**
- Modify: `apps/web/src/components/workspace/use-workspace-data.ts`
- Modify: `apps/web/src/components/projects/organization-performance-overview.tsx`
- Modify: `apps/web/src/app/globals.css`

**Steps:**

1. Add `insights` to the frontend `PerformanceTrends` type.
2. Render a `需要关注` section in the organization overview.
3. Add compact insight row styles.
4. Run `pnpm --filter @ai-novel/web test` and `pnpm typecheck`.
5. Commit as `feat(web): show performance health insights`.

## Task 3: E2E And Progress

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `docs/current-progress.md`

**Steps:**

1. Extend smoke e2e to assert `需要关注` appears in the organization overview.
2. Update progress notes.
3. Run `pnpm --filter @ai-novel/web test`, `pnpm typecheck`, `pnpm test:e2e`, and `git diff --check`.
4. Commit as `docs: record performance health insights`.
