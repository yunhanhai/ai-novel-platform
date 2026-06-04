import { SettingsNav } from "../../../components/settings/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="settings-layout">
      <SettingsNav />
      {children}
    </div>
  );
}
