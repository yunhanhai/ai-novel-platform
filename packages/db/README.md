# Database Package

This package owns the first PostgreSQL schema for the AI novel platform.

## Chosen ORM

The first version uses Prisma because the project needs clear relational modeling, generated TypeScript types, and a migration workflow that is easy for a small SaaS team to maintain.

## Included Domains

The initial schema covers:

- Accounts: `users`, `user_identities`
- Organizations: `organizations`, `organization_members`, `invitations`
- Projects: `projects`, `project_members`
- Writing structure: `volumes`, `chapters`, `outlines`, `content_versions`
- AI configuration: `model_providers`, `model_profiles`, `prompt_templates`
- Generation jobs: `generation_jobs`, `generation_steps`
- Usage and audit: `usage_events`, `audit_logs`

Later schema phases should add the richer writing asset tables from the design document: `characters`, `character_relationships`, `world_items`, `plot_threads`, and `project_memories`.

## Commands

Run from the repository root:

```bash
pnpm db:validate
pnpm db:format
pnpm db:generate
pnpm db:diff
pnpm db:migrate
```

`pnpm db:migration:initial` regenerates the initial SQL migration at:

```text
packages/db/prisma/migrations/202604290001_initial_core/migration.sql
```

## Environment

Prisma 7 loads database configuration from `packages/db/prisma.config.ts`. The config reads root `.env` first and falls back to `.env.example` for local validation.

For Windows-first local development, this machine uses PostgreSQL 16.13 at:

```text
D:\myTool\develop\PostgreSQL
```

Keep:

```env
QUEUE_DRIVER="postgres"
```

Redis is optional for the first MVP.

The project database is `ai_novel_platform`, and the initial migration `202604290001_initial_core` has already been applied locally.
