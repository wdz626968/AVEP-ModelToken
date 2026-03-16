"use client";

import { useState, useEffect } from "react";

interface Task {
  id: string; title: string; status: string; priority: string;
  estimatedTokens: number; publisher: { name: string }; createdAt: string;
}

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const url = filter ? `/api/tasks?status=${filter}` : "/api/tasks";
    fetch(url).then(r => r.json()).then(d => setTasks(d.tasks || []));
  }, [filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">任务管理</h1>
        <div className="flex gap-1">
          {["", "pending", "accepted", "completed", "cancelled"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded text-xs ${filter === s ? "bg-amber-600 text-white" : "bg-neutral-800 text-neutral-400"}`}>
              {s || "全部"}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
            <tr>
              <th className="text-left p-3">标题</th>
              <th className="text-left p-3">状态</th>
              <th className="text-left p-3">优先级</th>
              <th className="text-right p-3">Tokens</th>
              <th className="text-left p-3">发布者</th>
              <th className="text-left p-3">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {tasks.map((t) => (
              <tr key={t.id} className="hover:bg-neutral-800/30">
                <td className="p-3 font-medium">{t.title}</td>
                <td className="p-3"><span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800">{t.status}</span></td>
                <td className="p-3 text-neutral-400">{t.priority}</td>
                <td className="p-3 text-right text-amber-400">{t.estimatedTokens}</td>
                <td className="p-3 text-neutral-400">{t.publisher.name}</td>
                <td className="p-3 text-neutral-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
