# AI Novel Platform Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **Status Update 2026-04-30:** This document remains the broad product roadmap, but the active local MVP execution plan is now `docs/plans/2026-04-30-windows-postgres-mvp-plan.md`. The newer plan reflects the actual Windows environment, native PostgreSQL installation at `D:\myTool\develop\PostgreSQL`, applied migration `202604290001_initial_core`, and `QUEUE_DRIVER=postgres`.

**Goal:** Build a multi-user SaaS platform for structured AI-assisted novel creation, focused on long-form serialized fiction with short-story support.

**Architecture:** Use a TypeScript monorepo with a web app, API layer, PostgreSQL database, PostgreSQL-backed job queue for the Windows-friendly MVP, and AI generation workers. The MVP starts as a modular monolith and keeps clear boundaries for later extraction of the generation engine, billing, and collaboration services. Redis/BullMQ remains an optional later scaling path.

**Tech Stack:** Next.js, TypeScript, PostgreSQL, Prisma or Drizzle, PostgreSQL-backed jobs for the Windows-friendly MVP, optional Redis/BullMQ later, Tailwind CSS, shadcn/ui or equivalent, SSE/WebSocket for generation progress, S3-compatible object storage.

---

## Phase 0: Repository And Tooling

### Task 1: Initialize Repository

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `apps/web/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/shared/package.json`
- Create: `.gitignore`
- Create: `.env.example`

**Step 1: Initialize git**

Run:

```bash
git init
```

Expected: repository initialized.

**Step 2: Create monorepo package files**

Create workspace scripts for:

- `dev`
- `build`
- `test`
- `lint`
- `db:migrate`
- `worker:dev`

**Step 3: Install base dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile generated and workspace install succeeds.

**Step 4: Commit**

```bash
git add .
git commit -m "chore: initialize ai novel platform monorepo"
```

### Task 2: Add Development Infrastructure

**Files:**
- Create: `docker-compose.yml`
- Create: `infra/postgres/init.sql`
- Create: `infra/redis/README.md`
- Create: `.env.example`

**Step 1: Define local services**

Add PostgreSQL and Redis services with named volumes for optional Docker-based development.

On Windows, Docker services are optional. The current machine uses native PostgreSQL 16.13 at `D:\myTool\develop\PostgreSQL`; Redis is deferred while `QUEUE_DRIVER=postgres`.

**Step 2: Add environment variables**

Include:

- `DATABASE_URL`
- `REDIS_URL`
- `QUEUE_DRIVER`
- `APP_URL`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `S3_ENDPOINT`
- `S3_BUCKET`

**Step 3: Verify services**

Run:

```bash
docker compose up -d
docker compose ps
```

Expected: native PostgreSQL is reachable on `127.0.0.1:5432`; Docker Redis is optional for MVP.

**Step 4: Commit**

```bash
git add docker-compose.yml infra .env.example
git commit -m "chore: add local database and queue services"
```

## Phase 1: Database Foundation

### Task 3: Add ORM And Core Schema

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/prisma/schema.prisma` or `packages/db/src/schema.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/tenant.ts`

**Step 1: Write initial schema**

Add tables:

- `users`
- `user_identities`
- `organizations`
- `organization_members`
- `invitations`
- `audit_logs`

**Step 2: Add tenant helper tests**

Test that every tenant-scoped query helper requires `organizationId`.

**Step 3: Run migration**

Run:

```bash
pnpm db:migrate
```

Expected: migration succeeds and tables exist.

**Step 4: Commit**

```bash
git add packages/db
git commit -m "feat: add account and organization schema"
```

### Task 4: Add Project And Writing Schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma` or `packages/db/src/schema.ts`
- Create: `packages/shared/src/domain/project.ts`
- Create: `packages/shared/src/domain/writing.ts`

**Step 1: Add project tables**

Add:

- `projects`
- `project_members`
- `volumes`
- `chapters`
- `outlines`
- `content_versions`

**Step 2: Add writing asset tables**

Add:

- `characters`
- `character_relationships`
- `world_items`
- `plot_threads`
- `project_memories`

**Step 3: Add database constraints**

Add unique constraints:

- `(organization_id, slug)` on projects.
- `(project_id, chapter_no)` on chapters.
- `(project_id, order_index)` on volumes.
- `(entity_type, entity_id, version_no)` on content versions.

**Step 4: Run migration**

Run:

```bash
pnpm db:migrate
```

Expected: migration succeeds.

**Step 5: Commit**

```bash
git add packages/db packages/shared
git commit -m "feat: add project writing schema"
```

### Task 5: Add AI, Usage, And Sharing Schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma` or `packages/db/src/schema.ts`
- Create: `packages/shared/src/domain/ai.ts`
- Create: `packages/shared/src/domain/billing.ts`

**Step 1: Add model tables**

Add:

- `model_providers`
- `model_profiles`
- `prompt_templates`

**Step 2: Add generation tables**

Add:

- `generation_jobs`
- `generation_steps`
- `generation_stream_events`

**Step 3: Add billing and sharing tables**

Add:

- `usage_events`
- `subscriptions`
- `comments`
- `share_links`

**Step 4: Run migration**

Run:

```bash
pnpm db:migrate
```

Expected: migration succeeds.

**Step 5: Commit**

```bash
git add packages/db packages/shared
git commit -m "feat: add ai generation and usage schema"
```

## Phase 2: Authentication And SaaS Base

### Task 6: Implement Auth

**Files:**
- Create: `apps/web/src/lib/auth/session.ts`
- Create: `apps/web/src/lib/auth/password.ts`
- Create: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/register/page.tsx`
- Create: `apps/web/src/app/api/auth/register/route.ts`
- Create: `apps/web/src/app/api/auth/login/route.ts`
- Create: `apps/web/src/app/api/auth/logout/route.ts`

**Step 1: Write auth tests**

Cover:

- Password hashing.
- Login failure for wrong password.
- Session creation for valid login.

**Step 2: Implement minimal auth**

Use secure cookies and server-side session validation.

**Step 3: Run tests**

Run:

```bash
pnpm test --filter web
```

Expected: auth tests pass.

**Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add email password authentication"
```

### Task 7: Implement Organization Context

**Files:**
- Create: `apps/web/src/lib/auth/organization.ts`
- Create: `apps/web/src/app/(app)/layout.tsx`
- Create: `apps/web/src/app/(app)/settings/team/page.tsx`
- Create: `apps/web/src/app/api/organizations/route.ts`
- Create: `apps/web/src/app/api/organizations/[organizationId]/members/route.ts`

**Step 1: Write permission tests**

Cover organization roles:

- owner can manage members.
- admin can invite members.
- viewer cannot edit settings.

**Step 2: Implement organization selector**

Every app route must resolve an active organization before loading tenant data.

**Step 3: Run tests**

Run:

```bash
pnpm test --filter web
```

Expected: permission tests pass.

**Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add organization context and permissions"
```

## Phase 3: Writing Workspace MVP

### Task 8: Implement Project Library

**Files:**
- Create: `apps/web/src/app/(app)/projects/page.tsx`
- Create: `apps/web/src/app/(app)/projects/new/page.tsx`
- Create: `apps/web/src/app/api/projects/route.ts`
- Create: `apps/web/src/lib/projects/service.ts`

**Step 1: Write service tests**

Cover:

- Create project with unique slug.
- List only projects in current organization.
- Soft delete project.

**Step 2: Build project list UI**

Show title, type, genre, status, updated time, and word count summary.

**Step 3: Run tests and lint**

Run:

```bash
pnpm test --filter web
pnpm lint --filter web
```

Expected: pass.

**Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add project library"
```

### Task 9: Implement Chapter And Outline CRUD

**Files:**
- Create: `apps/web/src/lib/writing/chapters.ts`
- Create: `apps/web/src/lib/writing/outlines.ts`
- Create: `apps/web/src/app/api/projects/[projectId]/chapters/route.ts`
- Create: `apps/web/src/app/api/chapters/[chapterId]/route.ts`
- Create: `apps/web/src/app/api/projects/[projectId]/outlines/route.ts`

**Step 1: Write CRUD tests**

Cover:

- Create volume and chapter.
- Update chapter content and word count.
- Save content version before AI overwrite.
- Query outline tree in order.

**Step 2: Implement services**

Keep business logic in service files, not route handlers.

**Step 3: Run tests**

Run:

```bash
pnpm test --filter web
```

Expected: pass.

**Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add chapters and outlines"
```

### Task 10: Implement Writing Assets

**Files:**
- Create: `apps/web/src/lib/writing/characters.ts`
- Create: `apps/web/src/lib/writing/world-items.ts`
- Create: `apps/web/src/lib/writing/plot-threads.ts`
- Create: `apps/web/src/app/api/projects/[projectId]/characters/route.ts`
- Create: `apps/web/src/app/api/projects/[projectId]/world-items/route.ts`
- Create: `apps/web/src/app/api/projects/[projectId]/plot-threads/route.ts`

**Step 1: Write asset tests**

Cover:

- Create character card.
- Update relationship.
- Create world item.
- Mark plot thread resolved.

**Step 2: Implement APIs**

Use tenant-scoped access checks for every route.

**Step 3: Commit**

```bash
git add apps/web
git commit -m "feat: add writing asset management"
```

### Task 11: Build Three-Column Workspace

**Files:**
- Create: `apps/web/src/app/(app)/projects/[projectId]/workspace/page.tsx`
- Create: `apps/web/src/components/workspace/workspace-shell.tsx`
- Create: `apps/web/src/components/workspace/asset-sidebar.tsx`
- Create: `apps/web/src/components/workspace/editor-pane.tsx`
- Create: `apps/web/src/components/workspace/ai-panel.tsx`

**Step 1: Add UI tests**

Cover:

- Workspace renders asset tree.
- Chapter selection loads editor.
- AI panel shows actions for selected entity.

**Step 2: Implement layout**

Use fixed responsive layout:

- Desktop: left asset tree, center editor, right AI panel.
- Tablet: collapsible side panels.
- Mobile: tabbed views for assets, editor, AI.

**Step 3: Run visual check**

Run local dev server and inspect 375px, 768px, 1024px, 1440px viewports.

**Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add structured writing workspace"
```

## Phase 4: AI Generation MVP

### Task 12: Add Model Provider Management

**Files:**
- Create: `apps/web/src/lib/ai/providers.ts`
- Create: `apps/web/src/lib/ai/encryption.ts`
- Create: `apps/web/src/app/(app)/settings/models/page.tsx`
- Create: `apps/web/src/app/api/model-providers/route.ts`
- Create: `apps/web/src/app/api/model-providers/test/route.ts`

**Step 1: Write encryption tests**

Cover:

- API Key encrypts before persistence.
- API Key decrypts only inside provider test/call path.
- Logs never include raw API Key.

**Step 2: Implement provider CRUD**

Support user-key and platform-key records.

**Step 3: Implement provider test**

Call a lightweight model endpoint with timeout and clear error mapping.

**Step 4: Commit**

```bash
git add apps/web
git commit -m "feat: add model provider management"
```

### Task 13: Add Generation Job State Machine

**Files:**
- Create: `packages/shared/src/generation/state.ts`
- Create: `apps/web/src/lib/generation/jobs.ts`
- Create: `apps/web/src/app/api/generation-jobs/route.ts`
- Create: `apps/web/src/app/api/generation-jobs/[jobId]/cancel/route.ts`

**Step 1: Write state machine tests**

Cover valid transitions:

- queued -> running -> succeeded.
- queued -> cancelled.
- running -> failed.
- running -> cancelled.

Reject invalid transitions:

- succeeded -> running.
- failed -> succeeded without retry job.

**Step 2: Implement job creation**

Validate permission, target entity, lock key, and model profile.

**Step 3: Commit**

```bash
git add packages/shared apps/web
git commit -m "feat: add generation job state machine"
```

### Task 14: Add Worker Pipeline

**Files:**
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/queue.ts`
- Create: `apps/worker/src/pipeline/run-generation-job.ts`
- Create: `apps/worker/src/pipeline/context-select.ts`
- Create: `apps/worker/src/pipeline/prompt-build.ts`
- Create: `apps/worker/src/pipeline/model-call.ts`
- Create: `apps/worker/src/pipeline/persist-version.ts`

**Step 1: Write pipeline tests with fake model**

Cover:

- Select context for chapter generation.
- Build prompt from project, chapter outline, characters, world items.
- Persist generated draft as content version.
- Record usage event.

**Step 2: Implement BullMQ worker**

Worker reads queued jobs and executes pipeline steps with heartbeat updates.

**Step 3: Run worker test**

Run:

```bash
pnpm test --filter worker
```

Expected: fake-model pipeline passes.

**Step 4: Commit**

```bash
git add apps/worker
git commit -m "feat: add ai generation worker pipeline"
```

### Task 15: Add Streaming Progress

**Files:**
- Create: `apps/web/src/app/api/generation-jobs/[jobId]/stream/route.ts`
- Create: `apps/web/src/components/workspace/generation-progress.tsx`
- Modify: `apps/worker/src/pipeline/model-call.ts`

**Step 1: Write stream tests**

Cover:

- Unauthorized user cannot subscribe.
- Subscriber receives progress events.
- Stream ends after succeeded/failed/cancelled.

**Step 2: Implement SSE**

Use PostgreSQL-backed stream events for the Windows MVP. Redis pub/sub can replace this later when `QUEUE_DRIVER=redis`.

**Step 3: Commit**

```bash
git add apps/web apps/worker
git commit -m "feat: stream generation progress"
```

## Phase 5: Quality Loop

### Task 16: Add Review And Deslop Actions

**Files:**
- Create: `apps/worker/src/pipeline/review.ts`
- Create: `apps/worker/src/pipeline/deslop.ts`
- Create: `apps/web/src/components/workspace/review-panel.tsx`
- Modify: `apps/web/src/components/workspace/ai-panel.tsx`

**Step 1: Write fake-model tests**

Cover:

- Review returns structured issues.
- Deslop returns rewritten text and replacement notes.
- User can apply or discard result.

**Step 2: Implement actions**

Save review output to generation job output and rewritten text to a new content version.

**Step 3: Commit**

```bash
git add apps/web apps/worker
git commit -m "feat: add review and deslop generation actions"
```

### Task 17: Add Memory Extraction

**Files:**
- Create: `apps/worker/src/pipeline/memory-extract.ts`
- Create: `apps/web/src/lib/writing/memories.ts`
- Create: `apps/web/src/app/api/projects/[projectId]/memories/route.ts`

**Step 1: Write extraction tests**

Cover:

- Chapter summary memory is created after successful chapter generation.
- New plot thread evidence is linked to chapter.
- Character status updates do not overwrite locked manual fields.

**Step 2: Implement extraction**

Use model output schema and validation before updating project memories.

**Step 3: Commit**

```bash
git add apps/web apps/worker
git commit -m "feat: extract project memory from generated chapters"
```

## Phase 6: SaaS Hardening

### Task 18: Add Usage Dashboard

**Files:**
- Create: `apps/web/src/app/(app)/usage/page.tsx`
- Create: `apps/web/src/lib/billing/usage.ts`
- Create: `apps/web/src/app/api/usage/route.ts`

**Step 1: Write aggregation tests**

Cover:

- Aggregate by organization.
- Aggregate by project.
- Aggregate by model.
- Separate user-key and platform billing source.

**Step 2: Implement dashboard**

Show recent calls, token totals, estimated cost, model distribution, and task latency.

**Step 3: Commit**

```bash
git add apps/web
git commit -m "feat: add usage dashboard"
```

### Task 19: Add Share Links And Comments

**Files:**
- Create: `apps/web/src/lib/share-links.ts`
- Create: `apps/web/src/lib/comments.ts`
- Create: `apps/web/src/app/api/share-links/route.ts`
- Create: `apps/web/src/app/share/[token]/page.tsx`
- Create: `apps/web/src/app/api/comments/route.ts`

**Step 1: Write security tests**

Cover:

- Share token is stored hashed.
- Expired link cannot be opened.
- Comment permission is enforced.

**Step 2: Implement preview page**

Support project/chapter/version preview without exposing full workspace.

**Step 3: Commit**

```bash
git add apps/web
git commit -m "feat: add private sharing and comments"
```

### Task 20: Add Audit Logging

**Files:**
- Create: `apps/web/src/lib/audit/log.ts`
- Modify: write routes for projects, chapters, model providers, share links.

**Step 1: Write audit tests**

Cover:

- Model provider creation writes audit log.
- Share link creation writes audit log.
- Chapter delete writes audit log.

**Step 2: Add audit calls**

Do not log raw API keys or full private content.

**Step 3: Commit**

```bash
git add apps/web
git commit -m "feat: add audit logging"
```

## Phase 7: Verification And Launch Prep

### Task 21: End-To-End Flow

**Files:**
- Create: `apps/web/e2e/create-project-and-generate.spec.ts`

**Step 1: Write E2E test**

Flow:

1. Register user.
2. Create organization.
3. Create project.
4. Create character.
5. Create chapter outline.
6. Run fake-model chapter generation.
7. See generated draft in editor.
8. Roll back to previous version.

**Step 2: Run E2E**

Run:

```bash
pnpm test:e2e --filter web
```

Expected: pass.

**Step 3: Commit**

```bash
git add apps/web/e2e
git commit -m "test: add end-to-end writing flow"
```

### Task 22: Deployment Checklist

**Files:**
- Create: `docs/deployment.md`
- Create: `docs/security.md`
- Create: `docs/operations.md`

**Step 1: Document deployment**

Include:

- Environment variables.
- Database migration process.
- Worker startup.
- PostgreSQL job persistence for MVP; Redis persistence only if Redis/BullMQ is enabled.
- Object storage.

**Step 2: Document security**

Include:

- API Key encryption.
- Tenant isolation.
- Audit logging.
- Backup and restore.

**Step 3: Document operations**

Include:

- Failed job inspection.
- Queue retry.
- Usage reconciliation.
- User support workflow.

**Step 4: Commit**

```bash
git add docs
git commit -m "docs: add deployment and operations guides"
```

## Implementation Notes

- Keep the first implementation modular, but do not split into microservices before usage proves the need.
- Use fake model providers for tests. Do not make real LLM calls in automated tests.
- Use tenant helpers for every query. Do not let route handlers compose raw cross-tenant queries.
- Keep all AI outputs versioned. Never overwrite user-authored content without a version snapshot.
- Add model-specific adapters behind one internal interface so provider changes do not affect product code.

## Execution Options

Plan complete and saved to `docs/plans/2026-04-29-ai-novel-platform-implementation-plan.md`. Two execution options:

1. Subagent-Driven in this session: dispatch a fresh implementation agent per task, review between tasks, fast iteration.
2. Parallel Session separately: open a new session with `superpowers:executing-plans`, batch execution with checkpoints.

Choose the execution mode only after confirming the design document.
