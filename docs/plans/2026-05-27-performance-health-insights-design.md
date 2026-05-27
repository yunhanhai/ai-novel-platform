# Performance Health Insights Design

Date: 2026-05-27

## Goal

Turn performance trend data into actionable health insights so the organization overview can point out likely performance problems instead of only displaying raw metrics.

## Scope

In scope:

- Add `insights` to the `PerformanceTrends` DTO.
- Generate insights from existing totals, project rankings, latency samples, and cost fields.
- Display insights in the organization performance overview.
- Cover no-data, missing-cost, high-latency, high-token, and concentration-risk cases.

Out of scope:

- Persisting alerts.
- User-configurable thresholds.
- Real cost estimation when `estimatedCostCents` is missing.
- Automatic throttling or budget changes.

## Insight Rules

Rules are deterministic and lightweight:

- `no_data`: info, when `totals.calls === 0`.
- `missing_cost_data`: info, when there are calls but all cost values are null.
- `high_latency_project`: warning or critical when a project's P95 latency is high.
- `high_token_project`: warning or critical when a project uses many tokens in the selected window.
- `concentrated_usage`: warning when one project accounts for most calls.

The helper returns at most five insights, sorted by severity.

## UI

The `/projects` organization performance overview adds a `需要关注` section above rankings.

The section uses text-first rows:

- severity tag;
- concise title;
- short detail;
- optional metric text.

The UI follows the existing operational dashboard style: compact, accessible, stable dimensions, no decorative chart dependency.

## Testing

- Server helper tests cover each rule with deterministic fixture data.
- Web typecheck verifies the frontend DTO.
- Smoke e2e verifies the section renders on `/projects`.
