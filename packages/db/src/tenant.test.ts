import { describe, expect, it } from "vitest";
import { requireOrganizationId, tenantCreateData, tenantWhere } from "./tenant";

describe("tenant helpers", () => {
  it("rejects a missing organization id", () => {
    expect(() => requireOrganizationId(undefined)).toThrow("organizationId is required");
    expect(() => requireOrganizationId("")).toThrow("organizationId is required");
  });

  it("adds organizationId to query filters", () => {
    expect(tenantWhere("org_123", { status: "active" })).toEqual({
      organizationId: "org_123",
      status: "active"
    });
  });

  it("does not allow caller filters to override organizationId", () => {
    expect(
      tenantWhere("org_123", {
        organizationId: "org_other",
        status: "active"
      })
    ).toEqual({
      organizationId: "org_123",
      status: "active"
    });
  });

  it("adds organizationId to create data", () => {
    expect(tenantCreateData("org_123", { title: "第一本书" })).toEqual({
      organizationId: "org_123",
      title: "第一本书"
    });
  });
});
