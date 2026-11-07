"use client";

import { createContext, useContext } from "react";

interface OrganizationContextValue {
  organizationId: string | null;
  userId: string | null;
}

const OrganizationContext = createContext<OrganizationContextValue>({ organizationId: null, userId: null });

export function OrganizationProvider({
  organizationId,
  userId = null,
  children
}: {
  organizationId: string | null;
  userId?: string | null;
  children: React.ReactNode;
}) {
  return (
    <OrganizationContext.Provider value={{ organizationId, userId }}>{children}</OrganizationContext.Provider>
  );
}

// 客户端读取注入的组织 ID；MVP 阶段值来自 layout 注入，后续可换 auth session
export function useOrganization(): OrganizationContextValue {
  return useContext(OrganizationContext);
}

export function useRequiredOrganizationId(): string {
  const { organizationId } = useContext(OrganizationContext);
  if (!organizationId) {
    throw new Error("OrganizationContext 未注入：请在 (app)/layout.tsx 中包裹 OrganizationProvider");
  }
  return organizationId;
}
