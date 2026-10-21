import { FakeModelBanner } from "../../../../components/settings/fake-model-banner";
import { ProvidersList } from "../../../../components/settings/providers-list";
import { ProfilesList } from "../../../../components/settings/profiles-list";
import { WorkerStatusCard } from "../../../../components/settings/worker-status-card";

/**
 * 模型设置页
 * 服务端读取 USE_FAKE_MODEL / ENCRYPTION_KEY，下发给 Banner + ProvidersList 子组件。
 */
export default function SettingsModelsPage() {
  const useFakeModel = process.env.USE_FAKE_MODEL === "true";
  const encryptionKeyConfigured = /^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY ?? "");

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>模型设置</h1>
        <p className="muted">配置生成所用的模型供应商与模型档案。删除供应商为软删（状态置为“已停用”），不会回收已生成的内容。</p>
      </div>

      <FakeModelBanner initial={{ useFakeModel, encryptionKeyConfigured }} />

      <WorkerStatusCard />

      <ProvidersList encryptionKeyConfigured={encryptionKeyConfigured} />
      <ProfilesList />
    </div>
  );
}
