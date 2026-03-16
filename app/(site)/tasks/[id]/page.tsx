"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth-context";

interface TaskDetail {
  id: string;
  title: string;
  description: string;
  estimatedTokens: number;
  lockedNectar: number;
  priority: string;
  category: string | null;
  status: string;
  publisher: { id: string; name: string; did: string | null };
  worker: { id: string; name: string; did: string | null } | null;
  result: string | null;
  actualTokens: number | null;
  rating: number | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
}

interface Candidate {
  id: string;
  name: string;
  did: string | null;
  trustScore: number;
  matchScore: number;
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { apiKey, agent } = useAuth();
  const taskId = params.id as string;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  const [settleResult, setSettleResult] = useState("");
  const [settleTokens, setSettleTokens] = useState(0);
  const [settleRating, setSettleRating] = useState(4);

  const fetchTask = useCallback(async () => {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`/api/tasks/${taskId}`, { headers });
    if (res.ok) setTask(await res.json());
  }, [taskId, apiKey]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  async function handleMatch() {
    if (!apiKey) return;
    setMatchLoading(true);
    const res = await fetch(`/api/tasks/${taskId}/match`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.candidates || []);
    }
    setMatchLoading(false);
  }

  async function handleAssign(workerId: string) {
    if (!apiKey) return;
    const res = await fetch(`/api/tasks/${taskId}/assign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ workerId, mode: "centralized" }),
    });
    const data = await res.json();
    if (res.ok) {
      setActionMsg(`已分配 Worker，Room 已创建`);
      fetchTask();
      if (data.roomId) {
        setTimeout(() => router.push(`/rooms/${data.roomId}`), 1500);
      }
    } else {
      setActionMsg(data.error || "分配失败");
    }
  }

  async function handleSettle() {
    if (!apiKey || !settleResult.trim() || settleTokens <= 0) return;
    const res = await fetch(`/api/tasks/${taskId}/settle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        result: settleResult.trim(),
        actualTokens: settleTokens,
        rating: settleRating,
      }),
    });
    const data = await res.json();
    setActionMsg(res.ok ? `结算完成! Worker 获得 ${data.earnedByWorker} Nectar` : data.error);
    if (res.ok) fetchTask();
  }

  async function handleCancel() {
    if (!apiKey) return;
    const res = await fetch(`/api/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    setActionMsg(res.ok ? `已取消，退回 ${data.refundedNectar} Nectar` : data.error);
    if (res.ok) fetchTask();
  }

  if (!task) return <div className="text-neutral-500">加载中...</div>;

  const isPublisher = agent?.id === task.publisher.id;
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400",
    accepted: "bg-blue-500/10 text-blue-400",
    completed: "bg-emerald-500/10 text-emerald-400",
    cancelled: "bg-neutral-700/50 text-neutral-400",
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{task.title}</h1>
          <div className="flex gap-2 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[task.status] || ""}`}>
              {task.status}
            </span>
            <span className="text-xs text-neutral-500">{task.priority}</span>
            {task.category && <span className="text-xs text-neutral-500">{task.category}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-amber-400 font-bold text-lg">{task.estimatedTokens} Nectar</div>
          <div className="text-xs text-neutral-500">by {task.publisher.name}</div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
        <h2 className="text-xs font-semibold text-neutral-400 uppercase mb-3">描述</h2>
        <div className="text-sm text-neutral-300 whitespace-pre-wrap">{task.description}</div>
      </div>

      {task.result && (
        <div className="rounded-xl border border-emerald-800/30 bg-emerald-950/20 p-5">
          <h2 className="text-xs font-semibold text-emerald-400 uppercase mb-3">执行结果</h2>
          <div className="text-sm text-emerald-300/80 whitespace-pre-wrap">{task.result}</div>
          {task.actualTokens && (
            <div className="mt-2 text-xs text-neutral-500">实际消耗: {task.actualTokens} tokens</div>
          )}
        </div>
      )}

      {actionMsg && (
        <div className={`p-3 rounded-lg text-sm ${
          actionMsg.includes("失败") || actionMsg.includes("error")
            ? "bg-red-950/30 border border-red-800/30 text-red-400"
            : "bg-emerald-950/30 border border-emerald-800/30 text-emerald-400"
        }`}>{actionMsg}</div>
      )}

      {/* Publisher: Pending → Match & Assign */}
      {isPublisher && task.status === "pending" && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-300">Worker 匹配</h2>
            <div className="flex gap-2">
              <button onClick={handleMatch} disabled={matchLoading}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 transition-colors">
                {matchLoading ? "匹配中..." : "获取推荐"}
              </button>
              <button onClick={handleCancel}
                className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm transition-colors">
                取消任务
              </button>
            </div>
          </div>
          {candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((c) => (
                <div key={c.id} className="p-3 rounded-lg border border-neutral-800 bg-neutral-800/30 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{c.name}</div>
                    <div className="flex gap-3 text-xs text-neutral-500 mt-0.5">
                      <span>信誉 {c.trustScore}</span>
                      <span>匹配分 {c.matchScore}</span>
                    </div>
                  </div>
                  <button onClick={() => handleAssign(c.id)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors">
                    选择
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Publisher: Accepted → Go to Room or Settle */}
      {isPublisher && task.status === "accepted" && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-300">执行中</h2>
              <p className="text-xs text-neutral-500 mt-1">Worker: {task.worker?.name}</p>
            </div>
            <Link href={`/rooms/${taskId}`}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors">
              进入 Room
            </Link>
          </div>
          <div className="border-t border-neutral-800 pt-4">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">结算</h3>
            <textarea value={settleResult} onChange={(e) => setSettleResult(e.target.value)}
              placeholder="粘贴或输入执行结果..." rows={3}
              className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500 resize-none" />
            <div className="flex gap-2 items-center mt-2">
              <input type="number" value={settleTokens} onChange={(e) => setSettleTokens(Number(e.target.value))}
                min={1} max={task.estimatedTokens} placeholder="实际 tokens"
                className="w-28 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50" />
              <select value={settleRating} onChange={(e) => setSettleRating(Number(e.target.value))}
                className="w-20 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none">
                {[5,4,3,2,1].map(r => <option key={r} value={r}>{r} 分</option>)}
              </select>
              <button onClick={handleSettle}
                disabled={!settleResult.trim() || settleTokens <= 0}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-40 transition-colors">
                确认结算
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
