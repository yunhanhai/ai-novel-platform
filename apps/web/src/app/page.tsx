const queueItems = [
  { label: "Project Library", status: "ready" },
  { label: "Writing Workspace", status: "next" },
  { label: "PostgreSQL Jobs", status: "next" }
];

export default function Page() {
  return (
    <main className="app-shell">
      <header className="top-bar" aria-label="Application header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            AI
          </span>
          <span>AI Novel Platform</span>
        </div>
      </header>

      <section className="workspace" aria-label="Workspace overview">
        <aside className="pane pane-muted stack">
          <h2>Projects</h2>
          <p className="muted">No active project selected.</p>
        </aside>

        <section className="pane stack">
          <div>
            <p className="muted">MVP workspace</p>
            <h1>AI Novel Platform</h1>
          </div>
          <div className="metric-row" aria-label="Workspace metrics">
            <div className="metric">
              <span>Drafts</span>
              <strong>0</strong>
            </div>
            <div className="metric">
              <span>Chapters</span>
              <strong>0</strong>
            </div>
            <div className="metric">
              <span>Queued jobs</span>
              <strong>0</strong>
            </div>
          </div>
        </section>

        <aside className="pane pane-muted">
          <h2>Build Queue</h2>
          <ul className="status-list">
            {queueItems.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <span className="status-pill">{item.status}</span>
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </main>
  );
}
