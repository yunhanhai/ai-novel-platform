import { BudgetGovernancePanel } from "../../../../components/settings/budget-governance-panel";

export default function SettingsBudgetPage() {
  return (
    <div className="settings-page budget-page">
      <div className="page-header">
        <div>
          <p className="budget-eyebrow">财务治理</p>
          <h1>预算与用量</h1>
          <p className="muted">
            设置月度费用与 Token 额度，按预算周期追踪生成成本，并保留超预算通知记录。
          </p>
        </div>
      </div>

      <BudgetGovernancePanel />
    </div>
  );
}
