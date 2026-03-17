"use client";

import { useState, useEffect, useCallback } from "react";
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

const STATUSES = ["", "pending", "accepted", "completed", "settled", "cancelled"];
const STATUS_LABELS: Record<string, string> = {
  "": "全部", pending: "等待中", accepted: "执行中", completed: "待结算",
  settled: "已结算", cancelled: "已取消",
};

export default function TaskListPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);

  const fetchTasks = useCallback(async (cursor?: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("limit", "20");
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/tasks?${params}`);
    if (res.ok) {
      const data = await res.json();
      if (cursor) {
        setTasks(prev => [...prev, ...(data.tasks || [])]);
      } else {
        setTasks(data.tasks || []);
      }
      setNextCursor(data.nextCursor || null);
    }
    setLoading(false);
  }, [status]);

  useEffect(() => {
    setTasks([]);
    setNextCursor(null);
    setPage(0);
    fetchTasks();
  }, [fetchTasks]);

  const filtered = search.trim()
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.publisher.name.toLowerCase().includes(search.toLowerCase())
      )
    : tasks;

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400",
    accepted: "bg-blue-500/10 text-blue-400",
    in_progress: "bg-blue-500/10 text-blue-400",
    completed: "bg-emerald-500/10 text-emerald-400",
    settled: "bg-emerald-500/10 text-emerald-400",
    cancelled: "bg-neutral-700/50 text-neutral-400",
    failed: "bg-red-500/10 text-red-400",
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold">任务列表</h1>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                status === s
                  ? "bg-amber-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:text-white"
              }`}>
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索任务标题或发布者..."
          className="w-full sm:w-80 px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
        />
      </div>

      {filtered.length === 0 && !loading ? (
        <div className="text-center py-16 text-neutral-500">
          <p>{search ? "没有匹配的任务" : "暂无任务"}</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {filtered.map((t) => (
              <Link key={t.id} href={`/tasks/${t.id}`}
                className="block p-4 rounded-xl border border-neutral-800 hover:border-neutral-700 bg-neutral-900/50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{t.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[t.status] || ""}`}>
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-neutral-500">
                  <span className="text-amber-400">{t.estimatedTokens} Nectar</span>
                  <span>{t.priority}</span>
                  {t.category && <span>{t.category}</span>}
                  <span>by {t.publisher.name}</span>
                  <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
          </div>

          {nextCursor && (
            <div className="text-center mt-6">
              <button
                onClick={() => { setPage(p => p + 1); fetchTasks(nextCursor); }}
                disabled={loading}
                className="px-6 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition-colors disabled:opacity-40">
                {loading ? "加载中..." : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
