import { PerformanceBudgetsPanel } from "../../../../components/settings/performance-budgets-panel";

export default function SettingsPerformancePage() {
  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>性能预算</h1>
        <p className="muted">配置组织默认和项目覆盖预算，用于性能趋势中的成本预警。</p>
      </div>

      <PerformanceBudgetsPanel />
    </div>
  );
}
