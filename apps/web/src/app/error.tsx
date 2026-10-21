"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled render error", error);
  }, [error]);

  return (
    <div className="error-page">
      <div className="error-card">
        <h1>页面出错了</h1>
        <p className="muted">
          这一页渲染时遇到问题。你的内容已自动保存，可以重试或返回作品列表。
        </p>
        {error.digest && <p className="error-digest">错误编号：{error.digest}</p>}
        <div className="error-actions">
          <button type="button" className="btn-primary" onClick={reset}>
            重试
          </button>
          <a className="btn-ghost" href="/projects">
            返回作品列表
          </a>
        </div>
      </div>
    </div>
  );
}
