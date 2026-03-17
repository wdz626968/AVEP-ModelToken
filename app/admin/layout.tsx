"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminProvider, useAdmin } from "@/components/admin-context";

const ADMIN_NAV = [
  { href: "/admin", label: "总览" },
  { href: "/admin/tasks", label: "任务" },
  { href: "/admin/agents", label: "Agent" },
  { href: "/admin/rooms", label: "Room" },
  { href: "/admin/logs", label: "日志" },
  { href: "/admin/settings", label: "设置" },
];

function AuthScreen({ login, setup, configured, dbError }: {
  login: (pw: string) => Promise<string | null>;
  setup: (pw: string) => Promise<string | null>;
  configured: boolean | null;
  dbError: string | null;
}) {
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isSetup = configured === false;

  async function handleSubmit() {
    setError("");
    if (!password.trim()) return;
    if (isSetup && password !== confirmPw) {
      setError("两次密码不一致");
      return;
    }
    setSubmitting(true);
    const err = isSetup ? await setup(password) : await login(password);
    if (err) setError(err);
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-4">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 flex items-center justify-center text-2xl mx-auto mb-3">⬡</div>
          <h1 className="text-xl font-bold">AVEP Admin</h1>
          <p className="text-xs text-neutral-500 mt-1">
            {isSetup ? "首次使用，请设置管理密码" : "请输入管理密码"}
          </p>
        </div>
        {dbError && (
          <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/30">
            <p className="text-xs text-red-400">{dbError}</p>
            <p className="text-xs text-neutral-500 mt-1">请确认数据库已连接，且已运行 prisma db push</p>
          </div>
        )}
        <input
          type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isSetup && handleSubmit()}
          placeholder={isSetup ? "设置密码（至少 4 位）" : "管理密码"}
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
          autoFocus
        />
        {isSetup && (
          <input
            type="password" value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder="确认密码"
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
          />
        )}
        <button onClick={handleSubmit}
          disabled={!password.trim() || submitting || (isSetup && password.length < 4)}
          className="w-full px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 transition-colors">
          {submitting ? "处理中..." : isSetup ? "设置密码并进入" : "登录"}
        </button>
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        <div className="text-center">
          <Link href="/" className="text-xs text-neutral-500 hover:text-white">返回前台</Link>
        </div>
      </div>
    </div>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { logout } = useAdmin();

  return (
    <div className="min-h-screen">
      <nav className="border-b border-neutral-800 bg-neutral-950/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-6">
          <Link href="/admin" className="font-bold text-lg tracking-tight text-amber-400">
            AVEP Admin
          </Link>
          <div className="hidden sm:flex gap-1">
            {ADMIN_NAV.map((item) => {
              const active = pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(item.href));
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
          <div className="ml-auto flex items-center gap-3">
            <button onClick={logout}
              className="text-xs text-neutral-500 hover:text-white transition-colors">退出管理</button>
            <Link href="/" className="text-xs text-neutral-500 hover:text-white">返回前台</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider
      onNeedAuth={(ctx) => <AuthScreen {...ctx} />}
    >
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}
