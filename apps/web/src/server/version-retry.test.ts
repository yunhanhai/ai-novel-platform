import { describe, expect, it, vi } from "vitest";
import { withVersionRetry } from "./version-retry";

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

describe("withVersionRetry", () => {
  it("returns on the first attempt when nothing collides", async () => {
    const run = vi.fn().mockResolvedValue("ok");

    await expect(withVersionRetry(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries and succeeds after a transient unique violation", async () => {
    const run = vi.fn().mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce("ok");

    await expect(withVersionRetry(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-unique errors immediately without retrying", async () => {
    const run = vi.fn().mockRejectedValue(new Error("db down"));

    await expect(withVersionRetry(run)).rejects.toThrow("db down");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after three attempts and rethrows the conflict", async () => {
    const run = vi.fn().mockRejectedValue(uniqueViolation());

    await expect(withVersionRetry(run)).rejects.toMatchObject({ code: "P2002" });
    expect(run).toHaveBeenCalledTimes(3);
  });
});
