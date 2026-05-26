# Organization Performance Overview Design

Date: 2026-05-27

## Goal

Add an organization-wide performance overview to the projects page so local development can inspect all projects together, not only the active workspace project.

The backend route already exists at `GET /api/performance-trends`. This batch adds the first UI surface for it.

## Scope

In scope:

- Add a compact `全部项目性能` overview to `/projects`.
- Fetch organization-scoped trends from `/api/performance-trends?window=7d|30d`.
- Reuse the existing performance trend DTO and formatting conventions.
- Show totals, daily trend rows, model distribution, provider distribution, and job type distribution.
- Support loading, error, retry, and empty states.
- Extend smoke e2e to verify the overview appears after registration redirects to `/projects`.

Out of scope:

- Cost forecasting.
- Per-project ranking, because the current API does not yet return project breakdowns.
- Dedicated analytics route.
- Quotas, alerts, throttling, or automatic model switching.

## Placement

Place the overview on `/projects`, directly below the page header and above the project list.

This page is the natural organization-level landing point. Users arrive here after login/register and before opening a specific project, so it is the right place to answer: "How is the whole writing system performing recently?"

## UI

Create a client component:

```txt
apps/web/src/components/projects/organization-performance-overview.tsx
```

The panel should include:

- `7 天 / 30 天` segmented control.
- Four metric tiles: calls, total tokens, average latency, p95 latency.
- Daily trend rows using lightweight CSS bars.
- Three compact breakdown lists: models, providers, job types.
- Empty state when there are no usage events.
- Retry button on fetch failure.

UI rules from `ui-ux-pro-max`:

- Keep the dashboard dense and scannable.
- Use stable metric/timeline dimensions to avoid content jumping.
- Keep controls keyboard-visible and touch targets practical.
- Do not introduce decorative gradients or a charting dependency.
- Make the information readable as text/lists, not only by color.

## Data Flow

1. `ProjectsPage` renders `OrganizationPerformanceOverview`.
2. The component defaults to `30d`.
3. It fetches `/api/performance-trends?window=30d`.
4. The user can switch to `7d`, triggering a refetch.
5. The component renders the same high-level DTO used by the workspace project panel.

## Testing

Unit tests:

- Add pure view-model tests for selecting max daily calls and determining empty state.
- Keep formatting tests covered by the existing workspace performance format tests.

E2E:

- After registration redirects to `/projects`, assert `全部项目性能` is visible.
- Assert either `.organization-performance-overview` metrics or an empty-state scaffold is visible.

## Rollout Notes

Fake-model local runs can produce sparse usage data. The UI should still render useful structure with zeros or an empty state.

Future work can add project-level ranking by extending the existing `getPerformanceTrends` helper to include `byProject`.
