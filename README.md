# AI Novel Platform

Multi-user SaaS platform for structured AI-assisted novel creation. Built on Next.js 15 + Prisma 7 + PostgreSQL + a standalone TypeScript worker.

## Current Status

Beyond the database layer, the following are implemented and exercised end-to-end on Windows local PostgreSQL:

- **Auth**: session-based login / register / logout — HS256 JWT cookie signed with Web Crypto (Edge-Runtime compatible middleware).
- **Workspace UI**: 16 panel components — outline, chapter editor, content versions, DESLOP, memories, style profile, methodology, characters, world items, plot threads, AI panel, pipeline timeline, asset sidebar, etc.
- **Worker pipeline**: 3 registered job handlers — `GENERATE_CHAPTER`, `DESLOP`, `EXTRACT_MEMORY`. All share a unified `resolveModel(job) → ModelProfile` path and write `generation_steps` audit rows.
- **LLM adapters**: OpenAI / Anthropic / DeepSeek / Gemini with encrypted API key storage (AES-256-GCM via `ENCRYPTION_KEY`).
- **Fake-model fallback** (`USE_FAKE_MODEL=true`): full pipeline runs without any LLM key — placeholder text, real DB writes, real version bumps. Use it to verify UI/flow on day one.
- **27 DB tables** with strict tenant isolation (`organizationId` everywhere).
- **331 tests passing** (shared 22 + db 12 + worker 131 + web 166).

## Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+

Docker and Redis are **not required**. Default queue driver is PostgreSQL (`generation_jobs` + `generation_steps`).

## Quick Start: Run the MVP Locally

End-to-end startup, fresh machine to "writing your first chapter" in ~10 minutes.

### 1. PostgreSQL

If using the bundled Windows runtime documented in `docs/windows-postgresql-runtime.md`:

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' `
  -D 'D:\myTool\develop\PostgreSQL\data' `
  -l 'D:\myTool\develop\PostgreSQL\postgresql.log' start
```

Otherwise install PostgreSQL 16+ for your platform and confirm it listens on `127.0.0.1:5432`.

### 2. Configure `.env` (project root)

Copy `.env.example` to `.env` and fill in:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
APP_URL="http://localhost:3000"

# 任意 UUID，用于本机演示；seed 脚本会以这些作为默认 org/user
DEFAULT_ORGANIZATION_ID="00000000-0000-0000-0000-000000000001"
DEFAULT_USER_ID="00000000-0000-0000-0000-000000000002"

# 开发模式：true → 跑 fake-model，无需任何 LLM key
USE_FAKE_MODEL="true"
```

For the web app, also create `apps/web/.env.local`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
APP_URL="http://localhost:3000"
DEFAULT_ORGANIZATION_ID="00000000-0000-0000-0000-000000000001"
DEFAULT_USER_ID="00000000-0000-0000-0000-000000000002"
SESSION_SECRET="<32+ chars random string — required for login/register>"
```

Next.js does not read the monorepo root `.env`, so this file is required separately.

### 3. Install, migrate, seed

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
```

`pnpm db:seed` is idempotent and creates the minimum usable dataset:

- 1 `ModelProvider` (OpenAI Compatible, PLATFORM_KEY)
- 1 `ModelProfile` (org-level, `taskType="default"` — falls through to every job type)
- 1 `WritingMethodology` (三幕剧 / three-act, scoped to the first project found in your org)
- 1 `StyleProfile` (通俗易读 / readable mainstream, same project)

Without `OPENAI_API_KEY`/`ENCRYPTION_KEY`, the API key field is left empty — fine for `USE_FAKE_MODEL=true`.

### 4. Start the two processes

Two terminals:

```bash
# Terminal 1 — Next.js app
pnpm dev:web

# Terminal 2 — job worker
cd apps/worker && pnpm dev
```

### 5. Use it

1. Open <http://localhost:3000/register>, create an account.
2. From the projects list, create a project (or use the seeded "冒烟项目").
3. Enter the workspace, write or paste an outline, then trigger chapter generation.
4. After a chapter has content, run **DESLOP** to scan for AI-flavor, and **抽取记忆** to lift character changes / world facts / hooks into the memory tables.

Job execution is logged in `generation_jobs` / `generation_steps` and visible in the pipeline timeline panel.

## Switching to Real LLMs

Move from fake-model to real OpenAI/Anthropic output:

1. Generate a 64-char-hex encryption key:

   ```bash
   openssl rand -hex 32
   ```

2. Edit `.env`:

   ```env
   USE_FAKE_MODEL="false"
   ENCRYPTION_KEY="<the 64-hex-char value above>"
   OPENAI_API_KEY="sk-..."         # or ANTHROPIC_API_KEY
   ```

3. The seed script skips already-existing `ModelProvider` rows, so to load the new key either:
   - Delete the row and re-run `pnpm db:seed`, or
   - `UPDATE model_providers SET encrypted_api_key = ... WHERE name = 'OpenAI 默认';` using the `encrypt()` helper in `packages/shared/src/crypto/encryption.ts`.

4. Restart the worker. Submit a `GENERATE_CHAPTER` job — `generation_jobs.errorCode` should remain null and the output should be real LLM text.

If you see `errorCode: "NO_MODEL_PROFILE"`, the resolver could not find a profile, or `ENCRYPTION_KEY` is missing/wrong length, or the provider's `encryptedApiKey` is empty. The worker logs a `console.warn` line with the reason.

## Useful Commands

```bash
pnpm install            # install all workspace deps
pnpm db:validate        # prisma validate
pnpm db:generate        # regenerate Prisma client
pnpm db:migrate         # apply migrations
pnpm db:seed            # idempotent minimum dataset
pnpm typecheck          # all 4 packages
pnpm test               # all 4 packages (331 tests)
pnpm dev:web            # Next.js
```

Worker-only (`apps/worker`):

```bash
cd apps/worker && pnpm dev
```

## Project Layout

```
apps/
  web/                  Next.js 15 — app router, server actions, route handlers
  worker/               Standalone TypeScript worker — polls generation_jobs, runs pipelines
packages/
  db/                   Prisma 7 schema, client, migrations, seed script, generation-jobs helpers
  shared/               Pure utilities — crypto, password hashing, word count, etc.
docs/
  current-progress.md   Living changelog — read this for "what works right now"
  plans/                Architecture and milestone plans
  superpowers/specs/    Detailed design specs
```

## Documentation Map

- Current implementation state: `docs/current-progress.md`
- Active MVP plan (Windows): `docs/plans/2026-04-30-windows-postgres-mvp-plan.md`
- Windows PostgreSQL setup: `docs/windows-postgresql-runtime.md`
- MVP API loop design: `docs/superpowers/specs/2026-05-08-mvp-application-api-loop-design.md`
- Expansion roadmap: `docs/plans/2026-05-01-expansion-roadmap.md`

## Optional Docker Services

If Docker Desktop is available and you prefer containerized Postgres/Redis:

```bash
pnpm dev:services        # start
pnpm dev:services:down   # stop
```

Not required on this Windows machine — native PostgreSQL works.
