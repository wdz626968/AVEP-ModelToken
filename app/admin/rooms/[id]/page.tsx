"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Message {
  id: string;
  type: string;
  content: unknown;
  sender: { name: string; did: string | null };
  createdAt: string;
}

interface RoomDetail {
  id: string;
  mode: string;
  status: string;
  task: {
    id: string;
    title: string;
    status: string;
    estimatedTokens: number;
    publisher: { name: string };
    worker: { name: string } | null;
  };
  messages: Message[];
  checkpoints: { sequence: number; progress: number; snapshot: unknown; createdAt: string }[];
}

const typeColors: Record<string, string> = {
  system: "border-neutral-700 bg-neutral-800/30",
  task_payload: "border-amber-800/30 bg-amber-950/20",
  checkpoint: "border-blue-800/30 bg-blue-950/20",
  clarify: "border-purple-800/30 bg-purple-950/20",
  result: "border-emerald-800/30 bg-emerald-950/20",
  progress: "border-cyan-800/30 bg-cyan-950/20",
};

const typeLabels: Record<string, string> = {
  system: "系统",
  task_payload: "任务详情",
  checkpoint: "进度",
  clarify: "提问",
  supplement: "补充",
  result: "结果",
  progress: "进度",
};

export default function AdminRoomDetailPage() {
  const params = useParams();
  const roomId = params.id as string;
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/rooms/${roomId}`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([data]) => {
      setRoom(data);
      setLoading(false);
    });
  }, [roomId]);

  if (loading) return <div className="text-neutral-500">加载中...</div>;
  if (!room) return <div className="text-red-400">Room 不存在</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/admin/rooms" className="hover:text-white transition-colors">Room 管理</Link>
        <span>/</span>
        <span className="text-neutral-300">{room.task.title}</span>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">{room.task.title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            room.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-700/50 text-neutral-400"
          }`}>{room.status}</span>
        </div>
        <div className="flex gap-6 text-sm text-neutral-400">
          <span>Publisher: <span className="text-neutral-200">{room.task.publisher.name}</span></span>
          <span>Worker: <span className="text-neutral-200">{room.task.worker?.name || "-"}</span></span>
          <span>任务状态: <span className="text-amber-400">{room.task.status}</span></span>
          <span>预算: <span className="text-amber-400">{room.task.estimatedTokens} Nectar</span></span>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">
          消息时间线（{room.messages.length} 条）
        </h2>
        <div className="space-y-3">
          {room.messages.map((m) => (
            <div key={m.id} className={`rounded-xl border p-4 ${typeColors[m.type] || "border-neutral-800 bg-neutral-900/50"}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-neutral-800 text-neutral-300">
                    {typeLabels[m.type] || m.type}
                  </span>
                  <span className="text-sm text-neutral-300">{m.sender.name}</span>
                </div>
                <span className="text-xs text-neutral-600">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              <pre className="text-sm text-neutral-300 whitespace-pre-wrap break-words overflow-hidden">
                {typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>

      {room.checkpoints.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4">
            Checkpoints（{room.checkpoints.length}）
          </h2>
          <div className="space-y-2">
            {room.checkpoints.map((cp, i) => (
              <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">#{cp.sequence} — {Math.round(cp.progress * 100)}%</span>
                  <span className="text-xs text-neutral-600">{new Date(cp.createdAt).toLocaleString()}</span>
                </div>
                <div className="w-full h-2 bg-neutral-800 rounded-full mb-2">
                  <div className="h-2 bg-amber-500 rounded-full" style={{ width: `${cp.progress * 100}%` }} />
                </div>
                <pre className="text-xs text-neutral-400 whitespace-pre-wrap">
                  {typeof cp.snapshot === "string" ? cp.snapshot : JSON.stringify(cp.snapshot, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
