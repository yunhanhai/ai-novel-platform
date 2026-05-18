# AI Novel Platform - Windows Local Copy

## Project Role

This directory is the Windows local runnable copy of the source project at `D:\develop\AI\xiaoshuo\base`.

Use this workspace for Windows-first local development and verification. Reuse the existing local PostgreSQL database unless the user explicitly asks for an isolated database.

## Runtime Baseline

- OS: Windows 11
- Node.js: 22+
- Package manager: pnpm 10.10.0
- Database: PostgreSQL 16.13 at `D:\myTool\develop\PostgreSQL`
- Database name: `ai_novel_platform`
- Queue driver: PostgreSQL (`QUEUE_DRIVER="postgres"`)
- Docker: optional, not required for the current local MVP
- Redis: optional, not required while using PostgreSQL-backed jobs

## Common Commands

Run commands from this project root unless stated otherwise.

```bash
pnpm install
pnpm db:migrate
pnpm db:validate
pnpm db:generate
pnpm db:seed       # idempotent — creates 1 ModelProvider + 1 ModelProfile (org-level, taskType=default) + 1 WritingMethodology + 1 StyleProfile
pnpm test
pnpm typecheck
pnpm dev:web                       # terminal 1
cd apps/worker && pnpm dev         # terminal 2 (separate process, polls generation_jobs)
```

Start PostgreSQL manually after reboot if needed:

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' -D 'D:\myTool\develop\PostgreSQL\data' -l 'D:\myTool\develop\PostgreSQL\postgresql.log' start
```

Check database connectivity:

```powershell
$env:PGPASSWORD='postgres'
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d ai_novel_platform -c 'select version();'
```

## Local MVP Startup Order

Always boot in this order; out-of-order causes silent FAILED jobs or 500s:

1. PostgreSQL running on 127.0.0.1:5432
2. `pnpm db:migrate` (only after schema changes) and `pnpm db:seed` (only after a fresh DB)
3. `pnpm dev:web` (Next.js)
4. `cd apps/worker && pnpm dev` (job poller)

## Model Mode Switch

The `.env` flag `USE_FAKE_MODEL` controls whether worker generates real LLM output:

- `USE_FAKE_MODEL="true"` (default for local dev): worker injects `createFakeModel()` as `deps.model`. Jobs always SUCCEEDED with placeholder text, no LLM cost. Use for UI/flow verification.
- `USE_FAKE_MODEL="false"` (real LLM): worker requires a resolvable `ModelProfile` AND a 64-hex-char `ENCRYPTION_KEY` AND a valid `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` encrypted into `model_providers.encrypted_api_key`. Missing any of these → `NO_MODEL_PROFILE` FAILED.

After switching the flag, restart `apps/worker` (it reads env at boot).

## Documentation Workflow

At the end of each work session, manually update:

- `docs/current-progress.md`: what changed, verification evidence, risks, next step.
- `docs/plans/2026-05-08-base-win-localization-plan.md`: checklist state for this Windows copy.

Do not configure automatic Stop hooks for logging unless the user explicitly asks. Manual updates keep the record accurate.

## Development Rules

- Prefer existing project patterns from `apps/` and `packages/`.
- Do not copy or commit generated dependency folders such as `node_modules/`.
- Do not require Docker or Redis for the first local MVP.
- Do not delete files without explicit user confirmation.
- Reuse `ai_novel_platform` unless the user asks for a separate database.
- If temporary branches are used, merge them back promptly after use and record the branch purpose and merge result in the session progress notes.
