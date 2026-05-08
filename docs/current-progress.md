# Current Progress

> Last updated: 2026-05-08

## Completed

- Created this Windows-local runnable copy at `D:\develop\AI\xiaoshuo\base_win` from source project `D:\develop\AI\xiaoshuo\base`.
- Copied project source, configuration, infrastructure, scripts, and documentation.
- Excluded generated or local-only folders and files:
  - `.git/`
  - `node_modules/`
  - `.pnpm-store/`
  - `.worktrees/`
  - `.next/`
  - `dist/`
  - `build/`
  - `*.tsbuildinfo`
- Created project-local Claude instructions:
  - `CLAUDE.md`
- Created base_win localization plan:
  - `docs/plans/2026-05-08-base-win-localization-plan.md`
- Created local runtime environment file:
  - `.env`
- Created a local Git repository for `base_win`.
- Recorded branch workflow rule:
  - If temporary branches are used, merge them back promptly after use and record the branch purpose and merge result in the session progress notes.
- Confirmed Windows-first local development:
  - PostgreSQL is required.
  - Docker is optional and currently not installed in PATH.
  - Redis is optional for the current PostgreSQL queue path; a local Redis Windows service is running on `127.0.0.1:6379` without a password.
  - MVP queue driver is `postgres`.
- Reused the existing local database:
  - database: `ai_novel_platform`

## Verification Evidence

These tools are installed and usable on this Windows machine:

```text
Node.js: v22.15.0
pnpm: 10.10.0
npm: 10.9.2
Git: 2.45.1.windows.1
Windows PowerShell: 5.1.26100.8115
PostgreSQL: 16.13
```

These optional tools are not currently available in PATH:

```text
Docker
Redis CLI commands (`redis-server`, `redis-cli`)
PowerShell 7 (`pwsh`)
```

Redis is installed as a Windows service and currently running:

```text
Service: Redis
Status: Running
StartType: Automatic
Version: 5.0.9
Address: 127.0.0.1:6379
Auth: no password (`CONFIG GET requirepass` returned empty)
PING: PONG
```

PostgreSQL binary paths exist:

```text
D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe
D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe
D:\myTool\develop\PostgreSQL\data
D:\myTool\develop\PostgreSQL\postgresql.log
```

Current database connection works:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
```

The current `ai_novel_platform` database contains 27 public tables.

Applied Prisma migrations:

```text
202604290001_initial_core
20260501001_add_writing_assets
20260501002_add_deslop_style_method
```

Prisma schema validation passed in this workspace:

```bash
pnpm db:validate
```

Current session verification in `base_win` passed:

```text
pnpm install: passed
pnpm db:validate: passed
pnpm db:generate: passed
pnpm test: 37 test files passed, 225 tests passed
pnpm typecheck: passed
pnpm db:validate && pnpm typecheck: passed again after Redis check
pnpm dev:web: HTTP 200, page contains AI Novel Platform
```

## Current Runtime Notes

PostgreSQL is running locally on:

```text
127.0.0.1:5432
```

Start PostgreSQL manually after reboot if needed:

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' -D 'D:\myTool\develop\PostgreSQL\data' -l 'D:\myTool\develop\PostgreSQL\postgresql.log' start
```

## Review Notes

- No `.git/`, `.worktrees/`, `.pnpm-store/`, or root `.next/` directory was copied from the source project.
- `node_modules/`, `packages/*/node_modules/`, `apps/*/node_modules/`, `packages/db/src/generated/`, and `apps/web/.next/` were generated locally by install/generate/dev commands.
- `.gitignore` excludes `.env`, `node_modules/`, `.next/`, `*.tsbuildinfo`, and `packages/db/src/generated/`.
- Secret scan hits were reviewed as test fake values, schema field names, documentation placeholders, or generated code; no real API key was identified.

## Pending Cleanup

The temporary initdb password file still exists:

```text
D:\myTool\develop\PostgreSQL\downloads\pgpass.txt
```

It contains the local development password `postgres`. Deleting it requires explicit confirmation because it is outside the workspace.

## Next Recommended Step

Implement the first application/API layer from the active MVP plan, starting with project library service/API and keeping PostgreSQL-backed jobs as the queue driver.
