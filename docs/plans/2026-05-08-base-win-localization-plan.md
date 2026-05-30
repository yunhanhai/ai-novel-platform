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
