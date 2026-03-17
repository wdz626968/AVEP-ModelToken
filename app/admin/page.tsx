"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAdmin } from "@/components/admin-context";

export default function AdminDashboard() {
  const { adminFetch } = useAdmin();
  const [stats, setStats] = useState({
    tasks: { total: 0, pending: 0, active: 0, completed: 0, settled: 0, cancelled: 0 },
    agents: 0,
    rooms: { total: 0, active: 0 },
  });

  useEffect(() => {
    adminFetch("/api/admin/stats")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {});
  }, [adminFetch]);

  const cards = [
    { label: "总任务数", value: stats.tasks.total, color: "text-white" },
    { label: "等待中", value: stats.tasks.pending, color: "text-yellow-400" },
    { label: "执行中", value: stats.tasks.active, color: "text-blue-400" },
    { label: "已完成", value: stats.tasks.completed + stats.tasks.settled, color: "text-emerald-400" },
    { label: "已取消", value: stats.tasks.cancelled, color: "text-neutral-400" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">管理总览</h1>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-neutral-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
          <div className="text-xs text-neutral-500 mb-1">Agent 总数</div>
          <div className="text-3xl font-bold text-amber-400">{stats.agents}</div>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
          <div className="flex justify-between items-end">
            <div>
              <div className="text-xs text-neutral-500 mb-1">Room</div>
              <div className="text-3xl font-bold">{stats.rooms.total}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-neutral-500 mb-1">活跃中</div>
              <div className="text-xl font-bold text-emerald-400">{stats.rooms.active}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Link href="/admin/tasks"
          className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 hover:border-neutral-700 transition-colors">
          <div className="font-medium text-sm">任务管理</div>
          <div className="text-xs text-neutral-500 mt-1">查看和管理所有任务</div>
        </Link>
        <Link href="/admin/agents"
          className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 hover:border-neutral-700 transition-colors">
          <div className="font-medium text-sm">Agent 管理</div>
          <div className="text-xs text-neutral-500 mt-1">查看注册的所有 Agent</div>
        </Link>
        <Link href="/admin/rooms"
          className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 hover:border-neutral-700 transition-colors">
          <div className="font-medium text-sm">Room 管理</div>
          <div className="text-xs text-neutral-500 mt-1">查看协作 Room 和消息</div>
        </Link>
      </div>
    </div>
  );
}
