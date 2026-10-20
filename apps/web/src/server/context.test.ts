import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

vi.mock("./auth", () => ({
  getSession: () => getSessionMock()
}));

import {
  getOrganizationId,
  getSessionContext,
  getUserId,
  isUnauthorizedError,
  safeGetOrganizationId,
  safeGetUserId,
  UnauthorizedError
} from "./context";

describe("server/context", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
  });

  describe("getSessionContext", () => {
    it("returns userId/organizationId/displayName from the session", async () => {
      getSessionMock.mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        displayName: "张三"
      });

      await expect(getSessionContext()).resolves.toEqual({
        userId: "user-1",
        organizationId: "org-1",
        displayName: "张三"
      });
    });

    it("throws UnauthorizedError when there is no session", async () => {
      getSessionMock.mockResolvedValue(null);

      await expect(getSessionContext()).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("throws UnauthorizedError when the session has no organization", async () => {
      getSessionMock.mockResolvedValue({
        userId: "user-1",
        organizationId: "",
        displayName: "张三"
      });

      await expect(getSessionContext()).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe("getOrganizationId / getUserId", () => {
    it("returns the session values", async () => {
      getSessionMock.mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        displayName: "张三"
      });

      await expect(getOrganizationId()).resolves.toBe("org-1");
      await expect(getUserId()).resolves.toBe("user-1");
    });

    it("rejects when unauthenticated", async () => {
      getSessionMock.mockResolvedValue(null);

      await expect(getOrganizationId()).rejects.toBeInstanceOf(UnauthorizedError);
      await expect(getUserId()).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe("safe variants", () => {
    it("returns null instead of throwing when unauthenticated", async () => {
      getSessionMock.mockResolvedValue(null);

      await expect(safeGetOrganizationId()).resolves.toBeNull();
      await expect(safeGetUserId()).resolves.toBeNull();
    });

    it("trims blank values", async () => {
      getSessionMock.mockResolvedValue({
        userId: "  ",
        organizationId: "  ",
        displayName: "张三"
      });

      await expect(safeGetOrganizationId()).resolves.toBeNull();
      await expect(safeGetUserId()).resolves.toBeNull();
    });

    it("returns real values when present", async () => {
      getSessionMock.mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        displayName: "张三"
      });

      await expect(safeGetOrganizationId()).resolves.toBe("org-1");
      await expect(safeGetUserId()).resolves.toBe("user-1");
    });
  });

  describe("isUnauthorizedError", () => {
    it("narrows UnauthorizedError instances", () => {
      expect(isUnauthorizedError(new UnauthorizedError())).toBe(true);
      expect(isUnauthorizedError(new Error("boom"))).toBe(false);
      expect(isUnauthorizedError(null)).toBe(false);
    });
  });
});
