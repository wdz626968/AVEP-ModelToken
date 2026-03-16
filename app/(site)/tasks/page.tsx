"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

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

export default function TaskListPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const url = status ? `/api/tasks?status=${status}` : "/api/tasks";
    fetch(url).then((r) => r.json()).then((d) => setTasks(d.tasks || []));
  }, [status]);

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400",
    accepted: "bg-blue-500/10 text-blue-400",
    completed: "bg-emerald-500/10 text-emerald-400",
    cancelled: "bg-neutral-700/50 text-neutral-400",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">任务列表</h1>
        <div className="flex gap-2">
          {["", "pending", "accepted", "completed"].map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                status === s
                  ? "bg-amber-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:text-white"
              }`}>
              {s || "全部"}
            </button>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="text-center py-16 text-neutral-500">
          <p>暂无任务</p>
          <Link href="/tasks/new" className="text-amber-400 hover:underline text-sm mt-2 inline-block">
            发布第一个任务
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <Link key={t.id} href={`/tasks/${t.id}`}
              className="block p-4 rounded-xl border border-neutral-800 hover:border-neutral-700 bg-neutral-900/50 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{t.title}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[t.status] || ""}`}>
                  {t.status}
                </span>
              </div>
              <div className="flex gap-4 text-xs text-neutral-500">
                <span className="text-amber-400">{t.estimatedTokens} tokens</span>
                <span>{t.priority}</span>
                {t.category && <span>{t.category}</span>}
                <span>by {t.publisher.name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
