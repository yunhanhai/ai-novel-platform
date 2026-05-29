# Queue Recovery Actions Design

## Goal

Add a small, non-destructive operational loop to the queue panel so an operator can recover known-safe queue problems without editing the database directly.

## Scope

This phase adds two actions:

- Retry a failed generation job by moving it back to the ready `QUEUED` state.
- Recover expired running leases for the current organization on demand.

This phase intentionally does not add cancellation, deletion, force-success, or arbitrary status edits. Those actions are more destructive and need a separate audit and permission design.

## Current State

The queue already has automatic retry and lease recovery:

- Worker failures are retried while attempts remain.
- Expired leases are recovered before worker polling claims new work.
- Queue observability exposes queued, retrying, running, failed, and worker heartbeat state.

The gap is manual intervention: if a job has become `FAILED`, or if the operator wants to trigger lease recovery before the next worker poll, the UI has no safe action path.

## Proposed Approach

Add focused server actions backed by DB helpers:

- `retryFailedJob({ organizationId, jobId })`
  - Finds the job inside the current organization.
  - Allows only `FAILED`.
  - Resets `status` to `QUEUED`, `progress` to `0`, clears final error/lease/timing fields, keeps historical `attemptCount`, and sets `nextRunAt` to `null`.
  - Returns a typed result instead of throwing for invalid state.
- `recoverExpiredJobLeases({ organizationId })`
  - Reuse the existing DB helper.
  - Expose it through a queue route action for manual recovery.

API shape:

- `POST /api/generation-jobs/[id]` with `{ "action": "retry" }`
- `POST /api/queue-observability` with `{ "action": "recover-expired-leases" }`

Both routes use the current organization context, return structured JSON, and avoid leaking cross-organization job existence.

UI shape:

- Keep actions inside the existing `队列健康` panel.
- Add a compact operation strip near the header with `回收过期租约`.
- Add `重试` only on recent rows that are truly failed.
- Disable buttons while an operation is running, then refresh queue observability.
- Show inline operation errors in the same panel.

## Alternatives Considered

1. Add a full queue admin page.
   - More room for audit details, but too large for the current phase.
2. Add all lifecycle actions at once.
   - Useful later, but deletion/cancel/force-reset need stronger safeguards.
3. Only expose recovery API without UI.
   - Faster, but less useful for local operation and harder to discover.

The selected approach is intentionally narrow and practical.

## Testing

- DB tests cover retrying failed jobs, invalid statuses, not-found jobs, and organization scoping.
- Route tests cover success, invalid action, invalid state, not-found, and structured errors.
- UI model tests cover which rows are actionable and operation copy.
- Existing queue observability tests remain unchanged except type factories if needed.

## Risks

- Retrying a failed job reuses the original input and target entity. This is desired for recovery, but users should still inspect repeated failures in the recent job list.
- Keeping `attemptCount` preserves history, but worker retry exhaustion logic may fail the job faster if it fails again. That is acceptable for an operator retry; a later "reset attempts" action can be explicit if needed.
