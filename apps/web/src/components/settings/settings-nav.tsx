"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/models", label: "模型" },
  { href: "/settings/budget", label: "预算与用量" }
] as const;

/**
 * 设置子导航：在模型设置与预算治理之间切换。
 * 用 usePathname 高亮当前页，确保预算页可被发现（此前只有页面、无入口）。
 */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="settings-nav" aria-label="设置导航">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "settings-nav-tab is-active" : "settings-nav-tab"}
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
