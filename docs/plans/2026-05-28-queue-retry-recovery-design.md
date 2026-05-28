# Queue Retry And Recovery Design

## Goal

Make generation jobs recover from transient failures and expired worker leases instead of requiring manual database edits. The queue should distinguish normal backlog, retry delay, hard failure, and stuck running jobs.

## Current Context

The platform already has:

- `generation_jobs.status`
- `lock_key`
- `lease_expires_at`
- worker heartbeats
- queue observability totals and recent jobs

This is enough to see a problem, but not enough to recover from it. A failed model/network call becomes terminal immediately. A worker crash can leave a job in `RUNNING` until another claim path happens to consider the lease, and the UI cannot explain retry delay versus a real backlog.

## Recommended Approach

Add first-class retry metadata to `generation_jobs`:

- `attempt_count`
- `max_attempts`
- `next_run_at`

Keep the existing status enum. A retryable job stays in `QUEUED` with `next_run_at` in the future. This avoids introducing a new status that every existing status switch must understand. The queue API can derive "waiting retry" from `status = QUEUED AND next_run_at > now`.

For expired `RUNNING` leases, add a recovery helper that moves jobs whose lease is past due back to `QUEUED`, clears the lock, increments attempt count if appropriate, and schedules the next run. Worker startup or each poll tick can call this helper with a small batch limit.

## Retry Rules

Default job policy:

- `maxAttempts = 3`
- initial `attemptCount = 0`
- retry delay grows by attempt:
  - attempt 1: 10 seconds
  - attempt 2: 30 seconds
  - attempt 3: 2 minutes

Retryable examples:

- model adapter/network errors
- handler exceptions
- expired leases

Non-retryable examples:

- missing handler
- invalid input
- cancelled jobs

When a retry is scheduled:

- status becomes `QUEUED`
- `attemptCount` increments
- `nextRunAt` is set to `now + delay`
- `lockKey`, `leaseExpiresAt`, `startedAt` are cleared
- latest `errorCode` and `errorMessage` stay visible

When attempts are exhausted:

- status becomes `FAILED`
- `finishedAt` is set
- `errorCode` and `errorMessage` describe the last failure

## Claim Flow

`claimNextJob` should only claim queued jobs where:

- `nextRunAt` is null, or
- `nextRunAt <= now`

This keeps delayed retries out of the active work loop without adding another scheduler.

## Observability

`GET /api/queue-observability` should add:

- `totals.retrying`
- `oldestRetrying`
- retry fields on recent jobs

Health priority:

1. failed jobs
2. queued jobs with no online worker
3. expired/stale running jobs
4. retry backlog
5. ordinary backlog
6. active
7. idle

The UI should show "等待重试" as a derived queue bucket with the next retry age/time. It should stay compact and operational: small metrics, no decorative visuals, stable row heights, and clear labels.

## Testing

- DB helper tests cover retry scheduling, exhausted attempts, claim filtering, and lease recovery.
- Worker tests cover handler failure scheduling retries, no-handler hard failure, and recovery helper call during polling.
- Queue API tests cover retry counts and health state.
- UI model tests cover retry wait formatting and derived labels.
- E2E can keep checking the queue health panel exists; unit tests carry the retry semantics.

## Non-Goals

- No Redis/BullMQ migration in this slice.
- No user-facing manual retry button yet.
- No per-job custom retry policy UI.
- No destructive database reset in local validation.
