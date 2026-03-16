"use client";

import { useState, useEffect } from "react";

export default function AdminDashboard() {
  const [stats, setStats] = useState({ tasks: 0, agents: 0, pending: 0, active: 0, completed: 0 });

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then(r => r.json()),
      fetch("/api/tasks?status=pending").then(r => r.json()),
      fetch("/api/tasks?status=accepted").then(r => r.json()),
      fetch("/api/tasks?status=completed").then(r => r.json()),
      fetch("/api/drones").then(r => r.json()),
    ]).then(([all, p, a, c, d]) => {
      setStats({
        tasks: all.tasks?.length || 0,
        pending: p.tasks?.length || 0,
        active: a.tasks?.length || 0,
        completed: c.tasks?.length || 0,
        agents: d.length || 0,
      });
    });
  }, []);

  const cards = [
    { label: "总任务数", value: stats.tasks, color: "text-white" },
    { label: "等待中", value: stats.pending, color: "text-yellow-400" },
    { label: "执行中", value: stats.active, color: "text-blue-400" },
    { label: "已完成", value: stats.completed, color: "text-emerald-400" },
    { label: "Agent 总数", value: stats.agents, color: "text-amber-400" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">管理总览</h1>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-neutral-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
