# Organization Performance Overview Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an organization-wide performance overview to the projects page using the existing organization performance trends API.

**Architecture:** Keep the existing API and aggregation helper unchanged. Add a client-side projects overview component that fetches `/api/performance-trends`, reuses the existing trend DTO/formatting, and renders compact dashboard sections above the project list.

**Tech Stack:** Next.js app router, React client component, existing CSS in `apps/web/src/app/globals.css`, Vitest for pure helper tests, Playwright for smoke e2e. UI implementation follows `@ui-ux-pro-max` operational dashboard guidance.

---

## Task 1: Organization Overview View Model

**Files:**
- Create: `apps/web/src/components/projects/organization-performance-overview-model.ts`
- Create: `apps/web/src/components/projects/organization-performance-overview-model.test.ts`

**Step 1: Write failing tests**

Cover:

- `isOrganizationPerformanceEmpty` returns true only when totals calls are zero.
- `getMaxDailyCalls` returns at least 1 to keep bar widths stable.
- `toBreakdownItems` limits to the requested count and formats meta text.

**Step 2: Run focused tests**

Run:

```bash
pnpm --filter @ai-novel/web test -- organization-performance-overview-model.test.ts
```

Expected: FAIL because the model helper does not exist.

**Step 3: Implement helper**

Keep it pure and UI-independent:

```ts
export function isOrganizationPerformanceEmpty(trends: PerformanceTrends | null): boolean {
  return trends !== null && trends.totals.calls === 0;
}

export function getMaxDailyCalls(days: Array<{ calls: number }>): number {
  return Math.max(...days.map((day) => day.calls), 1);
}

export function toBreakdownItems<T>(
  items: T[],
  limit: number,
  mapper: (item: T) => { key: string; label: string; meta: string }
) {
  return items.slice(0, limit).map(mapper);
}
```

**Step 4: Verify tests**

Run:

```bash
pnpm --filter @ai-novel/web test -- organization-performance-overview-model.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/projects/organization-performance-overview-model.ts apps/web/src/components/projects/organization-performance-overview-model.test.ts
git commit -m "feat(web): add organization performance overview model"
```

---

## Task 2: Projects Page Organization Overview UI

**Files:**
- Create: `apps/web/src/components/projects/organization-performance-overview.tsx`
- Modify: `apps/web/src/app/(app)/projects/page.tsx`
- Modify: `apps/web/src/app/globals.css`

**Step 1: Implement client component**

The component:

- defaults to `30d`;
- fetches `/api/performance-trends?window=${window}`;
- shows loading skeleton, error with retry, empty state, metrics, daily trend, and breakdown lists;
- uses Chinese labels and compact dashboard layout.

**Step 2: Add to projects page**

Import and render:

```tsx
<OrganizationPerformanceOverview enabled={Boolean(organizationId)} />
```

Place it after the missing organization warning and before `ProjectList`.

**Step 3: Add CSS**

Add project-level classes:

- `.organization-performance-overview`
- `.organization-performance-header`
- `.organization-performance-layout`
- `.organization-performance-breakdowns`

Reuse existing `.performance-*` classes where possible.

**Step 4: Verify typecheck**

Run:

```bash
pnpm --filter @ai-novel/web typecheck
```

Expected: PASS.

**Step 5: Verify web tests**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/src/components/projects/organization-performance-overview.tsx apps/web/src/app/(app)/projects/page.tsx apps/web/src/app/globals.css
git commit -m "feat(web): show organization performance overview"
```

---

## Task 3: E2E And Progress Notes

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `docs/current-progress.md`

**Step 1: Extend smoke e2e**

After the registration redirect to `/projects`, assert:

```ts
await expect(page.getByRole("heading", { name: "全部项目性能" })).toBeVisible();
await expect(page.locator(".organization-performance-overview")).toBeVisible();
```

Do not require non-zero usage.

**Step 2: Update progress notes**

Append a concise note for organization-level performance overview.

**Step 3: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm typecheck
pnpm test:e2e
git diff --check
```

Expected: all pass. If PostgreSQL is stopped, start it and rerun e2e.

**Step 4: Commit**

```bash
git add apps/web/e2e/smoke.spec.ts docs/current-progress.md
git commit -m "docs: record organization performance overview"
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
- e2e passes with local PostgreSQL running;
- no whitespace errors;
- worktree is clean after commits.
