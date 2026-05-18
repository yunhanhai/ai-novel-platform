import Link from "next/link";
import { prisma } from "@ai-novel/db";
import { safeGetOrganizationId } from "../../../server/context";
import { findProjectsByOrganization } from "../../../server/projects";
import { ProjectList } from "../../../components/projects/project-list";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const organizationId = safeGetOrganizationId();
  const items = organizationId ? await loadProjects(organizationId) : [];

  return (
    <div className="projects-page">
      <div className="page-header">
        <div>
          <h1>我的作品</h1>
          <p className="muted">管理你的小说项目</p>
        </div>
        <Link href="/projects/new" className="btn-primary">新建作品</Link>
      </div>
      {!organizationId && (
        <p className="form-error">DEFAULT_ORGANIZATION_ID 未配置，无法读取项目列表。</p>
      )}
      <section>
        <ProjectList projects={items} />
      </section>
    </div>
  );
}

async function loadProjects(organizationId: string) {
  const projects = await findProjectsByOrganization(organizationId, prisma);
  if (projects.length === 0) return [];

  const counts = await prisma.chapter.groupBy({
    by: ["projectId"],
    where: {
      projectId: { in: projects.map((p) => p.id) },
      deletedAt: null
    },
    _count: { _all: true }
  });
  const countMap = new Map(counts.map((c) => [c.projectId, c._count._all]));

  return projects.map((p) => ({
    id: p.id,
    title: p.title,
    slug: p.slug,
    type: p.type,
    genre: p.genre,
    status: p.status,
    updatedAt: p.updatedAt.toISOString(),
    chapterCount: countMap.get(p.id) ?? 0
  }));
}
