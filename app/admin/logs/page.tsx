"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAdmin } from "@/components/admin-context";

interface LogEntry {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
  drone: { id: string; name: string };
  task: { id: string; title: string } | null;
}

const TYPE_FILTERS = ["", "lock", "earn", "refund", "init"];
const TYPE_LABELS: Record<string, string> = {
  "": "全部", lock: "锁定", earn: "收入", refund: "退款", init: "初始化",
};

export default function AdminLogsPage() {
  const { adminFetch } = useAdmin();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async (cursor?: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter) params.set("type", typeFilter);
    params.set("limit", "50");
    if (cursor) params.set("cursor", cursor);
    const res = await adminFetch(`/api/admin/logs?${params}`);
    if (res.ok) {
      const data = await res.json();
      if (cursor) {
        setEntries(prev => [...prev, ...data.entries]);
      } else {
        setEntries(data.entries || []);
      }
      setNextCursor(data.nextCursor || null);
    }
    setLoading(false);
  }, [typeFilter, adminFetch]);

  useEffect(() => {
    setEntries([]);
    setNextCursor(null);
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold">系统日志</h1>
        <div className="flex gap-1">
          {TYPE_FILTERS.map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 rounded text-xs ${
                typeFilter === t ? "bg-amber-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white"
              }`}>
              {TYPE_LABELS[t] || t}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-neutral-500 mb-4">
        Nectar 交易流水 — 所有 Agent 的资金变动记录
      </p>

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
            <tr>
              <th className="text-left p-3">时间</th>
              <th className="text-left p-3">Agent</th>
              <th className="text-left p-3">类型</th>
              <th className="text-right p-3">金额</th>
              <th className="text-right p-3">余额</th>
              <th className="text-left p-3">关联任务</th>
              <th className="text-left p-3">说明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {entries.map(e => (
              <tr key={e.id} className="hover:bg-neutral-800/30">
                <td className="p-3 text-xs text-neutral-500 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="p-3 text-neutral-300">{e.drone.name}</td>
                <td className="p-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800">
                    {TYPE_LABELS[e.type] || e.type}
                  </span>
                </td>
                <td className={`p-3 text-right font-mono font-semibold ${
                  e.amount > 0 ? "text-emerald-400" : "text-red-400"
                }`}>
                  {e.amount > 0 ? "+" : ""}{e.amount}
                </td>
                <td className="p-3 text-right text-amber-400">{e.balanceAfter}</td>
                <td className="p-3">
                  {e.task ? (
                    <Link href="/admin/rooms" className="text-amber-400 hover:underline text-xs truncate block max-w-[120px]">
                      {e.task.title}
                    </Link>
                  ) : <span className="text-neutral-600">—</span>}
                </td>
                <td className="p-3 text-xs text-neutral-500 max-w-[150px] truncate">
                  {e.description || "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && !loading && (
              <tr><td colSpan={7} className="p-8 text-center text-neutral-500">暂无日志记录</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="text-center mt-6">
          <button
            onClick={() => fetchLogs(nextCursor)}
            disabled={loading}
            className="px-6 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition-colors disabled:opacity-40">
            {loading ? "加载中..." : "加载更多"}
          </button>
        </div>
      )}
    </div>
  );
}
