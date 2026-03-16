"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_NAV = [
  { href: "/admin", label: "总览" },
  { href: "/admin/tasks", label: "任务" },
  { href: "/admin/agents", label: "Agent" },
  { href: "/admin/rooms", label: "Room" },
  { href: "/admin/logs", label: "日志" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <nav className="border-b border-neutral-800 bg-neutral-950/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-6">
          <Link href="/admin" className="font-bold text-lg tracking-tight text-amber-400">
            AVEP Admin
          </Link>
          <div className="flex gap-1">
            {ADMIN_NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link key={item.href} href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    active ? "bg-amber-600/20 text-amber-400" : "text-neutral-400 hover:text-white"
                  }`}>
                  {item.label}
                </Link>
              );
            })}
          </div>
          <div className="ml-auto">
            <Link href="/" className="text-xs text-neutral-500 hover:text-white">返回前台</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
