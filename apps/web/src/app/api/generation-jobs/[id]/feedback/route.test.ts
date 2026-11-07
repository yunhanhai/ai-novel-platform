import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  session: vi.fn(async () => ({ organizationId: "org-1", userId: "user-1", displayName: "user" })),
  write: vi.fn(),
  read: vi.fn()
}));
vi.mock("../../../../../server/context", () => ({
  requireSession: fixture.session,
  getOrganizationId: async () => "org-1",
  isUnauthorizedError: (error: unknown) => error instanceof Error && error.name === "UnauthorizedError"
}));
vi.mock("@ai-novel/db", () => ({ prisma: { $transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({ $queryRaw: fixture.read, generationJob: { update: fixture.write } }) } }));
import { POST } from "./route";
const jobId = "11111111-1111-1111-1111-111111111111";
const chapterId = "22222222-2222-2222-2222-222222222222";
const body = { chapterId, sourceSha256: "a".repeat(64), suggestionIndex: 1, quote: "same quote", replacement: "second replacement" };
function call(value: unknown, raw = false, id = jobId) {
  return POST(new Request(`http://localhost/api/generation-jobs/${id}/feedback`, { method: "POST", body: raw ? value as string : JSON.stringify(value) }), { params: Promise.resolve({ id }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.session.mockResolvedValue({ organizationId: "org-1", userId: "user-1", displayName: "user" });
  fixture.read.mockResolvedValue([{ id: jobId, jobType: "REVIEW", status: "SUCCEEDED", targetEntityType: "CHAPTER", targetEntityId: chapterId, output: {
    chapterId, sourceSha256: body.sourceSha256, review: { suggestions: [{ quote: body.quote, replacement: "first replacement", verified: true }, { quote: body.quote, replacement: body.replacement, verified: true }] }
  } }]);
  fixture.write.mockResolvedValue({});
});
describe("review feedback request contract", () => {
  it.each([null, [], "text", {}, { quote: "same quote" }, { ...body, chapterId: "wrong" }, { ...body, sourceSha256: "bad" }, { ...body, suggestionIndex: -1 }, { ...body, suggestionIndex: 1.5 }, { ...body, quote: "" }, { ...body, replacement: "" }])("rejects invalid proof %j without writing", async value => {
    const response = await call(value);
    expect(response.status).toBe(400); expect(fixture.write).not.toHaveBeenCalled();
  });
  it("returns 400 on malformed JSON", async () => { expect((await call("{", true)).status).toBe(400); });
  it("returns 400 for malformed job identity", async () => { expect((await call(body, false, "not-a-uuid")).status).toBe(400); });
  it("records only the indexed suggestion with the same quote", async () => {
    const response = await call(body); expect(response.status).toBe(200);
    const data = (await response.json()).data; expect(data.suggestionIndex).toBe(1);
    const write = fixture.write.mock.calls[0]?.[0];
    expect(write.data.output.review.suggestions[0].applied).not.toBe(true);
    expect(write.data.output.review.suggestions[1]).toMatchObject({ applied: true, appliedById: "user-1", appliedAt: expect.any(String) });
  });
  it("rejects nonterminal jobs", async () => { fixture.read.mockResolvedValue([{ id: jobId, jobType: "REVIEW", status: "RUNNING", output: { review: { suggestions: [{quote: body.quote}] } } }]); expect((await call(body)).status).toBe(409); });
  it("returns 404 for another organization", async () => { fixture.read.mockResolvedValue([]); expect((await call(body)).status).toBe(404); expect(fixture.write).not.toHaveBeenCalled(); });
  it("returns 409 for changed source", async () => { expect((await call({ ...body, sourceSha256: "b".repeat(64) })).status).toBe(409); expect(fixture.write).not.toHaveBeenCalled(); });
  it("returns 404 for a missing suggestion index", async () => { expect((await call({ ...body, suggestionIndex: 9 })).status).toBe(404); expect(fixture.write).not.toHaveBeenCalled(); });
  it("returns 401 before reading jobs when session expired", async () => {
    const expired = new Error("expired"); expired.name = "UnauthorizedError"; fixture.session.mockRejectedValueOnce(expired);
    expect((await call(body)).status).toBe(401); expect(fixture.read).not.toHaveBeenCalled(); expect(fixture.write).not.toHaveBeenCalled();
  });
});
