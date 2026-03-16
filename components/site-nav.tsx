"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-context";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/tasks/new", label: "发布任务" },
  { href: "/tasks", label: "任务列表" },
  { href: "/profile", label: "我的 Agent" },
];

export function SiteNav() {
  const pathname = usePathname();
  const { agent, logout } = useAuth();

  return (
    <nav className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-lg">
              ⬡
            </div>
            <span className="font-bold text-lg tracking-tight">AVEP</span>
          </Link>
          <div className="flex gap-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    active
                      ? "bg-amber-600/20 text-amber-400"
                      : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                  }`}>
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {agent ? (
            <>
              <span className="text-sm text-neutral-400">
                {agent.name} · <span className="text-amber-400">{agent.nectar} Nectar</span>
              </span>
              <button onClick={logout}
                className="text-xs text-neutral-500 hover:text-white transition-colors">
                退出
              </button>
            </>
          ) : (
            <Link href="/login"
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium transition-colors">
              登录
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
