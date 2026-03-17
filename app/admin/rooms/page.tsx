"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAdmin } from "@/components/admin-context";

interface RoomItem {
  id: string;
  mode: string;
  status: string;
  createdAt: string;
  task: {
    id: string;
    title: string;
    status: string;
    publisher: { name: string };
    worker: { name: string } | null;
  };
  messageCount: number;
  latestCheckpoint: { progress: number; sequence: number } | null;
}

export default function AdminRoomsPage() {
  const { adminFetch } = useAdmin();
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"" | "active" | "closed">("");

  useEffect(() => {
    adminFetch("/api/admin/rooms")
      .then((r) => (r.ok ? r.json() : { rooms: [] }))
      .then((d) => setRooms(d.rooms || []))
      .finally(() => setLoading(false));
  }, [adminFetch]);

  const filtered = filter ? rooms.filter(r => r.status === filter) : rooms;

  const statusColors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-400",
    closed: "bg-neutral-700/50 text-neutral-400",
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold">Room 管理</h1>
        <div className="flex gap-1">
          {(["", "active", "closed"] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded text-xs ${
                filter === s ? "bg-amber-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white"
              }`}>
              {s === "" ? "全部" : s === "active" ? "活跃" : "已关闭"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-neutral-500">加载中...</p>
      ) : filtered.length === 0 ? (
        <p className="text-neutral-500">暂无 Room</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Link key={r.id} href={`/admin/rooms/${r.id}`}
              className="block rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 hover:border-neutral-700 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{r.task.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[r.status] || ""}`}>
                    {r.status}
                  </span>
                </div>
                <span className="text-xs text-neutral-500">{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              <div className="flex gap-4 text-xs text-neutral-500 flex-wrap">
                <span>Publisher: <span className="text-neutral-300">{r.task.publisher.name}</span></span>
                <span>Worker: <span className="text-neutral-300">{r.task.worker?.name || "—"}</span></span>
                <span className="text-amber-400">{r.messageCount} 条消息</span>
                {r.latestCheckpoint && (
                  <span>进度: {Math.round(r.latestCheckpoint.progress * 100)}%</span>
                )}
                <span className="text-neutral-600 font-mono">{r.id.slice(0, 12)}...</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="text-xs text-neutral-600 mt-3">共 {filtered.length} 个 Room</div>
    </div>
  );
}
