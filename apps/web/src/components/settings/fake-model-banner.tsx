"use client";

import { useEffect, useState } from "react";

interface RuntimeInfo {
  useFakeModel: boolean;
  encryptionKeyConfigured: boolean;
}

interface FakeModelBannerProps {
  /** 用于测试注入；默认从 /api/settings/runtime 拉取 */
  initial?: RuntimeInfo;
}

export function FakeModelBanner({ initial }: FakeModelBannerProps) {
  const [info, setInfo] = useState<RuntimeInfo | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let active = true;
    fetch("/api/settings/runtime")
      .then((r) => r.json())
      .then((json: { success: boolean; data?: RuntimeInfo; error?: string }) => {
        if (!active) return;
        if (json.success && json.data) {
          setInfo(json.data);
        } else {
          setError(json.error ?? "无法读取运行时状态");
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "无法读取运行时状态");
      });
    return () => {
      active = false;
    };
  }, [initial]);

  if (error) {
    return (
      <div className="settings-banner banner-warn" role="status">
        <strong>运行时状态读取失败：</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="settings-banner banner-info" role="status">
        正在检查模型运行时...
      </div>
    );
  }

  return (
    <div className="settings-banner-stack">
      {info.useFakeModel ? (
        <div className="settings-banner banner-warn" role="status">
          <strong>当前为演示模式</strong>
          <span>USE_FAKE_MODEL=true，所有 AI 生成走占位模型。切换为真实模型需修改 .env 并重启后台任务服务。</span>
        </div>
      ) : (
        <div className="settings-banner banner-info" role="status">
          <strong>当前为真实模型模式</strong>
          <span>USE_FAKE_MODEL=false，生成任务将调用配置的模型供应商。</span>
        </div>
      )}
      {!info.encryptionKeyConfigured && (
        <div className="settings-banner banner-error" role="alert">
          <strong>ENCRYPTION_KEY 未配置</strong>
          <span>请在项目 .env 设置 64 位十六进制密钥后重启 web，否则无法保存 API 密钥。</span>
        </div>
      )}
    </div>
  );
}
