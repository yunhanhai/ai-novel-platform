# Queue Observability Design

> Date: 2026-05-28

## Goal

Add an organization-level queue health panel on `/projects` so local development can quickly answer whether generation jobs are waiting, running, succeeding, or failing.

## Scope

This first version uses existing `generation_jobs` data only. It does not add a worker heartbeat table yet. That keeps the feature small and immediately useful for diagnosing stuck `QUEUED` jobs while preserving a clean path to add true worker liveness later.

## Data Model

The backend aggregates jobs for the current organization:

- status counts for `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `CANCELLED`
- oldest queued job wait time
- running jobs count
- recent jobs with id, type, status, project id, target entity, timestamps, and error summary

The summary should be deterministic and safe when there are no jobs.

## UI Direction

Use an operational dashboard style following `ui-ux-pro-max` guidance:

- compact metric tiles with stable dimensions
- clear status colors and readable contrast
- a short recent-job list for scanning
- reserved loading and empty states to avoid layout jumps
- no decorative backgrounds, oversized hero treatment, or chart dependency

## Error Handling

The API returns structured errors through the existing `success/error` envelope. The UI displays a compact inline error with a retry button.

## Future Extension

A later phase can add `worker_heartbeats` or a similar runtime table written by the worker process. That will allow the same panel to distinguish "queue is idle" from "worker is offline".
