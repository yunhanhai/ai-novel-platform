"use client";

import { useEffect, useState } from "react";
import type { ContextOptions } from "@ai-novel/shared/context-composer/types";
import type { QualityMode } from "@ai-novel/shared/generation/performance";
import { useParams } from "next/navigation";
import { AssetSidebar } from "../../../../../components/workspace/asset-sidebar";
import { EditorPane } from "../../../../../components/workspace/editor-pane";
import { WorkspaceSideTabs } from "../../../../../components/workspace/workspace-side-tabs";
import {
  useChapters,
  useChapterContent,
  useJobPolling
} from "../../../../../components/workspace/use-workspace-data";

export default function WorkspacePage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId ?? null;

  const { chapters, isLoading: chaptersLoading, createChapter, reload: reloadChapters } = useChapters(projectId);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeChapterId && chapters.length > 0) {
      setActiveChapterId(chapters[0]!.id);
    }
  }, [chapters, activeChapterId]);

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);
  const { content, setContent, saveStatus, isLoadingContent, flush, reload: reloadContent } =
    useChapterContent(activeChapterId);
  const { job, startJob, isStarting, error: jobError } = useJobPolling();

  useEffect(() => {
    if (job?.status === "SUCCEEDED") {
      void reloadChapters();
      void reloadContent();
    }
  }, [job?.status, reloadChapters, reloadContent]);

  async function handleSelectChapter(id: string) {
    if (id === activeChapterId) return;
    await flush();
    setActiveChapterId(id);
  }

  async function handleGenerate(qualityMode: QualityMode, contextOptions?: ContextOptions) {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "GENERATE_CHAPTER", { qualityMode, contextOptions });
  }

  async function handleDiagnose(qualityMode: QualityMode) {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "DIAGNOSE_CHAPTER", { qualityMode });
  }

  async function handleDeslop() {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "DESLOP");
  }

  async function handleExtractMemory() {
    if (!activeChapterId) return;
    await flush();
    await startJob(activeChapterId, "EXTRACT_MEMORY");
  }

  return (
    <div className="workspace">
      <AssetSidebar
        chapters={chapters}
        activeChapterId={activeChapterId}
        onSelect={(id) => void handleSelectChapter(id)}
        onCreate={async (input) => {
          const created = await createChapter(input);
          if (created) setActiveChapterId(created.id);
        }}
        isLoading={chaptersLoading}
      />
      <EditorPane
        title={activeChapter?.title ?? "未选择章节"}
        content={content}
        onChange={setContent}
        saveStatus={saveStatus}
        isLoadingContent={isLoadingContent}
        disabled={!activeChapterId}
      />
      <WorkspaceSideTabs
        projectId={projectId}
        chapterId={activeChapterId}
        currentChapterText={content}
        onGenerate={handleGenerate}
        onDiagnose={handleDiagnose}
        onDeslop={handleDeslop}
        onExtractMemory={handleExtractMemory}
        isStarting={isStarting}
        job={job}
        jobError={jobError}
        canGenerate={Boolean(activeChapterId)}
        onChapterContentRefreshed={() => {
          void reloadContent();
          void reloadChapters();
        }}
      />
    </div>
  );
}
