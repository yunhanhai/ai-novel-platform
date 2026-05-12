import type { PrismaClient } from "@ai-novel/db";
import { computeWordCount } from "@ai-novel/shared/generation/word-count";
import { createFakeModel } from "./fake-model";
import type { GenerationJob } from "../poll";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type FakeModel = ReturnType<typeof createFakeModel>;

type UpdateStatusFn = (params: {
  jobId: string;
  status: "SUCCEEDED" | "FAILED";
  output?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}) => Promise<unknown>;

interface HandlerDeps {
  prisma: PrismaClient;
  updateJobStatus: UpdateStatusFn;
  model?: FakeModel;
}

export function createDeslopHandler(deps: HandlerDeps) {
  const { prisma, updateJobStatus } = deps;
  const model = deps.model ?? createFakeModel();

  return async function handle(job: GenerationJob): Promise<void> {
    const chapterId = resolveChapterId(job);
    if (!chapterId) {
      await updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: "CHAPTER_NOT_FOUND", errorMessage: "无法解析 chapterId" });
      return;
    }

    const chapter = await prisma.chapter.findFirst({
      where: { id: chapterId, organizationId: job.organizationId, projectId: job.projectId, deletedAt: null },
      select: { id: true, content: true, title: true }
    });
    if (!chapter || !chapter.content) {
      await updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: "CHAPTER_NOT_FOUND", errorMessage: "章节不存在或正文为空" });
      return;
    }

    try {
      // 用 LLM 做深度去 AI 味分析
      const deslopPrompt = `你是严格的小说去 AI 味审查员。分析以下正文，找出所有 AI 写作痕迹。

正文：
${chapter.content.slice(0, 8000)}

以 JSON 格式输出分析报告：
{
  "issues": [
    {
      "category": "stock_phrase|weak_adverb|summary_sentence|abstract_noun_triple|repetition|passive_voice|telling_not_showing",
      "severity": "info|warning|error",
      "matched": "问题原文片段",
      "suggestion": "修改建议",
      "position": { "start": 0, "end": 0 }
    }
  ],
  "overallScore": 85,
  "summary": "整体评估（一句话）"
}

注意：position.start/end 为匹配文本在原文中的大致字符位置，如无法精确定位填 0。`;

      const result = await model.generate(deslopPrompt);
      const report = safeJson<{ issues: unknown[]; overallScore: number; summary: string }>(result.text, {
        issues: [], overallScore: 100, summary: "未检测到明显 AI 味"
      });

      await prisma.$transaction(async (tx: Tx) => {
        await tx.generationStep.create({
          data: {
            organizationId: job.organizationId,
            jobId: job.id,
            stepKey: "deslop_analyze",
            status: "SUCCEEDED",
            finishedAt: new Date(),
            outputPreview: report.summary,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens
          }
        });

        await tx.generationJob.update({
          where: { id: job.id },
          data: {
            status: "SUCCEEDED",
            progress: "100",
            finishedAt: new Date(),
            output: {
              chapterId: chapter.id,
              issueCount: report.issues.length,
              overallScore: report.overallScore,
              summary: report.summary
            }
          }
        });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "deslop failed";
      await updateJobStatus({ jobId: job.id, status: "FAILED", errorCode: "HANDLER_ERROR", errorMessage: message });
    }
  };
}

function resolveChapterId(job: GenerationJob): string | null {
  if (job.targetEntityType === "CHAPTER" && job.targetEntityId) return job.targetEntityId;
  const input = (job.input ?? {}) as { chapterId?: unknown };
  return typeof input.chapterId === "string" && input.chapterId.length > 0 ? input.chapterId : null;
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    return JSON.parse(match[0]) as T;
  } catch {
    return fallback;
  }
}
