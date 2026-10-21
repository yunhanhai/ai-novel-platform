"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] fatal error", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <div className="error-page">
          <div className="error-card">
            <h1>应用发生严重错误</h1>
            <p className="muted">请重试；若持续出现，请查看服务端日志。</p>
            {error.digest && <p className="error-digest">错误编号：{error.digest}</p>}
            <div className="error-actions">
              <button type="button" className="btn-primary" onClick={reset}>
                重试
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
