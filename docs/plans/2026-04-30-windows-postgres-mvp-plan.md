# Windows PostgreSQL MVP Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Continue the AI novel SaaS MVP from the current Windows machine state, using native PostgreSQL and PostgreSQL-backed jobs as the local development baseline.

**Architecture:** The project is a TypeScript monorepo. PostgreSQL is the system of record for SaaS data and MVP generation jobs. Redis, BullMQ, Docker, and cloud object storage are optional later scaling layers, not local MVP prerequisites.

**Tech Stack:** Windows, Node.js 22+, pnpm 10, PostgreSQL 16.13 at `D:\myTool\develop\PostgreSQL`, Prisma 7, TypeScript, Vitest, Next.js planned for `apps/web`, PostgreSQL-backed worker polling planned for `apps/worker`.

---

## Current Baseline

This plan supersedes the execution order in `docs/plans/2026-04-29-ai-novel-platform-implementation-plan.md` for local MVP work. The older plan remains useful as the broad product roadmap.

Already completed:

- `packages/db` exists with Prisma 7 schema, client setup, tenant helpers, and tests.
- `packages/shared` exists with generation job state machine and tests.
- Native PostgreSQL 16.13 is installed at `D:\myTool\develop\PostgreSQL`.
- Data directory is `D:\myTool\develop\PostgreSQL\data`.
- Local database `ai_novel_platform` exists.
- Prisma migration `202604290001_initial_core` has been applied.
- MVP queue mode is `QUEUE_DRIVER=postgres`.

Known local runtime constraint:

- PostgreSQL is not registered as a Windows service. After reboot, start it manually with the command in `docs/windows-postgresql-runtime.md`.
- `D:\myTool\develop\PostgreSQL\downloads\pgpass.txt` still exists and should be deleted after explicit user confirmation.

## Verification Baseline

Before starting any task, run:

```bash
pnpm db:validate
pnpm test
pnpm typecheck
```

Expected:

- Prisma schema is valid.
- 11 tests pass across `packages/db` and `packages/shared`.
- TypeScript typecheck passes.

If PostgreSQL-dependent work is needed, first verify:

```powershell
$env:PGPASSWORD='postgres'
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d ai_novel_platform -c 'select version();'
```

Expected: PostgreSQL 16.13 returns a version row.

## Phase 1: App Shell And Shared Configuration

### Task 1: Add Web App Skeleton

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/globals.css`
- Modify: `package.json`

**Step 1: Write the smoke test**

Create a minimal test that verifies the landing route component can render a product name without a browser.

Expected test intent:

```ts
expect(renderedText).toContain("AI Novel Platform");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: FAIL because `apps/web` does not exist yet.

**Step 3: Add Next.js app skeleton**

Use a minimal App Router skeleton. Do not build the full UI yet.

**Step 4: Add root scripts**

Add:

```json
{
  "dev:web": "pnpm --filter @ai-novel/web dev",
  "build": "pnpm -r build"
}
```

**Step 5: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm --filter @ai-novel/web typecheck
pnpm test
pnpm typecheck
```

Expected: pass.

### Task 2: Add Environment Loader

**Files:**
- Create: `packages/shared/src/env.ts`
- Create: `packages/shared/src/env.test.ts`
- Modify: `packages/shared/package.json`
- Modify: `.env.example`

**Step 1: Write failing tests**

Test:

- `DATABASE_URL` is required.
- `QUEUE_DRIVER` accepts `postgres` and `redis`.
- Default queue driver is `postgres`.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/shared test
```

Expected: FAIL because `env.ts` does not exist.

**Step 3: Implement minimal env parser**

Do not introduce a large config framework. A small parser is enough.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/shared test
pnpm --filter @ai-novel/shared typecheck
```

Expected: pass.

## Phase 2: Auth And Organization Foundation

### Task 3: Add Password Utilities

**Files:**
- Create: `packages/shared/src/auth/password.ts`
- Create: `packages/shared/src/auth/password.test.ts`

**Step 1: Write failing tests**

Test:

- Hashing a password does not return the original string.
- A correct password verifies.
- A wrong password fails.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/shared test
```

Expected: FAIL because password utilities do not exist.

**Step 3: Implement with Node crypto**

Use `crypto.scrypt` or `crypto.subtle` through a small wrapper. Store algorithm metadata in the encoded hash string.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/shared test
pnpm --filter @ai-novel/shared typecheck
```

Expected: pass.

### Task 4: Add User And Organization Services

**Files:**
- Create: `apps/web/src/server/users.ts`
- Create: `apps/web/src/server/users.test.ts`
- Create: `apps/web/src/server/organizations.ts`
- Create: `apps/web/src/server/organizations.test.ts`
- Modify: `apps/web/package.json`

**Step 1: Write failing service tests**

Use the local PostgreSQL test database only if test isolation is in place. Otherwise mock the Prisma interface at the service boundary.

Test:

- Create a user with unique email.
- Create default organization for a new user.
- Add owner organization membership.
- Reject duplicate organization slug.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: FAIL because services do not exist.

**Step 3: Implement minimal services**

Use `@ai-novel/db` for Prisma access. Keep route handlers out of this task.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm --filter @ai-novel/web typecheck
```

Expected: pass.

## Phase 3: Project Library And Writing Structure

### Task 5: Add Project Service

**Files:**
- Create: `apps/web/src/server/projects.ts`
- Create: `apps/web/src/server/projects.test.ts`

**Step 1: Write failing tests**

Test:

- Create project in an organization.
- Enforce unique `(organizationId, slug)`.
- List only projects for the current organization.
- Soft delete a project by setting `deletedAt`.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: FAIL because project service does not exist.

**Step 3: Implement minimal service**

Use `tenantWhere()` and `tenantCreateData()` for all tenant-scoped operations.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm --filter @ai-novel/web typecheck
```

Expected: pass.

### Task 6: Add Chapter And Outline Services

**Files:**
- Create: `apps/web/src/server/chapters.ts`
- Create: `apps/web/src/server/chapters.test.ts`
- Create: `apps/web/src/server/outlines.ts`
- Create: `apps/web/src/server/outlines.test.ts`

**Step 1: Write failing tests**

Test:

- Create volume.
- Create chapter with ordered `chapterNo`.
- Update chapter content and `wordCount`.
- Save a `content_versions` snapshot before replacing AI-generated content.
- Query outline tree in `orderIndex` order.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: FAIL because services do not exist.

**Step 3: Implement minimal services**

Keep database writes in transactions when content and version snapshots are created together.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm --filter @ai-novel/web typecheck
```

Expected: pass.

## Phase 4: PostgreSQL-Backed Generation Jobs

### Task 7: Add Generation Job Repository

**Files:**
- Create: `packages/db/src/generation-jobs.ts`
- Create: `packages/db/src/generation-jobs.test.ts`
- Modify: `packages/db/src/index.ts`

**Step 1: Write failing tests**

Test:

- Create queued job.
- Claim oldest queued job for a worker.
- Do not claim jobs from another organization.
- Do not claim a job whose lease has not expired.
- Transition job using `packages/shared/src/generation/state.ts`.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/db test
```

Expected: FAIL because generation job repository does not exist.

**Step 3: Implement PostgreSQL-backed repository**

Use database transactions. For real database tests, use the local PostgreSQL runtime and clean test rows by organization ID.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/db test
pnpm --filter @ai-novel/db typecheck
```

Expected: pass.

### Task 8: Add Worker Skeleton

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/poll.ts`
- Create: `apps/worker/src/poll.test.ts`
- Modify: `package.json`

**Step 1: Write failing tests**

Test:

- Poller requests one job at a time.
- Poller does nothing when no job is available.
- Poller marks a job failed when handler throws.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/worker test
```

Expected: FAIL because worker package does not exist.

**Step 3: Implement minimal worker poller**

Do not call real AI models. Use a fake handler.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/worker test
pnpm --filter @ai-novel/worker typecheck
pnpm test
pnpm typecheck
```

Expected: pass.

## Phase 5: Model Configuration And Fake AI Pipeline

### Task 9: Add Model Provider Service

**Files:**
- Create: `apps/web/src/server/model-providers.ts`
- Create: `apps/web/src/server/model-providers.test.ts`
- Create: `packages/shared/src/crypto/encryption.ts`
- Create: `packages/shared/src/crypto/encryption.test.ts`

**Step 1: Write failing tests**

Test:

- API key is encrypted before storage.
- Raw API key is never returned by service methods.
- Provider belongs to current organization.
- Default provider selection is organization-scoped.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test
```

Expected: FAIL because model provider service does not exist.

**Step 3: Implement minimal provider service**

Use an app-level `ENCRYPTION_KEY` from env. Do not log secrets.

**Step 4: Verify**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: pass.

### Task 10: Add Fake Chapter Generation Pipeline

**Files:**
- Create: `apps/worker/src/pipeline/generate-chapter.ts`
- Create: `apps/worker/src/pipeline/generate-chapter.test.ts`
- Create: `apps/worker/src/pipeline/fake-model.ts`

**Step 1: Write failing tests**

Test:

- Builds generation context from project, chapter outline, and previous chapter summary.
- Calls fake model.
- Persists generated text as a new `content_versions` row.
- Updates `generation_jobs.status` to `succeeded`.
- Records a `generation_steps` row.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/worker test
```

Expected: FAIL because pipeline does not exist.

**Step 3: Implement fake pipeline**

No external model calls in tests. The fake model returns deterministic text.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/worker test
pnpm test
pnpm typecheck
```

Expected: pass.

## Phase 6: First Usable UI

### Task 11: Add Project Library Pages

**Files:**
- Create: `apps/web/src/app/(app)/projects/page.tsx`
- Create: `apps/web/src/app/(app)/projects/new/page.tsx`
- Create: `apps/web/src/app/api/projects/route.ts`
- Create: `apps/web/src/components/projects/project-list.tsx`

**Step 1: Write failing tests**

Test:

- Project list renders projects for current organization.
- New project form validates title and slug.
- API route rejects missing organization context.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: FAIL because pages/routes do not exist.

**Step 3: Implement pages and route**

Use server actions or route handlers consistently. Keep UI quiet and dense, matching a work-focused SaaS.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm --filter @ai-novel/web typecheck
```

Expected: pass.

### Task 12: Add Minimal Writing Workspace

**Files:**
- Create: `apps/web/src/app/(app)/projects/[projectId]/workspace/page.tsx`
- Create: `apps/web/src/components/workspace/asset-sidebar.tsx`
- Create: `apps/web/src/components/workspace/editor-pane.tsx`
- Create: `apps/web/src/components/workspace/ai-panel.tsx`

**Step 1: Write failing tests**

Test:

- Workspace loads project chapters.
- Selecting a chapter shows content.
- AI panel can create a queued fake generation job.

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @ai-novel/web test
```

Expected: FAIL because workspace does not exist.

**Step 3: Implement minimal workspace**

Do not build the full final editor. Use a textarea or basic Markdown editor first.

**Step 4: Verify**

Run:

```bash
pnpm --filter @ai-novel/web test
pnpm --filter @ai-novel/web typecheck
pnpm test
pnpm typecheck
```

Expected: pass.

## Completion Criteria For This Plan

This plan is complete when:

- A user can create or select an organization.
- A user can create a project.
- A user can create chapters and outlines.
- A user can enqueue a fake chapter generation job.
- The worker can claim and complete the fake job through PostgreSQL-backed polling.
- Generated text is saved as a content version.
- All tests and typechecks pass.

## Commands To Run Before Reporting Completion

```bash
pnpm db:validate
pnpm db:generate
pnpm test
pnpm typecheck
```

For database-backed tasks, also run:

```powershell
$env:PGPASSWORD='postgres'
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d ai_novel_platform -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';"
```
