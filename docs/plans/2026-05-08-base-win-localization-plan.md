# Base Win Localization Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Keep this document updated at the end of each work session.

**Goal:** Make `D:\develop\AI\xiaoshuo\base_win` a runnable Windows-local copy of `D:\develop\AI\xiaoshuo\base`.

**Architecture:** Preserve the source pnpm workspace layout. Run Web, Worker, shared code, and Prisma database tooling from the copied workspace while reusing the existing native Windows PostgreSQL database.

**Tech Stack:** Node.js 22, pnpm 10.10.0, Next.js 16, React 19, TypeScript 6, Prisma 7, PostgreSQL 16.13.

---

## File Structure

- `apps/web/`: Next.js web application.
- `apps/worker/`: PostgreSQL-backed generation worker.
- `packages/db/`: Prisma schema, generated client output path, database helpers.
- `packages/shared/`: shared environment, generation, auth, crypto, and methodology utilities.
- `infra/`: optional Docker/PostgreSQL/Redis support files.
- `docs/`: Windows runtime docs, progress record, and plans.
- `CLAUDE.md`: project-local operating instructions for Claude sessions.
- `.env`: local runtime variables copied from `.env.example`.

## Task 1: Copy Source Project

**Files:**
- Copied from `D:\develop\AI\xiaoshuo\base`
- Excluded: `.git/`, `node_modules/`, `.pnpm-store/`, `.worktrees/`, `.next/`, `dist/`, `build/`, `*.tsbuildinfo`

- [x] Copy source files and project documentation.
- [x] Confirm `base_win` was empty before copying.
- [x] Keep dependency and build outputs excluded.

## Task 2: Configure Windows Runtime

**Files:**
- Create: `.env`
- Create: `CLAUDE.md`
- Modify: `docs/current-progress.md`

- [x] Reuse database `ai_novel_platform`.
- [x] Set `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"`.
- [x] Set `QUEUE_DRIVER="postgres"`.
- [x] Record Docker and Redis as optional, currently not installed in PATH.

## Task 3: Verify Local Tooling

**Commands:**

```bash
node --version
pnpm --version
npm --version
git --version
```

**Expected:**
- Node.js 22+
- pnpm 10.10.0
- npm available
- Git available

- [x] Node.js verified: `v22.15.0`.
- [x] pnpm verified: `10.10.0`.
- [x] npm verified: `10.9.2`.
- [x] Git verified: `2.45.1.windows.1`.

## Task 4: Verify PostgreSQL

**Commands:**

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' --version
$env:PGPASSWORD='postgres'
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d ai_novel_platform -c 'select version();'
```

**Expected:** PostgreSQL 16.13 and successful database connection.

- [x] PostgreSQL binary exists.
- [x] PostgreSQL version verified: `16.13`.
- [x] Database connection verified.
- [x] Current database has 27 public tables.
- [x] Current Prisma migrations: `202604290001_initial_core`, `20260501001_add_writing_assets`, `20260501002_add_deslop_style_method`.

## Task 5: Verify Project Commands

**Commands:**

```bash
pnpm install
pnpm db:validate
pnpm db:generate
pnpm test
pnpm typecheck
pnpm dev:web
```

- [x] Install dependencies in `base_win`.
- [x] Validate Prisma schema in `base_win`.
- [x] Generate Prisma client in `base_win`.
- [x] Run tests in `base_win`: 37 test files, 225 tests passed.
- [x] Run typecheck in `base_win`.
- [x] Start the Web app and verify HTTP 200 with `AI Novel Platform` in the page.

## Task 6: Session Closeout

- [x] Create project-local Claude instructions.
- [x] Create this plan file.
- [x] Update `docs/current-progress.md` with current Windows runtime facts.
- [x] After command verification, append new evidence to `docs/current-progress.md`.
- [x] Record the next recommended task before ending each session.

## Task 7: 2026-05-30 Budget Governance Closeout

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/202605300001_add_budget_governance/migration.sql`
- Create: `apps/web/src/server/budgets.ts`
- Create: `apps/web/src/server/budgets.test.ts`
- Create: `apps/web/src/app/api/settings/budget/route.ts`
- Create: `apps/web/src/app/api/settings/budget/route.test.ts`
- Create: `apps/web/src/app/api/usage/budget-summary/route.ts`
- Create: `apps/web/src/app/api/usage/budget-summary/route.test.ts`
- Create: `apps/web/src/app/api/budget-notifications/route.ts`
- Create: `apps/web/src/app/api/budget-notifications/route.test.ts`
- Create: `apps/web/src/app/(app)/settings/budget/page.tsx`
- Create: `apps/web/src/components/settings/budget-governance-panel.tsx`
- Modify: `apps/web/src/app/globals.css`
- Modify: `docs/current-progress.md`

**Commands:**

```bash
pnpm --filter @ai-novel/db db:generate
pnpm --filter @ai-novel/web test -- src/server/budgets.test.ts src/app/api/settings/budget/route.test.ts src/app/api/budget-notifications/route.test.ts src/app/api/usage/budget-summary/route.test.ts
pnpm --filter @ai-novel/db db:validate
pnpm --filter @ai-novel/web typecheck
```

- [x] Add persistent budget policy and notification schema/migration.
- [x] Add budget cycle, monthly quota, usage aggregation, and notification services.
- [x] Add budget settings, usage summary, and notification APIs.
- [x] Add budget governance settings page and panel.
- [x] Append budget CSS after the existing settings page styles.
- [x] Add focused unit tests for budget service and API routes.
- [x] Record budget governance progress and verification evidence in `docs/current-progress.md`.
- [x] Re-run budget-focused tests, Prisma validation/generation, and web typecheck before committing.

## Task 8: 2026-05-30 Git Diff Review Fixes

**Files:**
- Modify: `.gitignore`
- Modify: `apps/web/src/server/chapters.ts`
- Modify: `apps/web/src/server/chapters.test.ts`
- Create: `apps/web/src/app/api/chapters/[chapterId]/apply-deslop/route.ts`
- Create: `apps/web/src/app/api/chapters/[chapterId]/apply-deslop/route.test.ts`
- Modify: `apps/web/src/components/workspace/deslop-panel.tsx`
- Modify: `apps/web/src/server/writing-assets.ts`
- Modify: `apps/web/src/server/writing-assets.test.ts`
- Modify: `apps/web/e2e/smoke.spec.ts`
- Modify: `docs/current-progress.md`

**Commands:**

```bash
pnpm --filter @ai-novel/web test -- src/server/chapters.test.ts src/app/api/chapters/[chapterId]/apply-deslop/route.test.ts src/server/writing-assets.test.ts
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

- [x] Add stale-content guard for DESLOP apply using `baseContentHash`.
- [x] Clear stale DESLOP scan results after an apply succeeds.
- [x] Use unique issue keys for DESLOP apply loading state.
- [x] Truncate DESLOP version titles to fit the database column limit.
- [x] Preserve `confidence: 0` when creating project memories.
- [x] Ignore `.claude/worktrees/` residual agent worktrees.
- [x] Restore `apps/web/next-env.d.ts` generated route reference to the prior dev form.
- [x] Update smoke e2e comments to match Playwright `globalSetup` worker startup.
- [x] Run focused tests, typecheck, full tests, build, diff check, and IDE lints.

## Task 9: 2026-06-07 Current Status Audit

**Files:**
- Read: `docs/current-progress.md`
- Read: `apps/web/src/components/workspace/*`
- Read: `apps/web/src/app/api/*`
- Read: `apps/worker/src/*`
- Modify: `docs/current-progress.md`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Confirmed the writing workspace UI exists with editor, chapter list, AI assistant, context composer, diagnostics, DESLOP, memory extraction, versions, outline, character, world, plot thread, memory, style, and methodology panels.
- [x] Confirmed AI-assisted project setup and asset drafting APIs/components exist.
- [x] Confirmed `pnpm typecheck` passed across 5 workspace projects.
- [x] Recorded that `pnpm test:e2e` was blocked because PostgreSQL was not listening on `127.0.0.1:5432`.
- [x] Recorded that `pnpm test` was blocked by sandbox `spawn EPERM`, and unsandboxed rerun was rejected by the local approval reviewer/proxy.
- [x] Recorded that real LLM end-to-end verification remains outstanding.

## Task 10: 2026-10-20 P0 Foundation Fixes (migration reconciliation, session auth, job-type alignment)

**Files:**
- Read: `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/*`, `packages/db/src/generation-jobs.ts`, `apps/web/src/server/context.ts`, `apps/web/src/server/auth.ts`, `apps/web/src/server/users.ts`, `apps/worker/src/index.ts`, `apps/worker/src/handlers.ts`, all `apps/web/src/app/api/**/route.ts`
- Modify: `packages/db/prisma/migrations/202605210001_add_generation_diagnostics/migration.sql` (new), `packages/db/prisma/migrations/202605280001_add_worker_heartbeats/migration.sql` (new), `packages/db/prisma/migrations/202605280002_add_generation_job_retry_fields/migration.sql` (new), `packages/db/prisma/migrations/202605300001_add_performance_budgets/migration.sql` (new), `packages/db/prisma/migrations/202606010001_add_budget_governance/` (renamed from 202605300001), `packages/db/prisma/schema.prisma`, `packages/db/src/generation-jobs.ts`, `apps/web/src/server/context.ts`, `apps/web/src/server/users.ts`, `apps/web/src/server/api-errors.ts` (new), `apps/web/src/app/api/auth/me/route.ts` (new), `apps/web/src/app/api/settings/runtime/route.ts`, `apps/web/src/app/api/generation-jobs/route.ts`, all `apps/web/src/app/api/**/route.ts` (await + 401 mapping), `apps/worker/src/index.ts`, `.env.example`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm --filter @ai-novel/db exec prisma migrate status
pnpm --filter @ai-novel/db exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

- [x] Rebuilt 4 missing migration SQL files from the live database so `prisma migrate dev` no longer demands a reset; checksums in `_prisma_migrations` updated to real SHA-256 of repo files.
- [x] Renamed `202605300001_add_budget_governance` to `202606010001` (timestamp collision with applied `add_performance_budgets`); normalized its SQL to Prisma-canonical FK/defaults; tables recreated empty-first.
- [x] Adopted `generation_jobs.attempt_count/max_attempts/next_run_at`, `worker_heartbeats`, `performance_budgets` + `performance_budget_scope` into `schema.prisma` so future migrate/push cannot silently drop them (reserved for queue robustness).
- [x] Verified zero drift: `prisma migrate status` = up to date; `migrate diff` = empty migration; 44 projects / 168 jobs intact; budget tables created.
- [x] Rewrote `server/context.ts` as session-first (async `getOrganizationId/getUserId/safeGet*` reading the session cookie, no env fallback; `getSessionContext/requireSession/UnauthorizedError/isUnauthorizedError` exported).
- [x] Converted all ~93 API route call sites to `await`; every route catch maps `UnauthorizedError` to 401.
- [x] Added `GET /api/auth/me` (previously an empty directory).
- [x] `createUser` now clones the default organization's active `ModelProvider` + org-level `ModelProfile` rows into each newly registered organization (starter assets; settings e2e depends on it).
- [x] `claimNextJob` organizationId made optional; worker now claims jobs across all organizations (multi-tenant correct; model resolution stays per-job-org).
- [x] Split API job-type whitelist into `SUPPORTED_JOB_TYPES` (7, handler-backed) vs `PENDING_JOB_TYPES` (5, explicit 400 "尚未开放") — no more enqueue-then-NO_HANDLER failures.
- [x] Full verification: `pnpm typecheck` 5/5, `pnpm test` 569 tests / 93 files green, `pnpm test:e2e` 2 passed (30.5s), `prisma migrate diff` empty.
- [x] Recorded remaining tail items (5xx message hardening, proxy.ts defense-in-depth layer, REWRITE/POLISH/CONTINUE_CHAPTER handlers, real LLM e2e, queue retry wiring, legacy `performance_budgets` table removal pending confirmation).

## Task 11: 2026-10-21 UI Quality Pass + Code Review

**Files:**
- Modify: `apps/web/src/app/globals.css`, `apps/web/src/app/(app)/layout.tsx`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Extended design tokens: 8 semantic status colors, 3-level shadows, focus ring, z-index scale, transition token; muted contrast 4.6→5.9:1; explicit Chinese font stack.
- [x] Defined `--foreground`/`--muted-foreground` aliases to fix the wizard/settings indigo drift (fallback `var(--accent, #4f46e5)` was live).
- [x] Global `:focus-visible` ring + unified 160ms transitions + `prefers-reduced-motion` exemption.
- [x] Sticky top-bar with shadow; brand-mark gradient; button hover semantics fixed (darken instead of lighten) with shadow/press feedback; ghost button touch target 28→32px.
- [x] Editor typography: 46em measure, line-height 1.9, larger padding (core writing surface).
- [x] Chapter active state via inset left bar (removes 1px layout jump on toggle); project/settings cards hover lift without layout shift.
- [x] Fixed `var(--foreground)` undefined-variable bug in auth-form inputs; auth card shadow.
- [x] Tokenized 61 scattered status colors (visual no-op governance); settings-form indigo background → accent tint; badge → info tokens.
- [x] Running-state pulse animation (pipeline dot + running tag), transform/opacity only.
- [x] Code review: (app) layout now redirects to /login when session expired (page-level 401 boundary); dead branch cleanup.
- [x] Review verified: all 27 "catch=2 guard=1" routes are helper-pattern (guard inside shared errorResponse) — full 401 coverage; no dangerouslySetInnerHTML / bare target=_blank; job polling has unmount cleanup; e2e hook classes 15/15 intact; CSS braces balanced.
- [x] Full verification: typecheck 5/5, 569 tests green, e2e 2 passed (53.8s).

## Task 12: 2026-10-21 5xx Leak Fix, Proxy Gateway, Layout Polish

**Files:**
- Create: `apps/web/src/server/session-token.ts`, `apps/web/src/proxy.ts`, `apps/web/src/server/api-errors.test.ts`
- Modify: `apps/web/src/server/auth.ts`, `apps/web/src/server/api-errors.ts`, 34 API route files, `apps/web/src/components/workspace/use-workspace-data.ts`, `apps/web/src/app/globals.css`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Added `sanitizeServerMessage` (CJK heuristic): Chinese operational messages stay visible; pure-ASCII infrastructure details become a generic message with `console.error` server logs.
- [x] Applied 500-exit-only sanitization across 34 CRUD routes; status classification (404/409/400 via P2025/P2002/CHAPTER_CONTENT_STALE/not-found signals) keeps the raw message. First blanket attempt broke 8 tests and was redone correctly.
- [x] Kept raw messages where the error is the product (asset-drafts, wizard drafts, provider connection test, auth flows).
- [x] Extracted pure Web Crypto session token module; auth.ts re-exports; proxy.ts gates `/api/**` (except `/api/auth/**`) with 401 — verified live: no-cookie requests get 401, no header injection.
- [x] Layout polish: auth page radial-gradient backdrop, sticky settings-nav, wizard content shadow, top-bar wrap.
- [x] Data race guard for chapter list reloads (sequence ref).
- [x] Verification: typecheck 5/5, 573 tests green, e2e 2 passed (28.6s), live proxy 401 check.

## Task 13: 2026-10-21 Queue Robustness (Self-directed)

**Files:**
- Modify: `packages/db/src/generation-jobs.ts`, `packages/db/src/index.ts`, `apps/worker/src/poll.ts`, `apps/worker/src/index.ts`, four pipeline handlers + their tests

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] claimNextJob now reclaims orphaned RUNNING jobs whose lease expired (a worker killed mid-run no longer strands jobs forever) and honors nextRunAt backoff gating; every claim increments attemptCount.
- [x] poll.ts retry branch: unexpected handler exceptions requeue with exponential backoff (15s × 2^n, capped 10min) while attempts remain (default maxAttempts 3); exhausted attempts mark FAILED with a retry-count suffix; NO_HANDLER stays FAILED without retrying.
- [x] Handler error contract unified: deterministic failures (CHAPTER_NOT_FOUND / NO_MODEL_PROFILE / empty output) still finalize FAILED inside the handler; unexpected exceptions (LLM network blips, finalize transaction conflicts) now rethrow so the poller owns the retry decision — previously the most retryable failures were swallowed as terminal FAILED.
- [x] requeueJobForRetry exported from @ai-novel/db; finalize is a single atomic transaction so retries are safe (versionNo recompute is idempotent).
- [x] New tests: claim where-shape lock (zombie branch, backoff filter, attempt increment), requeue field assertions, poller retried/exhausted/NO_HANDLER/legacy-row cases, backoff curve.
- [x] Verification: typecheck 5/5; 578 tests green (16+28+37+121+376); e2e 2 passed (30.2s).
- [x] Noted: worker_heartbeats stays schema-only until a consumer exists.
