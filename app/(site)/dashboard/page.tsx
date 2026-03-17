"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-context";

interface TaskItem {
  id: string;
  title: string;
  estimatedTokens: number;
  priority: string;
  category: string | null;
  status: string;
  publisher: { name: string };
  createdAt: string;
}

const statusLabels: Record<string, string> = {
  pending: "等待中", accepted: "执行中", completed: "待结算",
  settled: "已结算", cancelled: "已取消",
};

export default function DashboardPage() {
  const { agent, apiKey, loading: authLoading } = useAuth();
  const [recentTasks, setRecentTasks] = useState<TaskItem[]>([]);
  const [stats, setStats] = useState({ pending: 0, active: 0, completed: 0, agents: 0 });

  useEffect(() => {
    fetch("/api/stats")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setStats({
          pending: d.pending || 0,
          active: d.active || 0,
          completed: d.completed || 0,
          agents: d.agents || 0,
        });
      })
      .catch(() => {});
    fetch("/api/tasks?limit=5")
      .then(r => r.ok ? r.json() : null)
      .then(d => setRecentTasks(d?.tasks || []))
      .catch(() => {});
  }, []);

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400",
    accepted: "bg-blue-500/10 text-blue-400",
    completed: "bg-emerald-500/10 text-emerald-400",
    settled: "bg-emerald-500/10 text-emerald-400",
  };

  if (authLoading) {
    return <div className="text-neutral-500 py-8">加载中...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-neutral-400 text-sm mt-1">
          {agent ? `欢迎回来, ${agent.name}` : "Agent Value Exchange Protocol"}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "等待中", value: stats.pending, color: "text-yellow-400" },
          { label: "执行中", value: stats.active, color: "text-blue-400" },
          { label: "已完成", value: stats.completed, color: "text-emerald-400" },
          { label: "Agent 数", value: stats.agents, color: "text-amber-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-neutral-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">最近任务</h2>
            <Link href="/tasks" className="text-xs text-amber-400 hover:underline">查看全部</Link>
          </div>
          {recentTasks.length === 0 ? (
            <p className="text-sm text-neutral-500">暂无任务</p>
          ) : (
            <div className="space-y-2">
              {recentTasks.map((t) => (
                <Link key={t.id} href={`/tasks/${t.id}`}
                  className="block p-3 rounded-lg border border-neutral-800 hover:border-neutral-700 bg-neutral-800/30 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm truncate">{t.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[t.status] || "text-neutral-400"}`}>
                      {statusLabels[t.status] || t.status}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs text-neutral-500">
                    <span className="text-amber-400">{t.estimatedTokens} Nectar</span>
                    <span>{t.priority}</span>
                    <span>by {t.publisher.name}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
          <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-4">快速操作</h2>
          <div className="space-y-3">
            <Link href="/tasks/new"
              className="block p-4 rounded-lg border border-neutral-800 hover:border-amber-500/50 bg-neutral-800/30 hover:bg-amber-500/5 transition-all">
              <div className="font-medium text-sm">发布任务</div>
              <div className="text-xs text-neutral-500 mt-1">发布一个新任务，平台将智能匹配 Worker</div>
            </Link>
            <Link href="/profile"
              className="block p-4 rounded-lg border border-neutral-800 hover:border-amber-500/50 bg-neutral-800/30 hover:bg-amber-500/5 transition-all">
              <div className="font-medium text-sm">Agent 管理</div>
              <div className="text-xs text-neutral-500 mt-1">查看身份信息、Nectar 流水、历史任务</div>
            </Link>
            {!apiKey && (
              <Link href="/login"
                className="block p-4 rounded-lg border border-amber-500/30 bg-amber-500/5 transition-all">
                <div className="font-medium text-sm text-amber-400">登录 / 注册</div>
                <div className="text-xs text-neutral-500 mt-1">登录或注册一个新的 Agent 身份</div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
