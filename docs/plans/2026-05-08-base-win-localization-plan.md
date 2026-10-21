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

## Task 14: 2026-10-21 Selection Rewrite/Polish (Core Writing Feature)

**Files:**
- Create: `apps/worker/src/pipeline/rewrite-polish-handler.ts` + test
- Modify: `apps/worker/src/handlers.ts` + test, `apps/web/src/app/api/generation-jobs/route.ts` + test, `apps/web/src/components/workspace/job-request.ts` + test, `use-workspace-data.ts`, `editor-pane.tsx`, `workspace/page.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Shared rewrite/polish handler: mode-dispatched Chinese writing prompts, optional user instruction; SELECTION_MISSING / CHAPTER_NOT_FOUND / SELECTION_STALE are deterministic failures, model errors rethrow into the poller retry path; results return via output.{mode, selectedText, newText} without writing chapter content.
- [x] API: REWRITE/POLISH moved from PENDING to SUPPORTED with a non-empty input.selectedText requirement (400 otherwise); PENDING left with GENERATE_OUTLINE / CONTINUE_CHAPTER / REVIEW.
- [x] EditorPane: fully controlled selection reporting, selection toolbar (N chars selected + rewrite/polish/cancel), collapses the native selection when cleared externally.
- [x] Workspace page: submits the job with the selection anchor, shows a before/after diff card on SUCCEEDED, applies only when content.slice(start,end) still equals selectedText (double guard with the handler-side SELECTION_STALE); apply rides the existing auto-save path.
- [x] job-request: selectedText/instruction attached only for REWRITE/POLISH, instruction trimmed.
- [x] Verified: typecheck 5/5; 591 tests green (16+28+37+129+381); e2e 2 passed (30.4s) including a new smoke step: select-all → polish → SUCCEEDED → diff card → apply → content contains the fake model output.

## Task 15: 2026-10-21 CONTINUE_CHAPTER (Continue Writing)

**Files:**
- Create: `apps/worker/src/pipeline/continue-chapter-handler.ts` + test
- Modify: `apps/worker/src/handlers.ts` + test, `apps/web/src/app/api/generation-jobs/route.ts`, `ai-panel.tsx`, `workspace-side-tabs.tsx`, `workspace/page.tsx`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] New single-call continue handler: feeds only the chapter tail (1500 chars) into the prompt, enforces continuity of voice/person and forbids repetition, supports a clamped targetLength (600 default, 3000 max), strips code fences, and finalizes through the shared commitFinalize transaction (chapter + contentVersion + step + job + usageEvent) so continuations join the same version chain as full generations.
- [x] Continuation is written directly (like GENERATE_CHAPTER), unlike the advisory rewrite/polish flow.
- [x] API: CONTINUE_CHAPTER moved into SUPPORTED; PENDING now only GENERATE_OUTLINE / REVIEW.
- [x] UI: AI panel gains a 「继续写」 button with submitting/continuing states; content reloads on SUCCEEDED.
- [x] Verified: typecheck 5/5; 599 tests green (16+28+37+137+381); e2e 2 passed (41.2s) with a new smoke assertion that the chapter grows after continuing.
- [x] Noted: real-LLM acceptance remains blocked on missing credentials (no API key / ENCRYPTION_KEY; all DB provider keys are NULL).

## Task 16: 2026-10-21 REVIEW with Citation Verification

**Files:**
- Create: `apps/worker/src/pipeline/review-handler.ts` + test, `apps/web/src/components/workspace/review-panel.tsx`
- Modify: `apps/worker/src/handlers.ts` + test, `apps/web/src/app/api/generation-jobs/route.ts` + test, `workspace-side-tabs.tsx`, `workspace/page.tsx`, `use-workspace-data.ts`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] New review handler returning structured JSON (summary / passed / suggestions with quote + problem + suggestion + replacement).
- [x] Citation verification (`verifySuggestions`, exported): every quote must exist verbatim in the chapter; unverified entries stay visible but cannot be applied — guards against the model inventing evidence.
- [x] Robust parsing: code fences, JSON extraction from prose, invalid enum fallback, entries missing a quote dropped, `degraded` only when parsing truly failed.
- [x] Review panel tab: summary, pass/needs-work badge, verified/unverified counts, per-item severity color bar, quote block, replacement preview, single-item apply.
- [x] Apply re-checks `indexOf` against live content (guards against edits made after the review ran), then rides the existing auto-save path; applied items are marked and disabled.
- [x] Verified: typecheck 5/5; 607 tests green (16+28+37+144+382); e2e 2 passed (30.3s) with a new smoke step that opens the review tab and waits for the result panel (fake model returns prose → exercises the degraded branch).
- [x] Remaining PENDING job type: GENERATE_OUTLINE only.

## Task 17: 2026-10-21 GENERATE_OUTLINE (PENDING cleared)

**Files:**
- Create: `apps/worker/src/pipeline/generate-outline-handler.ts` + test
- Modify: `apps/worker/src/handlers.ts` + test, `apps/web/src/app/api/generation-jobs/route.ts` + test, `job-request.ts`, `use-workspace-data.ts`, `outline-panel.tsx`, `workspace-side-tabs.tsx`, `workspace/page.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] New project-level outline handler: reads premise/genre/styleBrief plus existing chapter outlines, character names and world items; asks for per-chapter titles + 80-150 char summaries that continue the existing outline without contradicting it.
- [x] chapterCount defaults to 5 and caps at 20; over-long model responses are truncated. Outlines are written in one transaction with orderIndex continuing from the current max, parentId attached to the first VOLUME, and metadata {source, jobId} for traceability.
- [x] Frontend: outline tab gains an AI batch section (3/5/8/10 chapters), disables while running, reloads on success, surfaces the failure reason.
- [x] job-request/startJob extended with a project-level path (null chapterId + projectId), needed because this job has no chapter.
- [x] PENDING_JOB_TYPES and its 400 branch removed entirely — all 12 job types are now handler-backed.
- [x] Real defect caught by e2e (unit tests passed): Project has no `storyLine` field, so the Prisma query failed at runtime; switched to the real `genre` column. Recorded as a concrete example of the mock-testing blind spot. Also confirmed the retry mechanism engages on such failures (HANDLER_RETRY recorded).
- [x] Verified: typecheck 5/5; 616 tests green (16+28+37+152+383); e2e 2 passed (32.8s).

## Task 18: 2026-10-21 Worker Heartbeat, Health Visibility, Poller Resilience

**Files:**
- Create: `apps/worker/src/heartbeat.ts` + test, `apps/web/src/app/api/worker/health/route.ts` + test, `apps/web/src/components/settings/worker-status-card.tsx`
- Modify: `apps/worker/src/index.ts`, `apps/worker/src/poll.ts`, `apps/web/src/app/(app)/settings/models/page.tsx`, `ai-panel.tsx`, `globals.css`, `e2e/settings.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Worker heartbeat: upsert on start, update lastSeenAt/lastTickStatus/lastTickAt every tick, delete own row on graceful shutdown; degrades to a no-op with a warning when DEFAULT_ORGANIZATION_ID is missing or not a UUID; purges heartbeats older than 1 hour at startup.
- [x] Poller resilience fix: a throwing `await tick()` used to kill the whole worker process (a brief DB outage would stop all processing). Tick errors are now caught and logged, and side effects like heartbeats are isolated so they can never break the loop.
- [x] `GET /api/worker/health`: authenticated, returns anyOnline + worker list (pid / poll interval / lease / last heartbeat / last tick status / online). Deliberately not organization-scoped because the worker is a deployment-wide shared process, and filtered to a 5-minute window so SIGKILLed workers don't pile up.
- [x] Settings page gains a 「生成 worker」 card polling every 10s: explicit guidance when no worker is running, full status when one is.
- [x] AI panel shows a hint while a job is QUEUED, pointing at the settings page.
- [x] Verified: typecheck 5/5; 625 tests green (16+28+37+156+388); e2e 2 passed (33.0s) with a new settings assertion that the e2e-started worker shows as online.
- [x] Noted: real-LLM acceptance still blocked — no provider key in env, .env, or DB (0 of 70 provider rows have a key).

## Task 19: 2026-10-21 Login Rate Limit, Error Boundaries, Book Export

**Files:**
- Create: `apps/web/src/server/rate-limit.ts`, `apps/web/src/server/export-book.ts` + test, `apps/web/src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx`, `apps/web/src/app/api/projects/[projectId]/export/route.ts` + test
- Modify: `apps/web/src/app/api/auth/login/route.ts` + test, `asset-sidebar.tsx`, `workspace/page.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Login rate limiting: in-memory sliding window with dual keys (per IP, per email), 10 failures per 15 minutes → 15-minute block returning 429 + Retry-After. Successful login clears both counters; a blocked window rejects even correct passwords; missing-account and wrong-password share one message so account existence does not leak.
- [x] Login 500s now return a generic message with server-side logging instead of echoing the raw error.
- [x] Error boundaries: app-level error card with retry and back-to-projects, root global-error, 404 page, and a loading spinner with role="status" (respects reduced motion).
- [x] Book export: GET /api/projects/[projectId]/export streams a text/plain attachment built from chapters ordered by chapterNo, with Content-Disposition carrying both an ASCII fallback and a UTF-8 filename (Chinese titles survive), CRLF newlines, illegal filename characters replaced, and a blank-title fallback.
- [x] Workspace chapter sidebar gains an export link that only appears when chapters exist.
- [x] Verified: typecheck 5/5; 640 tests green (16+28+37+156+403); e2e 2 passed (37.5s) including a new .txt download assertion.

## Task 20: 2026-10-21 Full-book Search and Writing Stats

**Files:**
- Create: `apps/web/src/server/search.ts` + test, `apps/web/src/server/project-stats.ts` + test, `apps/web/src/app/api/projects/[projectId]/search/route.ts`, `.../stats/route.ts`
- Modify: `asset-sidebar.tsx`, `workspace/page.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Search service: buildSnippet (first match with 40-char context and edge ellipses, case-insensitive match preserving original casing), countMatches (non-overlapping), searchChapters (Prisma contains + insensitive, ordered by chapter number).
- [x] Search API: limit clamped 1-100 (default 30); a blank query returns an empty result without touching the database.
- [x] Sidebar search box with 300ms debounce: results show chapter + hit count + highlighted snippet; clicking jumps to the chapter and clears the search; distinct empty and error states.
- [x] Stats service: chapter count, total words, average, longest/shortest chapter, and five length buckets.
- [x] Stats API and a persistent sidebar line (共 N 章 · X 字 · 均 Y 字/章) that refreshes as chapters change and degrades silently on failure.
- [x] Verified: typecheck 5/5; 653 tests green (16+28+37+156+416); e2e 2 passed (40.4s) — smoke searches 林墨, asserts one hit with highlight, then clears.

## Task 21: 2026-10-21 Version Diff and Chapter Paging

**Files:**
- Create: `apps/web/src/server/text-diff.ts` + test, `apps/web/src/server/chapter-paging.ts` + test, `apps/web/src/app/api/chapters/[chapterId]/versions/diff/route.ts` + test
- Modify: `versions-panel.tsx`, `api/projects/[projectId]/chapters/route.ts`, `use-workspace-data.ts`, `asset-sidebar.tsx`, `workspace/page.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Text diff: CJK-per-character / latin-per-word tokenization with an LCS table, adjacent same-kind segments merged, and a coarse whole-replacement fallback above 4000 units to bound memory on very long chapters.
- [x] Diff API validates version existence, chapter ownership and entity match, returning segments plus an added/removed character summary.
- [x] Version cards gain a compare toggle rendering an inline diff: green ins, red del, unchanged text inline, with a summary line.
- [x] Chapter paging: normalizePaging (page >= 1, pageSize clamped 1-200, default 50) and findChapterPage (count + page query in parallel). The chapters endpoint stays backward compatible — no paging params returns the full array; paging params return an envelope.
- [x] useChapters gains loadMore/hasMore/isLoadingMore/total with id-deduplicated incremental appends so scroll position is preserved.
- [x] Verified: typecheck 5/5; 674 tests green (16+28+37+156+437); e2e 2 passed (42.0s) — smoke opens the versions tab, compares against current, and waits for the diff summary.

## Task 22: 2026-10-21 Stats Panel and Project Progress

**Files:**
- Create: `apps/web/src/components/workspace/stats-panel.tsx`
- Modify: `workspace-side-tabs.tsx`, `projects/page.tsx`, `project-list.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] New stats tab: three KPI cards (chapters / total words / average per chapter) with tabular numerals, longest and shortest chapter, and a five-bucket length distribution rendered as pure-CSS bars normalized to the largest bucket (no chart library).
- [x] Empty projects get guidance copy and every view has an explicit refresh action.
- [x] Project list shows progress: loadProjects reuses the existing groupBy and adds _sum.wordCount at zero extra query cost, so cards display 「N 章 · X 字」.
- [x] Verified: typecheck 5/5; 674 tests green (16+28+37+156+437); e2e 2 passed (47.9s) — smoke opens the stats tab and asserts 3 KPIs plus 5 distribution rows.

## Task 23: 2026-10-21 Volume Management

**Files:**
- Modify: `apps/web/src/server/chapters.ts`, `apps/web/src/server/chapter-paging.ts`, `api/projects/[projectId]/chapters/route.ts`, `api/chapters/[chapterId]/route.ts`, `asset-sidebar.tsx`, `globals.css`
- Create: `api/projects/[projectId]/volumes/route.ts` + test, `api/volumes/[volumeId]/route.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Service layer gains findVolumesByProject / updateVolume / deleteVolume / assignChapterVolume. deleteVolume clears chapter.volumeId inside a transaction before deleting the volume, so chapters are never destroyed. VolumeStatus is PLANNED/DRAFTING/FINISHED per the real schema (not DONE).
- [x] Volume APIs: list and create (auto orderIndex = max + 1, 409 on unique conflict), patch (title/summary/status) and delete.
- [x] Chapter PATCH accepts volumeId (including null to unassign) and the chapter list returns volumeId.
- [x] Sidebar groups chapters by volume with a colored group header and count; unassigned chapters fall under 「未分卷」; with no volumes at all the flat list is unchanged (fully backward compatible).
- [x] Verified: typecheck 5/5; 679 tests green (16+28+37+156+442); e2e 2 passed (52.6s).

## Task 24: 2026-10-21 Volume Management UI

**Files:**
- Modify: `asset-sidebar.tsx`, `workspace/page.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Create volume inline from the sidebar header (「+ 卷」): title required, submit disabled while creating, errors shown in place, new volume appended without a full refresh.
- [x] Move chapters between volumes via a compact per-chapter select (未分卷 + each volume), patching volumeId and reloading groups on success. The select renders only when volumes exist, so projects without volumes look unchanged; the row's select is disabled while its move is in flight.
- [x] Volume and chapter-move errors surface in one place at the top of the sidebar.
- [x] Verified: typecheck 5/5; 679 tests green; e2e 2 passed (50.9s) — smoke creates a volume, asserts the group header, then moves a chapter into it.

## Task 25: 2026-10-21 Mobile Workspace Layout

**Files:**
- Modify: `globals.css`, `asset-sidebar.tsx`, `workspace/page.tsx`, `e2e/smoke.spec.ts`
- Create: `e2e/mobile-layout.spec.ts` (intentionally skipped, see note)

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Narrow screens now use grid-template-areas editor/chapters/ai so the editor is always first; previously the chapter list and AI panel sat above the text and pushed it off-screen.
- [x] Panels are height-capped and scroll internally (chapters 45vh, AI 60vh) so no single panel owns the viewport.
- [x] A 「回到正文」 floating button (mobile only, hidden above 921px) smooth-scrolls back to the editor from deep in a list.
- [x] Gave the sidebar an explicit asset-sidebar class (it only had the generic pane class) so layout has a stable hook.
- [x] Lesson recorded: a separate mobile spec ran in parallel with smoke/settings against the same dev server and database, turning all three red (404 pages). The assertions were folded into the end of smoke using page.setViewportSize() instead.
- [x] Verified: typecheck 5/5; 679 tests green; e2e 2 passed + 1 skipped (47.5s) asserting editor y < sidebar y at 390x844, the jump button visible, and no horizontal overflow.

## Task 26: 2026-10-21 Chapter Delete and Project Info Editing

**Files:**
- Create: `api/projects/[projectId]/route.ts` + test, `project-info-panel.tsx`
- Modify: `server/chapters.ts`, `api/chapters/[chapterId]/route.ts`, `asset-sidebar.tsx`, `workspace-side-tabs.tsx`, `globals.css`, `e2e/smoke.spec.ts`

**Commands:**

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
```

- [x] Chapter soft delete: softDeleteChapter only stamps deletedAt so prose and the version chain survive; DELETE /api/chapters/[chapterId] exposes it. The sidebar row shows a delete button on hover, an inline confirm warns that history is kept, and the list reloads after deletion.
- [x] Project editing: GET/PATCH /api/projects/[projectId] read and update title/genre/status/styleBrief/premise with status and blank-title validation and P2025 mapped to 404; DELETE soft-deletes the project.
- [x] New 「作品」 tab edits all five fields and confirms that later generations will use the new settings — premise and styleBrief feed context assembly directly.
- [x] Delete buttons are opacity 0 until hover or keyboard focus, keeping the sidebar visually quiet.
- [x] Verified: typecheck 5/5; 687 tests green (16+28+37+156+450); e2e 2 passed + 1 skipped (53.8s) covering premise edit + save confirmation and hover-delete with confirmation.
