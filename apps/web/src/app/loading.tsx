export default function Loading() {
  return (
    <div className="loading-page" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <p className="muted">加载中...</p>
    </div>
  );
}
