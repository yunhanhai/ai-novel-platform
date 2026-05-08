import Link from "next/link";
import { safeGetOrganizationId } from "../../server/context";
import { OrganizationProvider } from "../../components/organization-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Server Component: 从环境变量读取，MVP 阶段唯一组织上下文
  const organizationId = safeGetOrganizationId();

  return (
    <OrganizationProvider organizationId={organizationId}>
      <div className="app-shell">
        <header className="top-bar">
          <Link href="/app/projects" className="brand">
            <span className="brand-mark">AI</span>
            <span>AI Novel Platform</span>
          </Link>
          {organizationId ? (
            <span className="org-tag" title="当前组织上下文">org · {organizationId.slice(0, 8)}</span>
          ) : (
            <span className="org-tag warn" title="DEFAULT_ORGANIZATION_ID 未配置">无组织上下文</span>
          )}
        </header>
        <main className="app-main">{children}</main>
      </div>
    </OrganizationProvider>
  );
}
