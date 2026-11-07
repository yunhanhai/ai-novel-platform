import type { Prisma, PrismaClient } from "@ai-novel/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;

export interface ReviewFeedbackProof {
  chapterId: string;
  sourceSha256: string;
  suggestionIndex: number;
  quote: string;
  replacement: string;
}

export class ReviewFeedbackError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseReviewFeedbackProof(value: unknown): ReviewFeedbackProof | null {
  if (!record(value) || typeof value.chapterId !== "string" || !UUID_RE.test(value.chapterId) ||
    typeof value.sourceSha256 !== "string" || !HASH_RE.test(value.sourceSha256) ||
    typeof value.suggestionIndex !== "number" || !Number.isSafeInteger(value.suggestionIndex) || value.suggestionIndex < 0 ||
    typeof value.quote !== "string" || !value.quote.trim() ||
    typeof value.replacement !== "string" || value.replacement.length === 0) return null;
  return { chapterId: value.chapterId.toLowerCase(), sourceSha256: value.sourceSha256.toLowerCase(), suggestionIndex: value.suggestionIndex, quote: value.quote, replacement: value.replacement };
}

interface FeedbackParams extends ReviewFeedbackProof {
  organizationId: string;
  userId: string;
  jobId: string;
  prisma: PrismaClient;
}

// This records an editor adoption action, not confirmation that the prose was saved.
// Locking the completed report keeps concurrent adoptions from replacing each other.
export async function recordReviewFeedback(params: FeedbackParams) {
  const { organizationId, userId, jobId, prisma } = params;
  const proof = parseReviewFeedbackProof(params);
  if (!UUID_RE.test(jobId) || !proof) throw new ReviewFeedbackError(400, "采纳反馈需要有效的任务、章节、来源与建议凭据");
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; jobType: string; status: string; targetEntityType: string | null; targetEntityId: string | null; output: unknown }>>`
      SELECT id, upper(job_type::text) AS "jobType", upper(status::text) AS status,
        upper(target_entity_type::text) AS "targetEntityType", target_entity_id AS "targetEntityId", output
      FROM generation_jobs WHERE id = ${jobId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE
    `;
    const job = rows[0];
    if (!job) throw new ReviewFeedbackError(404, "任务不存在");
    if (job.jobType !== "REVIEW" || job.status !== "SUCCEEDED" || job.targetEntityType !== "CHAPTER" || job.targetEntityId !== proof.chapterId) {
      throw new ReviewFeedbackError(409, "只能反馈已完成且章节一致的审校任务");
    }
    const output = job.output;
    if (!record(output) || output.chapterId !== proof.chapterId || typeof output.sourceSha256 !== "string" ||
      !HASH_RE.test(output.sourceSha256) || output.sourceSha256.toLowerCase() !== proof.sourceSha256.toLowerCase() ||
      !record(output.review) || !Array.isArray(output.review.suggestions)) {
      throw new ReviewFeedbackError(409, "审校报告来源已变化或无法核对，请重新审校");
    }
    const suggestions = output.review.suggestions;
    const selected: unknown = suggestions[proof.suggestionIndex];
    if (proof.suggestionIndex >= suggestions.length) throw new ReviewFeedbackError(404, "未找到对应的审校建议");
    if (!record(selected) || selected.verified !== true || selected.quote !== proof.quote || selected.replacement !== proof.replacement) {
      throw new ReviewFeedbackError(409, "建议内容或序号已变化，未记录采纳");
    }
    const appliedAt = selected.applied === true ? (typeof selected.appliedAt === "string" ? selected.appliedAt : null) : new Date().toISOString();
    const appliedById = selected.applied === true ? (typeof selected.appliedById === "string" ? selected.appliedById : null) : userId;
    if (selected.applied !== true) {
      const nextSuggestions = [...suggestions];
      nextSuggestions[proof.suggestionIndex] = { ...selected, applied: true, appliedAt, appliedById };
      await tx.generationJob.update({
        where: { id: jobId, organizationId },
        data: { output: { ...output, review: { ...output.review, suggestions: nextSuggestions } } as unknown as Prisma.InputJsonValue }
      });
    }
    return { id: jobId, chapterId: proof.chapterId, suggestionIndex: proof.suggestionIndex, quote: proof.quote, applied: true as const, appliedAt, appliedById };
  });
}
