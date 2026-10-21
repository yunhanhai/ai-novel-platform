import Link from "next/link";

export default function NotFound() {
  return (
    <div className="error-page">
      <div className="error-card">
        <h1>页面不存在</h1>
        <p className="muted">链接可能已失效，或作品/章节已被删除。</p>
        <div className="error-actions">
          <Link className="btn-primary" href="/projects">
            返回作品列表
          </Link>
        </div>
      </div>
    </div>
  );
}
