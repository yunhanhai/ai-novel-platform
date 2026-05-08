import { NextResponse } from "next/server";
import { prisma } from "@ai-novel/db";
import { scanDeslop } from "@ai-novel/shared/deslop/scanner";
import { findDeslopRulesByProject } from "../../../../server/deslop-rules";
import { getOrganizationId } from "../../../../server/context";

interface ScanBody {
  projectId?: string;
  text?: string;
}

// 实时扫描：传入正文 + projectId，返回 issues + stats
// 之所以用 POST 而非 GET：正文可能较长，且包含敏感字符；同时不希望被缓存
export async function POST(request: Request) {
  const body = (await request.json()) as ScanBody;
  const { projectId, text } = body;

  if (!projectId || typeof text !== "string") {
    return NextResponse.json(
      { success: false, error: "projectId 和 text 为必填项" },
      { status: 400 }
    );
  }

  try {
    const organizationId = getOrganizationId();
    const rules = await findDeslopRulesByProject(organizationId, projectId, prisma, {
      isActive: true
    });

    const customExactPatterns = rules
      .filter((r) => r.ruleType === "exact_match")
      .map((r) => r.pattern);

    const report = scanDeslop(text, customExactPatterns);

    // 把命中的自定义规则信息附加到 issue（用 pattern 反查 rule meta）
    const ruleByPattern = new Map(rules.map((r) => [r.pattern, r]));
    const enrichedIssues = report.issues.map((issue) => {
      if (issue.category !== "custom") return issue;
      const rule = ruleByPattern.get(issue.matched);
      if (!rule) return issue;
      return {
        ...issue,
        category: rule.category,
        severity: (rule.severity as "info" | "warning" | "error") ?? issue.severity,
        suggestion: rule.suggestion ?? issue.suggestion
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        issues: enrichedIssues,
        stats: report.stats,
        appliedRuleCount: customExactPatterns.length
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "服务异常";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
