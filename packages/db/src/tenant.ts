type TenantScopedData = Record<string, unknown>;

export function requireOrganizationId(organizationId: string | null | undefined): string {
  if (!organizationId?.trim()) {
    throw new Error("organizationId is required");
  }

  return organizationId;
}

export function tenantWhere<TWhere extends TenantScopedData>(
  organizationId: string,
  where?: TWhere
): Omit<TWhere, "organizationId"> & { organizationId: string } {
  return {
    ...where,
    organizationId: requireOrganizationId(organizationId)
  } as Omit<TWhere, "organizationId"> & { organizationId: string };
}

export function tenantCreateData<TData extends TenantScopedData>(
  organizationId: string,
  data: TData
): Omit<TData, "organizationId"> & { organizationId: string } {
  return {
    ...data,
    organizationId: requireOrganizationId(organizationId)
  } as Omit<TData, "organizationId"> & { organizationId: string };
}
