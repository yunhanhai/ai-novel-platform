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
import { OutlinePanel } from "./outline-panel";
import type { JobSummary } from "./use-workspace-data";

type TabKey =
  | "ai" | "characters" | "world" | "threads" | "memories"
  | "style" | "methodology" | "versions" | "deslop" | "outline";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ai", label: "AI" },
  { key: "outline", label: "大纲" },
  { key: "versions", label: "版本" },
  { key: "deslop", label: "去 AI 味" },
  { key: "characters", label: "角色" },
  { key: "world", label: "世界" },
  { key: "threads", label: "伏笔" },
  { key: "memories", label: "记忆" },
  { key: "style", label: "风格" },
  { key: "methodology", label: "方法论" }
];

interface Props {
  projectId: string | null;
  chapterId: string | null;
  currentChapterText: string;
  onGenerate: () => void;
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
            isStarting={isStarting}
            job={job}
            error={jobError}
            canGenerate={canGenerate}
          />
        )}
        {active === "versions" && (
          <VersionsPanel chapterId={chapterId} onRestored={onChapterContentRefreshed} />
        )}
        {active === "outline" && <OutlinePanel projectId={projectId} />}
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
