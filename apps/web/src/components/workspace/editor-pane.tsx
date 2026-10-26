"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface EditorSelection {
  start: number;
  end: number;
  text: string;
}

interface EditorPaneProps {
  content: string;
  title: string;
  onChange: (value: string) => void;
  saveStatus?: "idle" | "saving" | "saved" | "error";
  isLoadingContent?: boolean;
  disabled?: boolean;
  selection?: EditorSelection | null;
  onSelectionChange?: (selection: EditorSelection | null) => void;
  selectionToolbar?: ReactNode;
  rewriteCard?: ReactNode;
  externalUpdateNotice?: boolean;
  onAcceptExternalUpdate?: () => void;
  onDismissExternalUpdate?: () => void;
  chapterStatus?: string | null;
  onStatusChange?: (status: string) => void;
}

export function EditorPane({
  content,
  title,
  onChange,
  saveStatus = "idle",
  isLoadingContent = false,
  disabled = false,
  selection = null,
  onSelectionChange,
  selectionToolbar,
  rewriteCard,
  externalUpdateNotice = false,
  onAcceptExternalUpdate,
  onDismissExternalUpdate,
  chapterStatus = null,
  onStatusChange
}: EditorPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (selection === null && el && el.selectionStart !== el.selectionEnd) {
      el.setSelectionRange(0, 0);
    }
  }, [selection, content]);

  function syncSelection() {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) {
      onSelectionChange?.(null);
      return;
    }
    onSelectionChange?.({ start, end, text: content.slice(start, end) });
  }

  return (
    <section className="pane editor-pane">
      <div className="editor-header">
        <h1>{title}</h1>
        <div className="editor-header-actions">
          {chapterStatus && onStatusChange && (
            <select
              className="chapter-status-select"
              aria-label="章节状态"
              value={chapterStatus}
              onChange={(e) => onStatusChange(e.target.value)}
              disabled={disabled}
              title="标记章节进度：待写 → 草稿 → 审阅中 → 定稿"
            >
              <option value="PLANNED">待写</option>
              <option value="DRAFT">草稿</option>
              <option value="REVIEWING">审阅中</option>
              <option value="FINAL">定稿</option>
            </select>
          )}
          <span className={`save-status save-status-${saveStatus}`} aria-live="polite">
            {labelForSaveStatus(saveStatus)}
          </span>
        </div>
      </div>
      {externalUpdateNotice && (
        <div className="external-update-notice" role="alert">
          <span>
            远端正文已更新（可能是 AI 任务或其他标签页），你本地有未保存的修改。
          </span>
          <div className="external-update-actions">
            <button type="button" className="btn-ghost btn-small" onClick={onAcceptExternalUpdate}>
              放弃本地改动
            </button>
            <button type="button" className="btn-ghost btn-small" onClick={onDismissExternalUpdate}>
              保留本地
            </button>
          </div>
        </div>
      )}
      {selectionToolbar && selection && selection.text.trim().length > 0 && (
        <div className="selection-toolbar" role="toolbar" aria-label="选中文字操作">
          {selectionToolbar}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onSelect={() => syncSelection()}
        placeholder={isLoadingContent ? "加载中..." : "在此输入或等待 AI 生成..."}
        disabled={disabled || isLoadingContent}
      />
      {rewriteCard && <div className="rewrite-result-wrap">{rewriteCard}</div>}
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
