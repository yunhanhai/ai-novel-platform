import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../server/context", () => ({
  getOrganizationId: vi.fn(async () => "org-1"),
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));

vi.mock("@ai-novel/db", () => ({
  prisma: { generationJob: { findFirst: vi.fn(), update: vi.fn() } }
}));

import { POST } from "./route";
import { prisma } from "@ai-novel/db";

function p() {
  return prisma as unknown as {
    generationJob: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
}

function call(quote: string) {
  return POST(
    new Request("http://localhost/api/generation-jobs/job-1/feedback", {
      method: "POST",
      body: JSON.stringify({ quote })
    }),
    { params: Promise.resolve({ id: "job-1" }) }
  );
}

interface WrittenSuggestion {
  quote: string;
  applied: boolean;
}

interface WrittenOutput {
  review?: { suggestions?: WrittenSuggestion[] };
}

const baseOutput = {
  review: {
    summary: "s",
    passed: false,
    suggestions: [
      { quote: "甲句", severity: "warning", applied: false },
      { quote: "乙句", severity: "info", applied: false }
    ]
  }
};

describe("POST /api/generation-jobs/[id]/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when quote is missing", async () => {
    const res = await call("");
    expect(res.status).toBe(400);
  });

  it("returns 404 for a job in another organization", async () => {
    p().generationJob.findFirst.mockResolvedValue(null);
    const res = await call("甲句");
    expect(res.status).toBe(404);
  });

  it("returns 400 when the job has no structured review", async () => {
    p().generationJob.findFirst.mockResolvedValue({ id: "job-1", output: {} });

    const res = await call("甲句");
    expect(res.status).toBe(400);
  });

  it("returns 404 when no suggestion matches the quote", async () => {
    p().generationJob.findFirst.mockResolvedValue({ id: "job-1", output: baseOutput });

    const res = await call("不存在的引文");
    expect(res.status).toBe(404);
    expect(p().generationJob.update).not.toHaveBeenCalled();
  });

  it("marks the matching suggestion as applied and writes output back", async () => {
    p().generationJob.findFirst.mockResolvedValue({ id: "job-1", output: baseOutput });
    p().generationJob.update.mockResolvedValue({});

    const res = await call("甲句");
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const written = p().generationJob.update.mock.calls[0]![0] as {
      data: { output: WrittenOutput };
    };
    const applied = written.data.output.review!.suggestions!.find((s) => s.quote === "甲句");
    const untouched = written.data.output.review!.suggestions!.find((s) => s.quote === "乙句");
    expect(applied!.applied).toBe(true);
    expect(untouched!.applied).toBe(false);
  });
});
