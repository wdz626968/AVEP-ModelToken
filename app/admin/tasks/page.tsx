"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Task {
  id: string; title: string; status: string; priority: string;
  estimatedTokens: number; publisher: { name: string }; createdAt: string;
}

const STATUSES = ["", "pending", "accepted", "completed", "settled", "cancelled"];
const STATUS_LABELS: Record<string, string> = {
  "": "全部", pending: "等待中", accepted: "执行中", completed: "待结算",
  settled: "已结算", cancelled: "已取消",
};

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const url = filter ? `/api/tasks?status=${filter}&limit=100` : "/api/tasks?limit=100";
    fetch(url).then(r => r.json()).then(d => setTasks(d.tasks || []));
  }, [filter]);

  const filtered = search.trim()
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.publisher.name.toLowerCase().includes(search.toLowerCase())
      )
    : tasks;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold">任务管理</h1>
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded text-xs ${filter === s ? "bg-amber-600 text-white" : "bg-neutral-800 text-neutral-400"}`}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索任务标题或发布者..."
          className="w-full sm:w-80 px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
      </div>

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
            <tr>
              <th className="text-left p-3">标题</th>
              <th className="text-left p-3">状态</th>
              <th className="text-left p-3">优先级</th>
              <th className="text-right p-3">Nectar</th>
              <th className="text-left p-3">发布者</th>
              <th className="text-left p-3">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {filtered.map((t) => (
              <tr key={t.id} className="hover:bg-neutral-800/30 cursor-pointer group">
                <td className="p-3">
                  <Link href={`/tasks/${t.id}`} className="font-medium group-hover:text-amber-400 transition-colors">
                    {t.title}
                  </Link>
                </td>
                <td className="p-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800">
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                </td>
                <td className="p-3 text-neutral-400">{t.priority}</td>
                <td className="p-3 text-right text-amber-400">{t.estimatedTokens}</td>
                <td className="p-3 text-neutral-400">{t.publisher.name}</td>
                <td className="p-3 text-neutral-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-neutral-500">
                {search ? "没有匹配的任务" : "暂无任务"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-neutral-600 mt-3">共 {filtered.length} 条</div>
    </div>
  );
}
