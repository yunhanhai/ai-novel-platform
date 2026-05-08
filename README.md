# AI Novel Platform

Multi-user SaaS platform for structured AI-assisted novel creation.

## Current Status

The repository currently contains the first database layer and a working Windows local PostgreSQL runtime:

- Native PostgreSQL 16.13 installed under `D:\myTool\develop\PostgreSQL`.
- Project database `ai_novel_platform` created and migrated.
- Optional PostgreSQL/Redis Docker Compose configuration for machines that have Docker Desktop.
- Prisma 7 schema and initial SQL migration.
- Core SaaS tables for users, organizations, projects, chapters, model profiles, generation jobs, usage events, and audit logs.

## Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+

Docker Desktop and Redis are optional. The default queue driver is PostgreSQL, using the `generation_jobs` and `generation_steps` tables. Redis can be added later for BullMQ-backed workers.

## Windows Local Setup

Recommended Windows-first setup:

1. Install Node.js and pnpm.
2. Use the local PostgreSQL runtime documented in `docs/windows-postgresql-runtime.md`, or install PostgreSQL for Windows.
3. Create a root `.env` file from `.env.example`.
4. Run `pnpm install`.
5. Run `pnpm db:migrate`.

Redis is not required for the first local build. If you want Redis on Windows, use Docker Desktop, WSL2, Memurai, or a hosted Redis-compatible service.

This machine also has a local PostgreSQL runtime documented in:

```text
docs/windows-postgresql-runtime.md
```

The current implementation progress is tracked in:

```text
docs/current-progress.md
```

The active MVP execution plan is:

```text
docs/plans/2026-04-30-windows-postgres-mvp-plan.md
```

Current local connection:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
```

## Optional Docker Services

If Docker Desktop is available, start PostgreSQL and Redis:

```bash
pnpm dev:services
```

Apply the Prisma migration:

```bash
pnpm db:migrate
```

Validate the schema and generate Prisma Client:

```bash
pnpm db:validate
pnpm db:generate
```

Docker is not required on this Windows machine because PostgreSQL is installed natively.
