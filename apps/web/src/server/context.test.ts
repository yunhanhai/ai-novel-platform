import { describe, expect, it } from "vitest";
import {
  getOrganizationId,
  safeGetOrganizationId,
  getUserId,
  safeGetUserId
} from "./context";

describe("server/context", () => {
  describe("getOrganizationId", () => {
    it("returns the configured organization id", () => {
      expect(getOrganizationId({ DEFAULT_ORGANIZATION_ID: "org-1" })).toBe("org-1");
    });

    it("trims whitespace", () => {
      expect(getOrganizationId({ DEFAULT_ORGANIZATION_ID: "  org-1  " })).toBe("org-1");
    });

    it("throws when env value is missing", () => {
      expect(() => getOrganizationId({})).toThrow(/DEFAULT_ORGANIZATION_ID/);
    });

    it("throws when env value is empty string", () => {
      expect(() => getOrganizationId({ DEFAULT_ORGANIZATION_ID: "   " })).toThrow(/DEFAULT_ORGANIZATION_ID/);
    });
  });

  describe("safeGetOrganizationId", () => {
    it("returns the configured value", () => {
      expect(safeGetOrganizationId({ DEFAULT_ORGANIZATION_ID: "org-1" })).toBe("org-1");
    });

    it("returns null when missing instead of throwing", () => {
      expect(safeGetOrganizationId({})).toBeNull();
    });

    it("returns null when blank", () => {
      expect(safeGetOrganizationId({ DEFAULT_ORGANIZATION_ID: "  " })).toBeNull();
    });
  });

  describe("getUserId", () => {
    it("returns the configured user id", () => {
      expect(getUserId({ DEFAULT_USER_ID: "user-1" })).toBe("user-1");
    });

    it("throws when missing", () => {
      expect(() => getUserId({})).toThrow(/DEFAULT_USER_ID/);
    });
  });

  describe("safeGetUserId", () => {
    it("returns the configured value", () => {
      expect(safeGetUserId({ DEFAULT_USER_ID: "user-1" })).toBe("user-1");
    });

    it("returns null when missing", () => {
      expect(safeGetUserId({})).toBeNull();
    });
  });
});
