"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-context";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tasks", label: "任务列表", exact: true },
];

export function SiteNav() {
  const pathname = usePathname();
  const { agent, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  function isActive(item: typeof NAV_ITEMS[0]) {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  }

  return (
    <nav className="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-lg">⬡</div>
            <span className="font-bold text-lg tracking-tight">AVEP</span>
          </Link>
          <div className="hidden md:flex gap-1">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive(item)
                    ? "bg-amber-600/20 text-amber-400"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3">
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

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 rounded-lg hover:bg-neutral-800 transition-colors"
          aria-label="菜单"
        >
          <svg className="w-5 h-5 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t border-neutral-800 bg-neutral-950/95 backdrop-blur-sm px-6 py-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive(item)
                  ? "bg-amber-600/20 text-amber-400"
                  : "text-neutral-400 hover:text-white"
              }`}>
              {item.label}
            </Link>
          ))}
          <div className="pt-2 border-t border-neutral-800 mt-2">
            {agent ? (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-sm text-neutral-400">
                  {agent.name} · <span className="text-amber-400">{agent.nectar} Nectar</span>
                </span>
                <button onClick={() => { logout(); setMenuOpen(false); }}
                  className="text-xs text-neutral-500 hover:text-white">退出</button>
              </div>
            ) : (
              <Link href="/login" onClick={() => setMenuOpen(false)}
                className="block px-3 py-2 text-amber-400 text-sm">
                登录 / 注册
              </Link>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
