# Performance Trends Observability Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build project-scoped generation performance trends in the workspace while sharing a backend aggregation path with future organization-wide trends.

**Architecture:** Add one scope-aware server aggregation helper over `usage_events`, expose it through project and organization API routes, then render the project route in a compact workspace `性能` tab. The helper returns normalized totals, daily buckets, percentiles, and distributions so the UI stays thin and future organization UI can reuse the same DTO.

**Tech Stack:** Next.js app routes, React client components, Prisma, Vitest, Playwright, existing CSS modules in `apps/web/src/app/globals.css`. UI implementation must apply `@ui-ux-pro-max` guidance for accessible, dense, stable dashboard layouts.

---

## Preflight: Preserve Current Work Boundary

**Files:**
- Current uncommitted fingerprint batch from the previous feature.
- New design doc: `docs/plans/2026-05-25-performance-trends-design.md`

**Step 1: Check status**

Run:

```bash
git status --short
```

Expected: the existing context fingerprint files plus the new design doc are listed.

**Step 2: Commit the existing fingerprint batch first**

Because the fingerprint batch is already verified, commit it before implementing trends:

```bash
git add apps/worker/src/context/build-context-packet.ts apps/worker/src/context/build-context-packet.test.ts apps/worker/src/pipeline/chapter-pipeline.ts apps/worker/src/pipeline/chapter-pipeline.test.ts apps/worker/src/pipeline/generate-chapter-handler.ts apps/worker/src/pipeline/generate-chapter-handler.test.ts packages/shared/src/generation/performance.ts packages/shared/src/generation/performance.test.ts docs/current-progress.md
git commit -m "feat(worker): add generation context fingerprints"
```

Expected: commit succeeds.

**Step 3: Commit the design and implementation plan**

```bash
git add docs/plans/2026-05-25-performance-trends-design.md docs/plans/2026-05-25-performance-trends-implementation-plan.md
git commit -m "docs: plan performance trends observability"
```

Expected: commit succeeds.

If Codex cannot write Git metadata in this Windows worktree, the user should run these commands manually from:

```powershell
Set-Location d:\develop\AI\xiaoshuo\base_win\.worktrees\generation-performance-architecture
```

---

## Task 1: Server Aggregation Helper

**Files:**
- Create: `apps/web/src/server/performance-trends.ts`
- Create: `apps/web/src/server/performance-trends.test.ts`

**Step 1: Write failing helper tests**

Cover:

- empty result returns zero totals and daily buckets;
- project scope passes `organizationId` and `projectId` to Prisma;
- organization scope omits `projectId`;
- `7d` and `30d` windows create the expected bucket count;
- p50 and p95 ignore null latency;
- model, provider, billing source, and job type distributions aggregate correctly;
- cost is `null` when every event has `estimatedCostCents: null`.

Test shape:

```ts
import { describe, expect, it, vi } from "vitest";
import { getPerformanceTrends } from "./performance-trends";

function mockPrisma(events: unknown[]) {
  return {
    usageEvent: {
      findMany: vi.fn().mockResolvedValue(events)
    }
  } as never;
}

it("returns zero totals with filled daily buckets for empty project data", async () => {
  const prisma = mockPrisma([]);
  const result = await getPerformanceTrends({
    prisma,
    organizationId: "org-1",
    projectId: "proj-1",
    window: "7d",
    now: new Date("2026-05-25T12:00:00.000Z")
  });

  expect(result.scope).toBe("project");
  expect(result.daily).toHaveLength(7);
  expect(result.totals.calls).toBe(0);
  expect(result.totals.p95LatencyMs).toBeNull();
});
```

**Step 2: Run helper tests and verify failure**

Run:

```bash
pnpm --filter @ai-novel/web test -- performance-trends.test.ts
```

Expected: FAIL because `performance-trends.ts` does not exist.

**Step 3: Implement minimal helper**

Implement exports:

```ts
export type PerformanceTrendWindow = "7d" | "30d";

export interface PerformanceTrends { /* DTO from design doc */ }

export function normalizePerformanceTrendWindow(value: unknown): PerformanceTrendWindow | null {
  return value === "7d" || value === "30d" ? value : null;
}

export async function getPerformanceTrends(params: {
  prisma: PrismaClient;
  organizationId: string;
  projectId?: string;
  window: PerformanceTrendWindow;
  now?: Date;
}): Promise<PerformanceTrends> {
  const days = params.window === "7d" ? 7 : 30;
  const end = startOfUtcDay(params.now ?? new Date());
  const start = addUtcDays(end, -(days - 1));
  const events = await params.prisma.usageEvent.findMany({
    where: {
      organizationId: params.organizationId,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      createdAt: { gte: start }
    },
    select: {
      modelName: true,
      billingSource: true,
      inputTokens: true,
      outputTokens: true,
      estimatedCostCents: true,
      latencyMs: true,
      createdAt: true,
      providerId: true,
      provider: { select: { name: true } },
      generationJob: { select: { jobType: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  return aggregateEvents({ events, days, start, scope: params.projectId ? "project" : "organization", window: params.window });
}
```

Use small pure helpers for `startOfUtcDay`, `addUtcDays`, `percentileNearestRank`, `average`, and map aggregation. Keep all date bucket keys as `YYYY-MM-DD`.

**Step 4: Run helper tests**

Run:

```bash
pnpm --filter @ai-novel/web test -- performance-trends.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/server/performance-trends.ts apps/web/src/server/performance-trends.test.ts
git commit -m "feat(web): aggregate generation performance trends"
```

---

## Task 2: Performance Trends API Routes

**Files:**
- Create: `apps/web/src/app/api/projects/[projectId]/performance-trends/route.ts`
- Create: `apps/web/src/app/api/projects/[projectId]/performance-trends/route.test.ts`
- Create: `apps/web/src/app/api/performance-trends/route.ts`
- Create: `apps/web/src/app/api/performance-trends/route.test.ts`

**Step 1: Write failing project route tests**

Mock:

- `@ai-novel/db` with `prisma.project.findFirst`;
- `server/context` with `getOrganizationId`;
- `server/performance-trends` with `getPerformanceTrends` and real `normalizePerformanceTrendWindow` if convenient.

Cases:

- returns `200` for an existing project;
- returns `400` for `window=90d`;
- returns `404` when project is missing or cross-organization;
- calls helper with `{ organizationId, projectId, window }`.

**Step 2: Write failing organization route tests**

Cases:

- returns `200` for current organization;
- defaults to `30d` when no query is provided;
- returns `400` for invalid window;
- calls helper without `projectId`.

**Step 3: Run route tests and verify failure**

Run:

```bash
pnpm --filter @ai-novel/web test -- performance-trends
```

Expected: FAIL because routes do not exist.

**Step 4: Implement project route**

Route outline:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { getOrganizationId } from "../../../../../server/context";
import { getPerformanceTrends, normalizePerformanceTrendWindow } from "../../../../../server/performance-trends";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const url = new URL(request.url);
  const window = normalizePerformanceTrendWindow(url.searchParams.get("window") ?? "30d");
  if (!window) {
    return NextResponse.json({ success: false, error: "window must be 7d or 30d" }, { status: 400 });
  }

  try {
    const organizationId = getOrganizationId();
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const data = await getPerformanceTrends({ prisma, organizationId, projectId, window });
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "服务异常" }, { status: 500 });
  }
}
```

**Step 5: Implement organization route**

Same pattern, but no project lookup and no `projectId` in helper params.

**Step 6: Run route tests**

Run:

```bash
pnpm --filter @ai-novel/web test -- performance-trends
```

Expected: PASS.

**Step 7: Commit**

```bash
git add apps/web/src/app/api/projects/[projectId]/performance-trends apps/web/src/app/api/performance-trends
git commit -m "feat(web): expose performance trends APIs"
```

---

## Task 3: Workspace Performance Fetch Hook And Types

**Files:**
- Modify: `apps/web/src/components/workspace/use-workspace-data.ts`
- Create: `apps/web/src/components/workspace/performance-trends-format.ts`
- Create: `apps/web/src/components/workspace/performance-trends-format.test.ts`

**Step 1: Add formatting tests first**

Because this repo does not currently use React Testing Library, keep component logic simple and test pure formatting helpers:

```ts
import { describe, expect, it } from "vitest";
import { formatLatency, formatTokens } from "./performance-trends-format";

it("formats large token counts compactly", () => {
  expect(formatTokens(1234)).toBe("1.2k");
});

it("formats missing latency as dash", () => {
  expect(formatLatency(null)).toBe("-");
});
```

**Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @ai-novel/web test -- performance-trends-format.test.ts
```

Expected: FAIL because helper does not exist.

**Step 3: Add shared client DTO and hook**

In `use-workspace-data.ts`, export:

```ts
export type PerformanceTrendWindow = "7d" | "30d";

export interface PerformanceTrends { /* same DTO shape as server */ }

export function usePerformanceTrends(projectId: string | null, window: PerformanceTrendWindow) {
  // useEffect fetches `/api/projects/${projectId}/performance-trends?window=${window}`
  // returns { trends, isLoading, error, reload }
}
```

Use existing `ApiEnvelope<T>` pattern. Abort or ignore stale requests when `projectId` changes. Do not fetch when `projectId` is null.

**Step 4: Add formatting helper**

Create:

```ts
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatLatency(value: number | null): string {
  return value === null ? "-" : `${Math.round(value)}ms`;
}
```

**Step 5: Run focused tests**

Run:

```bash
pnpm --filter @ai-novel/web test -- performance-trends-format.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/components/workspace/use-workspace-data.ts apps/web/src/components/workspace/performance-trends-format.ts apps/web/src/components/workspace/performance-trends-format.test.ts
git commit -m "feat(web): add workspace performance trend client data"
```

---

## Task 4: Workspace Performance Panel UI

**Files:**
- Create: `apps/web/src/components/workspace/performance-panel.tsx`
- Modify: `apps/web/src/components/workspace/workspace-side-tabs.tsx`
- Modify: `apps/web/src/app/globals.css`

**Step 1: Implement the panel using `@ui-ux-pro-max` constraints**

Use:

- a segmented control with two buttons: `7 天` and `30 天`;
- fixed metric grid cells to avoid async layout jumps;
- keyboard-visible focus styles through existing button behavior and CSS;
- concise Chinese labels;
- lists that remain readable without relying on chart colors.

Component outline:

```tsx
"use client";

import { useState } from "react";
import { usePerformanceTrends, type PerformanceTrendWindow } from "./use-workspace-data";
import { formatLatency, formatTokens } from "./performance-trends-format";

export function PerformancePanel({ projectId }: { projectId: string | null }) {
  const [window, setWindow] = useState<PerformanceTrendWindow>("30d");
  const { trends, isLoading, error, reload } = usePerformanceTrends(projectId, window);

  return (
    <section className="performance-panel" aria-label="性能趋势">
      <div className="performance-panel-header">
        <h2>性能趋势</h2>
        <div className="performance-window-control" role="radiogroup" aria-label="时间范围">
          {(["7d", "30d"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={window === value}
              className={`performance-window-option ${window === value ? "active" : ""}`}
              onClick={() => setWindow(value)}
            >
              {value === "7d" ? "7 天" : "30 天"}
            </button>
          ))}
        </div>
      </div>

      {/* loading, error, empty, metric grid, trend rows, distributions */}
    </section>
  );
}
```

**Step 2: Add the side tab**

In `workspace-side-tabs.tsx`:

- import `PerformancePanel`;
- extend `TabKey` with `"performance"`;
- add `{ key: "performance", label: "性能" }`;
- render `<PerformancePanel projectId={projectId} />`.

**Step 3: Add CSS**

Add stable, compact classes:

- `.performance-panel`
- `.performance-panel-header`
- `.performance-window-control`
- `.performance-window-option`
- `.performance-metric-grid`
- `.performance-metric`
- `.performance-trend-list`
- `.performance-trend-row`
- `.performance-bar-track`
- `.performance-bar-fill`
- `.performance-breakdown-list`
- `.performance-empty`

Keep cards at existing small radius, no decorative gradient/orb background, and ensure text wraps inside fixed containers.

**Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/workspace/performance-panel.tsx apps/web/src/components/workspace/workspace-side-tabs.tsx apps/web/src/app/globals.css
git commit -m "feat(web): add workspace performance trends panel"
```

---

## Task 5: E2E Smoke And Progress Notes

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `docs/current-progress.md`

**Step 1: Extend e2e smoke**

After generation/diagnostics complete:

```ts
await page.getByRole("tab", { name: "性能" }).click();
await expect(page.getByRole("heading", { name: "性能趋势" })).toBeVisible();
await expect(page.locator(".performance-metric-grid")).toBeVisible();
```

Do not require non-zero usage in e2e; fake-model data can be sparse depending on worker mode. The assertion should verify that the panel loads and presents either metrics or an empty state.

**Step 2: Update progress notes**

Append a concise note to `docs/current-progress.md`:

- project performance trends API;
- organization trends API backend support;
- workspace `性能` tab;
- UI/UX constraints applied;
- limitations around fake-model usage data and cost estimates.

**Step 3: Run focused web tests**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: PASS.

**Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

**Step 5: Run e2e if local DB and worker are available**

Run:

```bash
pnpm test:e2e
```

Expected: PASS.

If local PostgreSQL or worker is not running, record the blocker instead of weakening the test.

**Step 6: Whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS, allowing only existing CRLF warnings from Git if they appear outside diff-check errors.

**Step 7: Commit**

```bash
git add apps/web/e2e/smoke.spec.ts docs/current-progress.md
git commit -m "docs: record performance trends observability"
```

---

## Final Verification

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm typecheck
pnpm test:e2e
git diff --check
git status --short
```

Expected:

- web tests pass;
- all workspaces typecheck;
- e2e passes when PostgreSQL and worker are available;
- no whitespace errors;
- working tree is clean after commits.

## Notes

- Keep organization-level UI out of this batch; the route and helper support it for the next phase.
- Do not add a charting dependency unless the compact CSS bars prove insufficient.
- Do not alter worker usage recording in this batch unless tests expose a real data-shape mismatch.
- Preserve existing Chinese UI language and workspace density.
