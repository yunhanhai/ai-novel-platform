"use client";

import { useState } from "react";
import { AiPanel } from "./ai-panel";
import { StyleProfilePanel } from "./style-profile-panel";
import { MethodologyPanel } from "./methodology-panel";
import { CharactersPanel } from "./characters-panel";
import { WorldItemsPanel } from "./world-items-panel";
import { PlotThreadsPanel } from "./plot-threads-panel";
import { MemoriesPanel } from "./memories-panel";
import { VersionsPanel } from "./versions-panel";
import { DeslopPanel } from "./deslop-panel";
import { ReviewPanel } from "./review-panel";
import { StatsPanel } from "./stats-panel";
import { ProjectInfoPanel } from "./project-info-panel";
import { OutlinePanel } from "./outline-panel";
import type { JobSummary } from "./use-workspace-data";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";

type TabKey =
  | "ai" | "characters" | "world" | "threads" | "memories"
  | "style" | "methodology" | "versions" | "deslop" | "outline" | "review" | "stats" | "project";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ai", label: "AI" },
  { key: "outline", label: "大纲" },
  { key: "versions", label: "版本" },
  { key: "review", label: "审校" },
  { key: "deslop", label: "去 AI 味" },
  { key: "stats", label: "统计" },
  { key: "project", label: "作品" },
  { key: "characters", label: "角色" },
  { key: "world", label: "世界观" },
  { key: "threads", label: "伏笔" },
  { key: "memories", label: "记忆" },
  { key: "style", label: "文风" },
  { key: "methodology", label: "方法论" }
];

interface Props {
  projectId: string | null;
  chapterId: string | null;
  currentChapterText: string;
  onGenerate: (qualityMode: QualityMode, contextOptions?: ContextOptions) => void;
  onDiagnose: (qualityMode: QualityMode) => void;
  onContinue: () => void;
  onBatchContinue: (chapterCount: number, extractMemory: boolean) => void;
  onStopJob: () => void;
  stopping: boolean;
  onReview: () => void;
  onGenerateOutline: (chapterCount: number) => void;
  onApplyReviewReplacement: (quote: string, replacement: string) => boolean;
  onDeslop: () => void;
  onExtractMemory: () => void;
  isStarting: boolean;
  job: JobSummary | null;
  jobError: string | null;
  canGenerate: boolean;
  onChapterContentRefreshed?: () => void;
}

export function WorkspaceSideTabs({
  projectId,
  chapterId,
  currentChapterText,
  onGenerate,
  onDiagnose,
  onContinue,
  onBatchContinue,
  onStopJob,
  stopping,
  onReview,
  onGenerateOutline,
  onApplyReviewReplacement,
  onDeslop,
  onExtractMemory,
  isStarting,
  job,
  jobError,
  canGenerate,
  onChapterContentRefreshed
}: Props) {
  const [active, setActive] = useState<TabKey>("ai");

  return (
    <aside className="pane pane-muted side-tabs" aria-label="工作台侧栏">
      <nav className="side-tabs-nav side-tabs-nav-scroll" role="tablist" aria-label="工作台标签">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            className={`side-tab ${active === t.key ? "active" : ""}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="side-tab-body" role="tabpanel">
        {active === "ai" && (
          <AiPanel
            onGenerate={onGenerate}
            onDiagnose={onDiagnose}
            onContinue={onContinue}
            onBatchContinue={onBatchContinue}
            onStopJob={onStopJob}
            stopping={stopping}
            onDeslop={onDeslop}
            onExtractMemory={onExtractMemory}
            isStarting={isStarting}
            job={job}
            error={jobError}
            canGenerate={canGenerate}
            chapterId={chapterId}
          />
        )}
        {active === "versions" && (
          <VersionsPanel chapterId={chapterId} onRestored={onChapterContentRefreshed} />
        )}
        {active === "outline" && (
          <OutlinePanel projectId={projectId} job={job} isStarting={isStarting} onGenerateOutline={onGenerateOutline} />
        )}
        {active === "stats" && <StatsPanel projectId={projectId} />}
        {active === "project" && <ProjectInfoPanel projectId={projectId} />}
        {active === "review" && (
          <ReviewPanel
            chapterId={chapterId}
            chapterContent={currentChapterText}
            job={job}
            onRun={onReview}
            isStarting={isStarting}
            onApplyReplacement={onApplyReviewReplacement}
          />
        )}
        {active === "deslop" && (
          <DeslopPanel
            projectId={projectId}
            currentText={currentChapterText}
            chapterId={chapterId}
            onApplied={onChapterContentRefreshed}
          />
        )}
        {active === "characters" && <CharactersPanel projectId={projectId} />}
        {active === "world" && <WorldItemsPanel projectId={projectId} />}
        {active === "threads" && <PlotThreadsPanel projectId={projectId} />}
        {active === "memories" && <MemoriesPanel projectId={projectId} />}
        {active === "style" && <StyleProfilePanel projectId={projectId} />}
        {active === "methodology" && <MethodologyPanel projectId={projectId} />}
      </div>
    </aside>
  );
}
