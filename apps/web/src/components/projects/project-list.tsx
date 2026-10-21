import Link from "next/link";
import { labelForProjectStatus } from "../../lib/display-labels";

interface ProjectItem {
  id: string;
  title: string;
  slug: string;
  type: string;
  genre: string | null;
  status: string;
  updatedAt: string;
  chapterCount: number;
  totalWords?: number;
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
              <span className={`status-pill status-${p.status.toLowerCase()}`}>
                {labelForProjectStatus(p.status)}
              </span>
            </div>
            <div className="project-card-meta">
              <span>{p.type === "LONG_NOVEL" ? "长篇连载" : "短篇作品"}</span>
              {p.genre && <span>{p.genre}</span>}
              <span>{p.chapterCount} 章</span>
              {typeof p.totalWords === "number" && p.totalWords > 0 && (
                <span>{p.totalWords.toLocaleString()} 字</span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
