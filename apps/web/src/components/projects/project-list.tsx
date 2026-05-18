import Link from "next/link";

interface ProjectItem {
  id: string;
  title: string;
  slug: string;
  type: string;
  genre: string | null;
  status: string;
  updatedAt: string;
  chapterCount: number;
}

export function ProjectList({ projects }: { projects: ProjectItem[] }) {
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p>还没有作品，创建一个开始写作吧。</p>
      </div>
    );
  }

  return (
    <ul className="project-cards">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`/projects/${p.id}/workspace`} className="project-card">
            <div className="project-card-header">
              <h3>{p.title}</h3>
              <span className={`status-pill status-${p.status.toLowerCase()}`}>{p.status}</span>
            </div>
            <div className="project-card-meta">
              <span>{p.type === "LONG_NOVEL" ? "长篇小说" : "短篇故事"}</span>
              {p.genre && <span>{p.genre}</span>}
              <span>{p.chapterCount} 章</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
