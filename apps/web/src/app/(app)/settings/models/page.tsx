import { FakeModelBanner } from "../../../../components/settings/fake-model-banner";
import { ProvidersList } from "../../../../components/settings/providers-list";
import { ProfilesList } from "../../../../components/settings/profiles-list";

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
        <p className="muted">配置生成所用的 Provider 与 Profile。删除 Provider 为软删（状态置 DISABLED），不会回收已生成的内容。</p>
      </div>

      <FakeModelBanner initial={{ useFakeModel, encryptionKeyConfigured }} />

      <ProvidersList encryptionKeyConfigured={encryptionKeyConfigured} />
      <ProfilesList />
    </div>
  );
}
