# Performance Trends Observability Design

Date: 2026-05-25

## Goal

Add a performance trends view that turns durable `usage_events` records into actionable generation observability.

The first UI surface is project-scoped: a new workspace side tab for the current project. The backend aggregation is scope-aware from day one, so the same service can later power an organization-wide performance overview without duplicating query logic.

## Scope

In scope:

- Aggregate usage trends for the current organization.
- Support project-level scope when `projectId` is provided.
- Support organization-level scope when `projectId` is omitted.
- Expose project trends through a workspace API.
- Expose organization trends through a reusable API for future UI work.
- Add a compact workspace performance panel for the current project.
- Cover empty states, sparse latency data, and authorization.

Out of scope for this batch:

- Cost calculation beyond existing `estimatedCostCents` rollups.
- Budget enforcement, throttling, or automatic model switching.
- Organization dashboard UI.
- Realtime streaming charts.

## Architecture

Create a server helper in `apps/web/src/server/performance-trends.ts`.

The helper accepts:

- `organizationId`
- optional `projectId`
- `window`: `7d` or `30d`
- optional `now` for deterministic tests

It reads from `usage_events`, joins `generationJob` only for job type distribution, and returns a normalized DTO. Project-level requests filter by both `organizationId` and `projectId`; organization-level requests filter only by `organizationId`.

The helper is the source of truth for both APIs:

- `GET /api/projects/[projectId]/performance-trends?window=7d|30d`
- `GET /api/performance-trends?window=7d|30d`

The project route validates that the project belongs to the current user's organization before returning data. The organization route only returns records for the current organization.

## Data Shape

Return a compact DTO:

```ts
interface PerformanceTrends {
  scope: "project" | "organization";
  window: "7d" | "30d";
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencySamples: number;
    averageLatencyMs: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    estimatedCostCents: number | null;
  };
  daily: Array<{
    date: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    averageLatencyMs: number | null;
  }>;
  byModel: Array<{
    modelName: string;
    calls: number;
    totalTokens: number;
    averageLatencyMs: number | null;
  }>;
  byProvider: Array<{
    providerId: string | null;
    providerName: string | null;
    calls: number;
    totalTokens: number;
  }>;
  byBillingSource: Array<{
    billingSource: string;
    calls: number;
    totalTokens: number;
  }>;
  byJobType: Array<{
    jobType: string;
    calls: number;
    totalTokens: number;
  }>;
}
```

Empty datasets return zero totals and prefilled daily buckets for the selected window.

Latency percentiles ignore rows where `latencyMs` is null. Token totals still include those rows. `estimatedCostCents` is `null` if no event has a cost value; otherwise it is the sum of non-null cost values.

## Workspace UI

Add a `PerformancePanel` component and a new `性能` tab in `WorkspaceSideTabs`.

The panel uses a quiet, operational dashboard style:

- a 7 day / 30 day segmented control;
- four stable metric tiles: calls, total tokens, average latency, p95 latency;
- a compact daily trend section using fixed-height rows or lightweight bars;
- model and provider distribution lists;
- job type distribution list;
- clear loading, error, and empty states.

UI/UX constraints from `ui-ux-pro-max`:

- Keep text readable with strong contrast and visible focus states.
- Keep interactive targets at least 44px high where practical.
- Reserve stable dimensions for async content to avoid layout jumps.
- Prefer dense but organized dashboard layout over marketing-style cards.
- Avoid single-hue decorative palettes and avoid decorative gradient backgrounds.
- Provide table/list alternatives rather than relying only on chart color.
- Keep labels short and scannable in Chinese.

## Data Flow

1. Workspace receives `projectId`.
2. `PerformancePanel` fetches `/api/projects/:projectId/performance-trends`.
3. User changes the window segment.
4. Panel refetches the selected window.
5. API delegates to `getPerformanceTrends`.
6. Helper returns normalized buckets and distributions.
7. UI renders stable metrics and lists.

The organization route uses the same helper without `projectId`. It is implemented and tested now, but no organization UI is added in this batch.

## Errors And Edge Cases

- Unknown or missing project returns `404`.
- Project outside the current organization returns `404` to avoid leaking existence.
- Invalid `window` returns `400`.
- Empty data returns `200` with zero totals and empty distributions.
- Null latency values are excluded from latency calculations.
- Failed API fetch shows an inline retry action in the panel.

## Testing

Server helper tests:

- empty project data;
- project scope filters correctly;
- organization scope includes all organization projects;
- 7 day and 30 day bucket boundaries;
- p50 and p95 latency calculations;
- model, provider, billing source, and job type distributions;
- null latency and null cost handling.

API route tests:

- authenticated project request succeeds;
- invalid window fails;
- missing or cross-organization project returns `404`;
- organization route returns organization-scoped data.

Frontend tests:

- panel renders empty state;
- panel renders totals and distributions;
- changing the window refetches data;
- error state exposes retry.

Optional e2e:

- workspace opens the `性能` tab in fake-model mode and shows either empty or populated trend scaffolding.

## Rollout Notes

This feature depends on the existing worker-side usage recording. Fake-model runs may have sparse or zero usage data unless tests seed `usage_events` directly.

Before implementation starts, commit the current context fingerprint batch so the performance trend work begins from a clean local boundary.
