# Context Composer Design

> Date: 2026-05-21
> Status: Approved for implementation

## Goal

Build a Context Composer for chapter generation. Before starting a generation job, the author can inspect which story assets will be used, understand why they were selected, adjust the one-off context for this run, and keep an audit trail on the generation job.

## Why This Is Next

The project already has the core local writing loop: chapter generation, DESLOP scanning, memory extraction, editable writing assets, style profiles, methodologies, and version tracking. The missing piece is transparency before generation. Today the system can assemble context, but the user cannot see or steer it from the workspace.

Context Composer makes generation more trustworthy without introducing vector search, graph databases, or new infrastructure.

## First Version Scope

The first implementation includes:

- Context preview API for a chapter.
- Workspace UI inside the existing AI panel.
- Grouped preview of included, trimmed, and available assets.
- One-off exclusions for included assets.
- One-off forced inclusions for available assets.
- Token budget presets: compact, standard, rich.
- Submission of `contextOptions` through generation job input.
- Job-level trace of the selected context options and the final context report.

The first implementation does not include:

- Persistent per-project context preferences.
- Drag-and-drop priority ordering.
- Semantic/vector retrieval.
- Automatic context quality scoring.
- Multiple saved context templates.

## Concepts

### Context Asset

A context asset is a story item that may be injected into the prompt. It has:

- `id`: stable item id for persisted resources, or a synthetic id for derived resources.
- `sourceType`: `character`, `world_item`, `plot_thread`, `memory`, `style`, or `methodology`.
- `name`: display name.
- `content`: formatted prompt text.
- `priority`: budget priority.
- `reason`: why it was selected or offered.
- `matchedKeywords`: keyword hits when available.
- `tokenEstimate`: estimated token cost.
- `required`: whether it cannot be excluded in the first version.

Style and methodology summary blocks remain required in version one. The user can inspect them, but not turn them off yet.

### Context Options

`contextOptions` is a one-off override stored in `GenerationJob.input`:

```ts
interface ContextOptions {
  budgetPreset?: "compact" | "standard" | "rich";
  excludedAssetIds?: string[];
  forcedAssetIds?: string[];
}
```

These settings apply only to the job being created. No schema migration is needed.

### Context Preview

The preview response contains:

```ts
interface ContextPreview {
  chapterId: string;
  projectId: string;
  budgetPreset: "compact" | "standard" | "rich";
  tokenBudget: number;
  estimatedTokens: number;
  included: ContextAsset[];
  trimmed: ContextAsset[];
  available: ContextAsset[];
  required: ContextAsset[];
  promptPreview: string;
  activationReport: unknown;
  warnings: string[];
}
```

`included` means selected and inside budget. `trimmed` means selected but removed by budget. `available` means valid project assets that were not selected, and can be forced into this run.

## Data Flow

1. The workspace AI panel loads a context preview for the active chapter.
2. The user changes the budget preset or toggles include/exclude controls.
3. The UI requests a fresh preview with those options.
4. When the user starts chapter generation, the UI sends `contextOptions` to `/api/generation-jobs`.
5. The route stores `contextOptions` in `GenerationJob.input`.
6. The worker reads `job.input.contextOptions`.
7. The worker builds the final context using the same composer logic.
8. The worker records a compact context summary in the job output when finalizing.

## Architecture

Shared context-composer types and pure helpers should live in `packages/shared` so web and worker can agree on the `contextOptions` contract. The first implementation can keep DB loading in the web and worker apps, but the pure shaping logic should be reusable and unit-tested.

The worker currently uses `runChapterPipeline` with a `buildContext` callback. This feature should preserve that boundary. The callback should call the Context Composer and return the final prompt plus report. Generation does not need a database migration because job input/output JSON fields already exist.

## UI Design

The UI belongs inside the existing workspace AI side panel, near the generate button. It should be compact and operational:

- A "Context" section with a refresh/preview button.
- A segmented budget control: compact, standard, rich.
- Summary counters: included, forced, excluded, trimmed, estimated tokens.
- Three grouped lists:
  - Included: checkboxes for optional assets.
  - Available: add buttons for force include.
  - Trimmed: read-only list with reason.
- A details disclosure for the prompt preview.
- Clear loading and error states.

Controls must stay usable on narrow screens. Text should wrap inside rows rather than stretch the panel.

## Error Handling

- Missing chapter: return 404.
- Chapter from another organization/project: return 404.
- Invalid `contextOptions`: return 400.
- Preview load failure: show an inline error and leave generation available with default context.
- Worker failure while composing context: fail the job with `HANDLER_ERROR`, preserving the existing failure path.

## Testing

Test layers:

- Shared helpers:
  - budget preset mapping
  - option normalization
  - excluded/forced asset behavior
  - token estimates
- Worker context builder:
  - applies exclusions
  - forces available assets into the final prompt
  - reports trimmed items
- Web API:
  - 404 when chapter is absent
  - 400 when options are invalid
  - returns grouped context preview
- Generation job API:
  - stores `contextOptions` in job input
- Workspace hook/UI:
  - sends options when starting generation
  - renders preview state

## Rollout Notes

This feature should be implemented in small TDD slices. The initial version should not alter database schema or introduce new dependencies. Real LLM behavior does not need to be tested; fake-model and unit tests are enough for this feature.
