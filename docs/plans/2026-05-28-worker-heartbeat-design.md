# Worker Heartbeat Design

## Goal

Expose real worker liveness in the queue observability surface so queued jobs can be diagnosed as either normal backlog or no available worker capacity.

## Recommended Approach

Use a database-backed `worker_heartbeats` table keyed by `lock_key`. Each worker writes one heartbeat immediately at startup and refreshes it on a short interval while the process is alive. The queue observability API reads recent heartbeats for the organization and classifies them as online or stale using a server-side threshold.

This is more reliable than local process inspection because it works the same in local development, containers, and future multi-host deployments. It is also clearer than inferring liveness from generation job leases, because a worker can be healthy even when no job is currently running.

## Data Model

`worker_heartbeats` stores:

- `id`
- `organization_id`
- `lock_key`
- `pid`
- `started_at`
- `last_seen_at`
- `poll_interval_ms`
- `lease_duration_ms`
- `last_tick_status`
- `last_tick_at`
- `metadata`

`lock_key` is unique so a worker process updates the same row for its lifetime. Old rows are retained as stale records for diagnosis.

## Runtime Flow

1. Worker builds its existing `LOCK_KEY`.
2. Worker starts a heartbeat loop with the same `organizationId`, `pollIntervalMs`, and `leaseDurationMs` values used by the poller.
3. The loop writes immediately, then every 10 seconds by default.
4. The poller reports each tick result into the heartbeat loop.
5. Shutdown aborts both poller and heartbeat loop.

Heartbeat failures should be logged, but they should not crash generation work.

## API Flow

`GET /api/queue-observability` keeps the existing queue fields and adds:

- `workers.total`
- `workers.online`
- `workers.stale`
- `workers.latestHeartbeatMs`
- `workers.items[]`

The API considers workers online when `lastSeenAt` is within 30 seconds of `generatedAt`. If there are queued jobs and no online workers, health becomes `attention` with a clear "Worker 离线" diagnosis before ordinary backlog classification.

## UI

The existing `队列健康` panel gains a compact worker section:

- summary metric for online worker count
- latest heartbeat age
- small list of recent workers with online/stale status, pid, poll interval, and last tick

Following `ui-ux-pro-max`, the panel remains operational and scannable: restrained colors, stable row heights, accessible labels, no decorative backgrounds, and responsive layout that does not overflow on mobile.

## Testing

- DB helper tests verify upsert and listing query shape.
- Worker heartbeat tests verify immediate write, periodic refresh, non-crashing error handling, and tick status reporting.
- Queue observability tests verify worker aggregation and queued-without-worker attention state.
- UI model tests verify heartbeat age and worker status labels.
- Existing web/worker/db test suites and typecheck cover integration.
