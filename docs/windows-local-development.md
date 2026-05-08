# Windows Local Development

This project is designed to run on Windows without requiring Docker for the first MVP.

The current machine uses native PostgreSQL 16.13 installed at:

```text
D:\myTool\develop\PostgreSQL
```

## What Works Natively On Windows

- Node.js and pnpm: native Windows support.
- PostgreSQL: use the existing native binary install under `D:\myTool\develop\PostgreSQL`, or install PostgreSQL for Windows.
- Prisma: works on Windows with Prisma 7 and the PostgreSQL driver adapter.

## What Should Be Optional

Redis is not required for the first local MVP. Official Redis guidance for Windows typically uses Docker, WSL2, or a Redis-compatible Windows partner such as Memurai.

For local development, use:

```env
QUEUE_DRIVER="postgres"
```

This means generation jobs are stored and polled from PostgreSQL:

- `generation_jobs` is the durable job table.
- `generation_steps` records pipeline progress.
- Workers can claim queued jobs with row locking once worker code exists.

When the system needs higher throughput, switch to:

```env
QUEUE_DRIVER="redis"
REDIS_URL="redis://localhost:6379"
```

## Recommended Local Stack

Use this stack on Windows:

- Windows 10/11
- Node.js 22+
- pnpm 10+
- PostgreSQL 16.13 at `D:\myTool\develop\PostgreSQL`
- Prisma 7
- Redis optional
- Docker optional

## Current Database

The local database is:

```text
ai_novel_platform
```

The connection string expected by the project is:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
```

The initial Prisma migration has been applied to this database.

## Optional Docker Stack

If Docker Desktop is installed and WSL2 is enabled, the provided `docker-compose.yml` can start PostgreSQL and Redis:

```bash
pnpm dev:services
```

This is convenient for cross-platform development, but it is not required.
