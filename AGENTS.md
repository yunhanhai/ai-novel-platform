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
pnpm test          # vitest, 5 packages (db / shared / model-adapters / worker / web)
pnpm test:e2e      # Playwright smoke + settings (auto-starts web + worker via globalSetup)
pnpm typecheck
pnpm eval:mine     # eval foundation: mine revision pairs + text metrics from the DB (read-only)
pnpm dev:web                       # terminal 1
cd apps/worker && pnpm dev         # terminal 2 (only needed for manual dev — test:e2e starts its own worker)
```

Start PostgreSQL manually after reboot if needed:

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' -D 'D:\myTool\develop\PostgreSQL\data' -l 'D:\myTool\develop\PostgreSQL\data' start
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

## Architecture Facts (established — do not regress)

These are load-bearing decisions made in later sessions. Any new code must respect them:

- **API identity comes from the session cookie**, not from `DEFAULT_ORGANIZATION_ID/USER_ID` env. Those env vars are seed-only (plus the starter-asset clone source for new registrations). `apps/web/src/proxy.ts` gates every `/api/**` except `/api/auth/*` with 401 before route handlers run.
- **13 job types** are handler-backed (generate/continue/batch-continue/rewrite/polish/review/deslop/extract-memory/4 diagnostics/outline). `SUPPORTED_JOB_TYPES` in the API mirrors `apps/worker/src/handlers.ts` — keep both in sync when adding a type.
- **Manual chapter saves write MANUAL content_versions** when the edit is ≥10% different from the previous version AND ≥10 minutes have passed (throttle), capped at 100/chapter. This feeds the eval revision-pair mining. Do not remove without replacing the evidence source.
- **Batch continue (BATCH_CONTINUE)** re-reads the chapter before each round, finalizes each chapter independently, extracts memories after each round (toggleable via `input.extractMemory`), and checks for user cancellation before every round.
- **Config-class model errors (401/402/404/baseURL) finalize immediately** with a Chinese troubleshooting message — they are never retried. Only transient classes (429/timeout/5xx/unknown) use the exponential-backoff retry.
- **Token estimation is CJK-aware** (`@ai-novel/shared/generation/token-estimate`): 1 token per CJK char/punctuation, 4 chars per token otherwise. All estimators delegate to it.
- **All pipeline prompts are Chinese** (Chinese web-novel target). A regression test asserts no "You are" openers in the chapter pipeline.
- **Eval foundation**: deterministic metrics + LCS diff + `pnpm eval:mine` mining (see `docs/eval/`) and the pairwise judge with swap test (`apps/worker/src/eval/judge.ts`). Real scoring needs a real model key.

## Model Mode Switch

The `.env` flag `USE_FAKE_MODEL` controls whether worker generates real LLM output:

- `USE_FAKE_MODEL="true"` (default for local dev): worker injects `createFakeModel()` as `deps.model`. Jobs always SUCCEEDED with placeholder text, no LLM cost. Use for UI/flow verification.
- `USE_FAKE_MODEL="false"` (real LLM): requires a resolvable `ModelProfile` and a valid provider key encrypted into `model_providers.encrypted_api_key` (needs the 64-hex `ENCRYPTION_KEY`). Missing any → FAILED with a Chinese troubleshooting message.

After switching the flag, restart `apps/worker` (it reads env at boot).

Full setup + acceptance walkthrough: **`docs/real-model-onboarding.md`**.

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
- Do not commit files containing user prose (`.eval-out/` datasets stay ignored).
- Reuse `ai_novel_platform` unless the user asks for a separate database.
- If temporary branches are used, merge them back promptly after use and record the branch purpose and merge result in the session progress notes.
