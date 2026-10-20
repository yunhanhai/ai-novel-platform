import Link from "next/link";
import { redirect } from "next/navigation";
import { safeGetOrganizationId } from "../../server/context";
import { OrganizationProvider } from "../../components/organization-context";
import { LogoutButton } from "../../components/logout-button";
import { getSession } from "../../server/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const organizationId = await safeGetOrganizationId();

  return (
    <OrganizationProvider organizationId={organizationId}>
      <div className="app-shell">
        <header className="top-bar">
          <Link href="/projects" className="brand">
            <span className="brand-mark">AI</span>
            <span>AI 小说创作平台</span>
          </Link>
          <div className="top-bar-right">
            <Link href="/settings/models" className="btn-ghost btn-small">设置</Link>
            <span className="user-tag">{session.displayName}</span>
            {organizationId ? (
              <span className="org-tag" title="当前组织上下文">org · {organizationId.slice(0, 8)}</span>
            ) : (
              <span className="org-tag warn">无组织上下文</span>
            )}
            <LogoutButton />
          </div>
        </header>
        <main className="app-main">{children}</main>
      </div>
    </OrganizationProvider>
  );
}
