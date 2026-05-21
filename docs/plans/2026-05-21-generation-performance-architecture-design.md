# Generation Performance Architecture Design

> Date: 2026-05-21
> Status: Approved for implementation

## Goal

Build a complete performance-first architecture for AI chapter generation. The system should keep the main writing path fast, move expensive quality checks into isolated diagnostic jobs, enforce explicit budgets, and expose metrics that make future optimization evidence-based.

## Why This Is Next

The project already has a working local writing loop: chapter generation, model routing, context composition, prompt snapshots, DESLOP, memory extraction, content versions, and job timelines. Borrowing richer ideas from Arboris, such as previews and reader simulation, is useful only if the platform can add them without making every chapter slower.

This design makes quality features scalable. Generation stays usable for fast drafting, while deeper diagnostics become asynchronous, budgeted, observable, and safe to retry.

## Principles

- The main generation path produces a usable chapter as quickly as possible.
- Expensive analysis runs after generation unless the user explicitly asks for deep mode.
- Diagnostics must fail independently from chapter persistence.
- Every model-backed step records tokens, latency, skip reason, and budget impact.
- Quality modes describe user intent; performance budgets enforce system limits.
- Context packets and diagnostic inputs should be reusable when the source data has not changed.
- The first implementation should reuse existing `GenerationJob.input`, `GenerationJob.output`, and `GenerationStep` fields where possible.

## Scope

The first complete architecture includes:

- Quality modes: `fast`, `balanced`, and `deep`.
- Performance budgets for model calls, token use, and wall-clock latency.
- A shared budget guard used by generation and diagnostic handlers.
- Job-level `performanceSummary` output.
- New async diagnostic job types:
  - `DIAGNOSE_CHAPTER`
  - `READER_SIMULATION`
  - `STYLE_DRIFT_CHECK`
  - `CONTINUITY_CHECK`
- Automatic child diagnostic enqueueing for `deep` chapter generation.
- Manual diagnostic job creation from the existing generation-jobs API.
- Diagnostic summaries stored in `GenerationJob.output`.
- Workspace UI that separates "chapter generated" from "diagnostics running".

The first architecture does not require:

- A vector database.
- A separate diagnostics table.
- Cross-worker distributed scheduling.
- Persistent context cache tables.
- A complex dependency graph between diagnostic jobs.

Those can be added later after metrics show they are worth the extra surface area.

## Concepts

### Quality Mode

`qualityMode` is a user-facing intent stored on `GenerationJob.input`:

```ts
type QualityMode = "fast" | "balanced" | "deep";
```

- `fast`: prioritize throughput. Skip non-essential review/revision and avoid automatic diagnostics.
- `balanced`: default. Preserve the current generation behavior and record budget metrics.
- `deep`: generate the chapter, then enqueue diagnostic jobs after the version is saved.

### Performance Budget

`performanceBudget` is a normalized guardrail stored on `GenerationJob.input`:

```ts
interface PerformanceBudget {
  maxModelCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxLatencyMs: number;
}
```

Each quality mode has defaults. A caller can request stricter limits, but the server clamps values to safe minimums and maximums.

Suggested defaults:

| Mode | Model calls | Input tokens | Output tokens | Latency |
| --- | ---: | ---: | ---: | ---: |
| `fast` | 3 | 12000 | 5000 | 60000 ms |
| `balanced` | 6 | 30000 | 10000 | 120000 ms |
| `deep` | 8 for generation, diagnostics have their own budgets | 45000 | 14000 | 180000 ms |

### Budget Guard

The worker wraps model-backed steps with a budget guard. Before a step runs, the guard checks whether another model call is allowed. After a step runs, it records observed tokens and latency. If the next optional step would exceed budget, the worker creates or updates that step as `SKIPPED` with a structured reason.

Critical steps should be rare and explicit. In chapter generation, `draft` is critical. Optional steps include `review`, `revise`, reader simulation, and most diagnostics.

### Performance Summary

Every completed job writes a compact summary to `GenerationJob.output`:

```ts
interface PerformanceSummary {
  qualityMode: QualityMode;
  budget: PerformanceBudget;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  skippedSteps: Array<{
    stepKey: string;
    reason: "quality_mode" | "budget_model_calls" | "budget_input_tokens" | "budget_output_tokens" | "budget_latency_ms" | "missing_input" | "not_applicable";
  }>;
}
```

This lets the UI and future tuning answer practical questions: which step cost the most, whether a job downgraded, and whether context size is the real bottleneck.

### Diagnostic Jobs

Diagnostics are normal generation jobs with `targetEntityType = CHAPTER`. They are processed by separate handlers and have isolated output schemas.

`DIAGNOSE_CHAPTER` is an umbrella job for a compact all-in-one analysis:

```ts
interface ChapterDiagnosticSummary {
  readerScore: number;
  abandonRisk: "low" | "medium" | "high";
  hookStrength: number;
  pacingScore: number;
  styleDrift: number;
  continuityIssues: Array<{ severity: "info" | "warning" | "error"; detail: string; suggestion?: string }>;
  suggestions: string[];
}
```

Specialized jobs can be added when a specific check needs a different model profile, prompt, or retry policy:

- `READER_SIMULATION`: reader satisfaction, hook strength, abandon risk.
- `STYLE_DRIFT_CHECK`: style profile adherence and AI-slop tendency.
- `CONTINUITY_CHECK`: world, timeline, character-state, and knowledge-boundary issues.

The first implementation can make `DIAGNOSE_CHAPTER` the default deep-mode child job and keep the specialized job types available for manual use or later UI expansion.

### Context Fingerprint

The worker computes a deterministic `contextFingerprint` for the context packet used by a job:

```ts
interface ContextFingerprint {
  hash: string;
  chapterId: string;
  contextOptionsHash: string;
  sourceUpdatedAt: string;
}
```

The hash is stored in job output with the prompt summary. Diagnostic jobs can use the latest saved chapter content and the latest context summary. In the first version this is not a persistent cache table; it is an audit and reuse hint. If repeated diagnostic cost becomes measurable, the hash can become a real cache key later.

## Data Flow

### Balanced Generation

1. Web creates `GENERATE_CHAPTER` with normalized `qualityMode = balanced`.
2. Worker composes context and initializes a budget guard.
3. Worker runs the existing plan, draft, review, optional revise, persist, and extract steps.
4. Worker records step metrics and skipped optional steps.
5. Worker completes the job with `versionId`, `versionNo`, `wordCount`, context summary, and performance summary.

### Fast Generation

1. Web creates `GENERATE_CHAPTER` with `qualityMode = fast`.
2. Worker runs context, plan, draft, persist, and extract.
3. Worker skips review/revise with reason `quality_mode`.
4. Output includes the same version fields plus a performance summary showing the skipped steps.

### Deep Generation

1. Web creates `GENERATE_CHAPTER` with `qualityMode = deep`.
2. Worker runs the balanced generation path under the deep budget.
3. After `persist_version` succeeds and the parent job succeeds, worker enqueues a child `DIAGNOSE_CHAPTER` job targeting the saved chapter.
4. UI can show the chapter as available while diagnostics are queued or running.
5. Diagnostic job writes its own output and performance summary.

## Database Strategy

Required first-version schema change:

- Add enum values to `GenerationJobType`:
  - `DIAGNOSE_CHAPTER`
  - `READER_SIMULATION`
  - `STYLE_DRIFT_CHECK`
  - `CONTINUITY_CHECK`

No table is required for diagnostic results yet. Store results in `GenerationJob.output` and rely on the existing job indexes by project, target entity, status, and created time.

Future migration option:

- Add `chapter_diagnostics` when users need long-term comparison, filtering, or pinned diagnostic snapshots independent from generation jobs.

## API Design

`POST /api/generation-jobs` accepts:

```ts
interface CreateGenerationJobBody {
  chapterId?: string;
  projectId?: string;
  jobType?: GenerationJobType;
  modelProfileId?: string;
  input?: Record<string, unknown>;
  contextOptions?: ContextOptions;
  qualityMode?: QualityMode;
  performanceBudget?: Partial<PerformanceBudget>;
}
```

The route:

- validates `jobType` against the allowed list;
- validates diagnostic jobs require a chapter target;
- normalizes `qualityMode`;
- normalizes and clamps `performanceBudget`;
- keeps `contextOptions` behavior unchanged;
- stores the normalized values inside `GenerationJob.input`.

`GET /api/generation-jobs` should return enough summary fields for the workspace to identify diagnostic jobs related to the current chapter.

`GET /api/generation-jobs/[id]` should include:

- steps;
- prompt snapshots when available;
- `performanceSummary`;
- diagnostic output when available.

## Worker Design

Shared worker helpers:

- `performance/types.ts`: quality mode, budget, skip reason, summary types.
- `performance/budget.ts`: normalization, clamping, defaults, guard state.
- `performance/budget.test.ts`: pure tests for defaults, clamps, allowance, recording, and summaries.

Generation handler changes:

- read normalized quality/performance input;
- pass guard into `runChapterPipeline`;
- make review/revise optional under `fast`;
- preserve current behavior under `balanced`;
- record summary on success and on handled failures where possible;
- enqueue `DIAGNOSE_CHAPTER` after a successful `deep` generation.

Diagnostic handler:

- load chapter and project context;
- create one or more diagnostic steps;
- run model prompt for a compact JSON diagnosis;
- parse defensively with a fallback summary;
- complete the diagnostic job with `diagnosticSummary` and `performanceSummary`.

Worker registration:

- register handlers for new diagnostic job types in `apps/worker/src/index.ts`;
- reuse model resolution and fake-model fallback.

## UI Design

Workspace AI panel should show:

- quality mode selector near generate controls;
- optional "Run diagnostics" command for the selected chapter;
- parent generation status separate from latest diagnostic status;
- performance summary chips: calls, tokens, latency, skipped count;
- diagnostic summary when available.

The UI should keep the existing chapter writing flow intact. Diagnostics are additive and should not block editing, DESLOP, memory extraction, or moving to the next chapter.

## Failure Handling

- If `draft` fails, the parent generation job fails.
- If optional review/revise exceeds budget, those steps are skipped and generation continues.
- If deep-mode child enqueue fails after the chapter is saved, the parent job still succeeds and records a warning in output.
- If a diagnostic job fails, only that diagnostic job fails.
- If diagnostic JSON parsing fails, the handler returns a degraded summary rather than crashing when possible.
- If a new diagnostic job type has no handler, existing no-handler failure behavior applies.

## Testing

Test layers:

- Shared performance helpers:
  - quality mode defaults;
  - budget normalization and clamping;
  - budget guard allowance and skip reasons;
  - summary accumulation.
- Web API:
  - accepts and normalizes `qualityMode`;
  - rejects invalid mode;
  - clamps custom budget;
  - allows diagnostic job types;
  - rejects diagnostic jobs without chapter targets.
- Worker pipeline:
  - fast mode skips review/revise;
  - balanced mode preserves current review behavior;
  - budget exhaustion skips optional steps;
  - output contains `performanceSummary`.
- Worker diagnostic handler:
  - missing chapter fails cleanly;
  - valid chapter produces `diagnosticSummary`;
  - malformed model output falls back safely;
  - budget summary is recorded.
- Worker index:
  - registers new diagnostic handlers.
- UI:
  - sends selected quality mode;
  - renders generation and diagnostic statuses separately;
  - renders performance summary.

## Rollout

1. Add shared performance contract and worker budget guard.
2. Add quality mode support to chapter generation.
3. Add job type enum migration and API validation.
4. Add diagnostic handler and worker registration.
5. Add deep-mode child enqueueing.
6. Add workspace UI controls and summaries.
7. Run full tests, typecheck, and a fake-model end-to-end loop.

This order keeps the main writing path safe while gradually introducing the complete architecture.
