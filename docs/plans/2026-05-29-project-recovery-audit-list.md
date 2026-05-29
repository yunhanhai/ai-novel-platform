# Project Recovery Audit List Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show recent queue recovery audit records on the project list page.

**Architecture:** Reuse the existing `audit_logs` table and expose a narrow recovery-action API scoped to the current organization. Render a compact read-only audit list under the queue health panel, matching the existing operational dashboard style.

**Tech Stack:** TypeScript, Next.js App Router, React, Prisma/PostgreSQL, Vitest, Playwright, existing CSS.

---

### Task 1: Recovery Audit API

**Files:**
- Create: `apps/web/src/server/recovery-audit.ts`
- Create: `apps/web/src/server/recovery-audit.test.ts`
- Create: `apps/web/src/app/api/audit-logs/recovery-actions/route.ts`
- Create: `apps/web/src/app/api/audit-logs/recovery-actions/route.test.ts`

**Steps:**
1. Write tests for a helper that returns the latest organization-scoped `generation_job.retry` and `queue.recover_expired_leases` records, sorted newest first, limited to `1..50`.
2. Watch the tests fail because the helper does not exist.
3. Implement the helper with safe metadata shaping and actor display name selection.
4. Add API route tests for default limit, explicit limit, missing org, and structured errors.
5. Implement `GET /api/audit-logs/recovery-actions?limit=10`.
6. Run the focused web tests.

### Task 2: Recovery Audit View Model And Component

**Files:**
- Create: `apps/web/src/components/projects/recovery-audit-list.tsx`
- Create: `apps/web/src/components/projects/recovery-audit-list-model.ts`
- Create: `apps/web/src/components/projects/recovery-audit-list-model.test.ts`
- Modify: `apps/web/src/components/projects/queue-observability-panel.tsx`
- Modify: `apps/web/src/app/globals.css`

**Steps:**
1. Write view-model tests for action labels, metadata summaries, actor fallback, empty state, and stable time formatting.
2. Watch the tests fail because the model does not exist.
3. Implement the model helpers.
4. Implement the compact client component with loading, error, empty, refresh, and 10-row list states.
5. Mount the component below the existing queue health layout.
6. Add CSS using stable row layouts, wrapping text, visible focus states, and no decorative cards inside cards.
7. Run focused web tests.

### Task 3: E2E, Docs, And Commit

**Files:**
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `docs/current-progress.md`

**Steps:**
1. Extend smoke e2e to verify the `恢复记录` section is visible after opening `/projects`.
2. Run `pnpm --filter @ai-novel/web test`, `pnpm typecheck`, and `pnpm test:e2e`.
3. Run `git diff --check`.
4. Update progress notes.
5. Commit with `feat(web): show recovery audit records`.
