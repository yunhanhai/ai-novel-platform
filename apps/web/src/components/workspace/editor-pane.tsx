interface EditorPaneProps {
  content: string;
  title: string;
  onChange: (value: string) => void;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  isLoadingContent?: boolean;
  disabled?: boolean;
}

export function EditorPane({
  content,
  title,
  onChange,
  saveStatus = "idle",
  isLoadingContent = false,
  disabled = false
}: EditorPaneProps) {
  return (
    <section className="pane editor-pane">
      <div className="editor-header">
        <h1>{title}</h1>
        <span className={`save-status save-status-${saveStatus}`} aria-live="polite">
          {labelForSaveStatus(saveStatus)}
        </span>
      </div>
      <textarea
        className="editor-textarea"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        placeholder={isLoadingContent ? "加载中..." : "在此输入或等待 AI 生成..."}
        disabled={disabled || isLoadingContent}
      />
    </section>
  );
}

function labelForSaveStatus(status: "idle" | "saving" | "saved" | "error"): string {
  switch (status) {
    case "saving":
      return "保存中...";
    case "saved":
      return "已保存";
    case "error":
      return "保存失败";
    default:
      return "";
  }
}
