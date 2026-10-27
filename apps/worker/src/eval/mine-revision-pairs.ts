// 评测基座第一步：从真实数据挖掘「AI 产物 vs 作者改版」配对。
//
// 数据来源（全部来自运行中的数据库，不是人造测试集）：
//   A. revision pairs —— 每章「AI 版本」与其后最近的「MANUAL 版本」配对。
//      MANUAL 版本由手动保存自动产生（大幅修改 + 节流后才写），
//      代表"AI 写完、作者改后的阶段性成果"——真实的修订证据链。
//   B. rejected chapters —— 有版本记录但已被软删除的章节：AI 产物被直接否定的负样本。
//   C. AI version corpus —— 未删除章节的全部 AI 版本，用于计算确定性文本指标基线。
//
// 输出：
//   - 聚合报告（可进 git）：docs/eval/baseline-YYYY-MM-DD.md，只含统计数字，不含正文。
//   - 明细数据集（不进 git）：.eval-out/dataset-YYYY-MM-DD.json，含正文，供本地挑选 golden set。
//
// 运行：pnpm eval:mine（或 cd apps/worker && pnpm eval:mine）

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@ai-novel/db";
import { aggregateMetrics, computeTextMetrics, type TextMetrics } from "@ai-novel/shared/eval/metrics";
import { diffText, summarizeDiff } from "@ai-novel/shared/eval/text-diff";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const today = new Date().toISOString().slice(0, 10);

interface RevisionPair {
  chapterId: string;
  chapterNo: number;
  title: string;
  versionNo: number;
  versionChars: number;
  currentChars: number;
  addedChars: number;
  removedChars: number;
  /** 修改幅度 = (增+删) / 版本长度，0~2+ */
  editRatio: number;
  versionMetrics: TextMetrics;
  currentMetrics: TextMetrics;
}

interface Dataset {
  generatedAt: string;
  counts: {
    chaptersWithVersions: number;
    totalVersions: number;
    revisionPairs: number;
    rejectedChapters: number;
    corpusVersions: number;
  };
  revisionPairs: RevisionPair[];
  corpusMetrics: TextMetrics[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round(n: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

async function main(): Promise<void> {
  console.log("[eval:mine] 开始挖掘…");

  const versions = await prisma.contentVersion.findMany({
    where: { entityType: "CHAPTER" },
    orderBy: [{ entityId: "asc" }, { versionNo: "desc" }],
    select: {
      id: true,
      entityId: true,
      versionNo: true,
      source: true,
      content: true
    }
  });

  if (versions.length === 0) {
    console.log("[eval:mine] 数据库中没有章节版本记录，无可挖素材。");
    return;
  }

  const chapterIds = [...new Set(versions.map((v) => v.entityId))];
  const chapters = await prisma.chapter.findMany({
    where: { id: { in: chapterIds } },
    select: {
      id: true,
      chapterNo: true,
      title: true,
      content: true,
      deletedAt: true
    }
  });
  const chapterById = new Map(chapters.map((c) => [c.id, c]));

  // 按章分组、按 versionNo 升序扫描，配对「AI 版本 → 其后最近的 MANUAL 版本」。
  // 手动保存会写 MANUAL 快照（差异 ≥10% 且节流 ≥10 分钟），所以这个证据链
  // 会随真实使用自动积累。同一章若出现多个 AI 版本，只保留最近的待配对。
  const versionsByChapter = new Map<string, typeof versions>();
  for (const version of [...versions].sort((a, b) => a.versionNo - b.versionNo)) {
    const list = versionsByChapter.get(version.entityId) ?? [];
    list.push(version);
    versionsByChapter.set(version.entityId, list);
  }

  const revisionPairs: RevisionPair[] = [];
  const corpusMetrics: TextMetrics[] = [];
  let rejectedChapters = 0;

  for (const [chapterId, chapterVersions] of versionsByChapter) {
    const chapter = chapterById.get(chapterId);
    if (!chapter) continue;

    if (chapter.deletedAt) {
      rejectedChapters += 1;
      continue; // 负样本：被否定的产物不进语料，只计数（正文保留在明细数据集中）
    }

    let pendingAI: (typeof chapterVersions)[number] | null = null;
    for (const version of chapterVersions) {
      if (version.source === "MANUAL") {
        if (!pendingAI) continue; // 没有前置 AI 版本的 MANUAL（如回滚前的快照）暂不配对

        const aiContent = pendingAI.content ?? "";
        const manualContent = version.content ?? "";
        if (aiContent.length > 0 && manualContent.length > 0 && aiContent !== manualContent) {
          const segments = diffText(aiContent, manualContent);
          const summary = summarizeDiff(segments);
          const denom = Math.max(aiContent.length, 1);
          revisionPairs.push({
            chapterId,
            chapterNo: chapter.chapterNo,
            title: chapter.title,
            versionNo: pendingAI.versionNo,
            versionChars: aiContent.length,
            currentChars: manualContent.length,
            addedChars: summary.addedChars,
            removedChars: summary.removedChars,
            editRatio: round((summary.addedChars + summary.removedChars) / denom, 3),
            versionMetrics: computeTextMetrics(aiContent),
            currentMetrics: computeTextMetrics(manualContent)
          });
        }
        pendingAI = null;
      } else {
        // AI 产物（生成/续写/连更）都进语料——每个版本都是一次生成质量的样本
        corpusMetrics.push(computeTextMetrics(version.content ?? ""));
        pendingAI = version;
      }
    }
  }

  const dataset: Dataset = {
    generatedAt: new Date().toISOString(),
    counts: {
      chaptersWithVersions: chapterIds.length,
      totalVersions: versions.length,
      revisionPairs: revisionPairs.length,
      rejectedChapters,
      corpusVersions: corpusMetrics.length
    },
    revisionPairs,
    corpusMetrics
  };

  // 明细（含正文）→ .eval-out/，不进 git
  const outDir = `${repoRoot}.eval-out`;
  mkdirSync(outDir, { recursive: true });
  const datasetPath = `${outDir}/dataset-${today}.json`;
  writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), "utf8");

  // 聚合报告（不含正文）→ docs/eval/
  const editRatios = revisionPairs.map((p) => p.editRatio);
  const corpusAgg = aggregateMetrics(corpusMetrics);
  const pairVersionAgg = aggregateMetrics(revisionPairs.map((p) => p.versionMetrics));
  const pairCurrentAgg = aggregateMetrics(revisionPairs.map((p) => p.currentMetrics));

  const lines: string[] = [];
  lines.push(`# 评测基线报告（${today}）`);
  lines.push("");
  lines.push("> 由 `pnpm eval:mine` 自动生成，只含统计数字与指标定义，不含任何正文。");
  lines.push("> 数据来源：本机 `ai_novel_platform` 数据库的真实生成/修订记录。");
  lines.push("");
  lines.push("## 数据规模");
  lines.push("");
  lines.push(`- 有版本记录的章节：${dataset.counts.chaptersWithVersions}`);
  lines.push(`- 版本记录总数：${dataset.counts.totalVersions}`);
  lines.push(`- **修订配对（AI 版本 → 其后 MANUAL 版本）：${dataset.counts.revisionPairs}**`);
  lines.push(`- 被否定的章节（软删除且有版本）：${dataset.counts.rejectedChapters}`);
  lines.push(`- 语料版本数（未删除章节的 AI 版本）：${dataset.counts.corpusVersions}`);
  lines.push("");
  lines.push("## 修订幅度（AI 版本 → 作者改版）");
  lines.push("");
  if (revisionPairs.length > 0) {
    lines.push(`- 平均修改幅度：(增+删)/版本长度 = ${round(editRatios.reduce((a, b) => a + b, 0) / editRatios.length)}`);
    lines.push(`- 中位修改幅度：${round(median(editRatios))}`);
    lines.push(`- 最大修改幅度：${round(Math.max(...editRatios))}`);
    lines.push("");
    lines.push("| 指标 | AI 版本均值 | 修订后均值 | 方向 |");
    lines.push("|---|---|---|---|");
    const metricKeys = [
      ["slopPer1kChars", "AI 味密度(每千字)"],
      ["sentenceLengthCv", "句长变异系数"],
      ["dialogueLineRatio", "对话行占比"],
      ["repeatBigramRate", "重复 bigram 率"],
      ["avgSentenceLength", "平均句长"]
    ] as const;
    for (const [key, label] of metricKeys) {
      const before = pairVersionAgg.meanOf(key);
      const after = pairCurrentAgg.meanOf(key);
      const direction = after > before ? "↑" : after < before ? "↓" : "=";
      lines.push(`| ${label} | ${before} | ${after} | ${direction} |`);
    }
  } else {
    lines.push("- 暂无修订配对（人工编辑不写版本；有配对时本表自动填充）。");
  }
  lines.push("");
  lines.push("## 语料指标基线（未删除章节的最新版本）");
  lines.push("");
  lines.push(`- 样本数：${corpusAgg.sampleCount}，总字符：${corpusAgg.totalChars}`);
  lines.push(`- AI 味密度均值（每千字）：${corpusAgg.meanOf("slopPer1kChars")}`);
  lines.push(`- 句长变异系数均值：${corpusAgg.meanOf("sentenceLengthCv")}`);
  lines.push(`- 对话行占比均值：${corpusAgg.meanOf("dialogueLineRatio")}`);
  lines.push(`- 重复 bigram 率均值：${corpusAgg.meanOf("repeatBigramRate")}`);
  lines.push("");
  lines.push("## 指标定义（确定性层，任何人重跑得同一结果）");
  lines.push("");
  lines.push("- AI 味密度：`scanDeslop` 命中数 / 千字（词表与句式规则见 `packages/shared/src/deslop/scanner.ts`）");
  lines.push("- 句长变异系数：分句后句长的 stddev/mean，AI 文本句长均匀 → 偏低");
  lines.push("- 对话行占比：以引号/破折号起始的非空行 / 总非空行");
  lines.push("- 重复 bigram 率：第二个及以后出现的相邻 bigram / 总 bigram");
  lines.push("- 修订幅度：LCS diff 的 (新增+删除)/版本长度（`packages/shared/src/eval/text-diff.ts`）");
  lines.push("");
  lines.push("## 已知局限（诚实声明）");
  lines.push("");
  lines.push("- 当前样本主要来自本地开发与 e2e（多为 fake 模型输出、短章），**不代表真实 LLM 质量**；");
  lines.push("  接入真实模型并实际写作后，重跑本脚本即得真实基线。");
  lines.push("- 修订配对口径：「AI 版本 → 其后最近的 MANUAL 版本」。MANUAL 快照由手动保存自动产生");
  lines.push("  （修改幅度 ≥10% 且距上一版本 ≥10 分钟才写），小幅修改与高频保存不进版本链。");
  lines.push("- LLM 评审层（rubric 评分）已实现（`apps/worker/src/eval/judge.ts`），真实评分需真实模型 key。");
  lines.push("");
  lines.push("## 重跑方式");
  lines.push("");
  lines.push("```bash");
  lines.push("pnpm eval:mine");
  lines.push("```");
  lines.push("");

  const reportDir = `${repoRoot}docs/eval`;
  mkdirSync(reportDir, { recursive: true });
  const reportPath = `${reportDir}/baseline-${today}.md`;
  writeFileSync(reportPath, lines.join("\n"), "utf8");

  console.log(`[eval:mine] 完成`);
  console.log(`  修订配对: ${dataset.counts.revisionPairs}`);
  console.log(`  被否定章节: ${dataset.counts.rejectedChapters}`);
  console.log(`  语料版本: ${dataset.counts.corpusVersions}`);
  console.log(`  报告: ${reportPath}`);
  console.log(`  明细数据集（含正文，勿提交）: ${datasetPath}`);
}

main()
  .catch((error) => {
    console.error("[eval:mine] 失败:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
