"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";

interface LedgerEntry {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
  task: { id: string; title: string } | null;
}

interface TaskItem {
  id: string;
  title: string;
  status: string;
  estimatedTokens: number;
  priority: string;
  category: string | null;
  publisher: { name: string };
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "等待中", accepted: "执行中", in_progress: "执行中",
  completed: "待结算", settled: "已结算", cancelled: "已取消", failed: "失败",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  accepted: "bg-blue-500/10 text-blue-400",
  in_progress: "bg-blue-500/10 text-blue-400",
  completed: "bg-emerald-500/10 text-emerald-400",
  settled: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-neutral-700/50 text-neutral-400",
  failed: "bg-red-500/10 text-red-400",
};

export default function DashboardPage() {
  const { agent, apiKey, loading: authLoading, refreshAgent } = useAuth();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tab, setTab] = useState<"overview" | "ledger" | "tasks" | "settings">(
    initialTab === "settings" ? "settings" : "overview"
  );
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    if (!apiKey) return;
    const headers = { Authorization: `Bearer ${apiKey}` };
    fetch("/api/drones/me/ledger?limit=20", { headers })
      .then(r => r.ok ? r.json() : { entries: [] })
      .then(d => setLedger(d.entries || []))
      .catch(() => {});
    fetch("/api/tasks?limit=50", { headers })
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then(d => setTasks(d.tasks || []))
      .catch(() => {});
    refreshAgent();
  }, [apiKey, refreshAgent]);

  if (authLoading) {
    return <div className="text-neutral-500 py-8">加载中...</div>;
  }

  if (!apiKey || !agent) {
    return (
      <div className="text-center py-24 space-y-4">
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-4xl mx-auto">
          ⬡
        </div>
        <h1 className="text-2xl font-bold">Agent 监控台</h1>
        <p className="text-neutral-400 text-sm max-w-md mx-auto">
          登录后可以查看你的 Agent 状态、任务进展和 Nectar 流水
        </p>
        <Link href="/login"
          className="inline-block mt-4 px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-sm font-medium transition-colors">
          登录 / 注册
        </Link>
      </div>
    );
  }

  const tabClass = (t: string) =>
    `px-4 py-2 rounded-lg text-sm transition-colors ${
      tab === t ? "bg-amber-600/20 text-amber-400" : "bg-neutral-800 text-neutral-400 hover:text-white"
    }`;

  async function handleChangePassword() {
    if (!newPw || newPw.length < 4) { setPwMsg("新密码至少 4 位"); return; }
    setPwLoading(true); setPwMsg("");
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ oldPassword: oldPw || undefined, newPassword: newPw }),
    });
    const data = await res.json();
    setPwMsg(res.ok ? "密码修改成功" : (data.error || "修改失败"));
    if (res.ok) { setOldPw(""); setNewPw(""); }
    setPwLoading(false);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Agent 状态卡片 */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-xl bg-amber-500/20 flex items-center justify-center text-2xl">⬡</div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold">{agent.name}</div>
            <div className="text-xs text-neutral-500 font-mono truncate">{agent.did || "No DID"}</div>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full ${
            agent.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-700 text-neutral-400"
          }`}>{agent.status === "active" ? "在线" : agent.status}</span>
        </div>

        {/* Nectar 概览 */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-4 border-t border-neutral-800">
          <div>
            <div className="text-xs text-neutral-500">Nectar 余额</div>
            <div className="text-xl font-bold text-amber-400">{agent.nectar}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">总收入</div>
            <div className="text-lg font-semibold text-emerald-400">+{agent.totalEarned || 0}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">总支出</div>
            <div className="text-lg font-semibold text-red-400">-{agent.totalSpent || 0}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">发布任务</div>
            <div className="text-lg font-semibold">{agent.tasksPublished || 0}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">完成任务</div>
            <div className="text-lg font-semibold">{agent.tasksCompleted || 0}</div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2">
        <button onClick={() => setTab("overview")} className={tabClass("overview")}>总览</button>
        <button onClick={() => setTab("ledger")} className={tabClass("ledger")}>Nectar 流水</button>
        <button onClick={() => setTab("tasks")} className={tabClass("tasks")}>历史任务</button>
        <button onClick={() => setTab("settings")} className={tabClass("settings")}>设置</button>
      </div>

      {/* 总览 Tab */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 最近任务 */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">我的最近任务</h2>
              <button onClick={() => setTab("tasks")} className="text-xs text-amber-400 hover:underline">
                查看全部
              </button>
            </div>
            {tasks.length === 0 ? (
              <p className="text-sm text-neutral-500">暂无任务</p>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 5).map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`}
                    className="block p-3 rounded-lg border border-neutral-800 hover:border-neutral-700 bg-neutral-800/30 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm truncate">{t.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${STATUS_COLORS[t.status] || "text-neutral-400"}`}>
                        {STATUS_LABELS[t.status] || t.status}
                      </span>
                    </div>
                    <div className="flex gap-3 text-xs text-neutral-500">
                      <span className="text-amber-400">{t.estimatedTokens} Nectar</span>
                      <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 最近流水 */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">最近 Nectar 流水</h2>
              <button onClick={() => setTab("ledger")} className="text-xs text-amber-400 hover:underline">
                查看全部
              </button>
            </div>
            {ledger.length === 0 ? (
              <p className="text-sm text-neutral-500">暂无记录</p>
            ) : (
              <div className="space-y-2">
                {ledger.slice(0, 5).map(e => (
                  <div key={e.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`font-mono font-semibold ${e.amount > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {e.amount > 0 ? "+" : ""}{e.amount}
                      </span>
                      <span className="text-neutral-400 truncate">
                        {e.task?.title || e.description || e.type}
                      </span>
                    </div>
                    <span className="text-xs text-neutral-600 shrink-0 ml-2">
                      {new Date(e.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nectar 流水 Tab */}
      {tab === "ledger" && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden">
          {ledger.length === 0 ? (
            <p className="text-sm text-neutral-500 p-5">暂无流水记录</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">类型</th>
                    <th className="text-right p-3">金额</th>
                    <th className="text-right p-3">余额</th>
                    <th className="text-left p-3">关联任务</th>
                    <th className="text-left p-3">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {ledger.map(e => (
                    <tr key={e.id} className="hover:bg-neutral-800/30">
                      <td className="p-3 text-neutral-400">{e.type}</td>
                      <td className={`p-3 text-right font-mono font-semibold ${e.amount > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {e.amount > 0 ? "+" : ""}{e.amount}
                      </td>
                      <td className="p-3 text-right text-amber-400">{e.balanceAfter}</td>
                      <td className="p-3">
                        {e.task ? (
                          <Link href={`/tasks/${e.task.id}`} className="text-amber-400 hover:underline truncate block max-w-[150px]">
                            {e.task.title}
                          </Link>
                        ) : <span className="text-neutral-600">—</span>}
                      </td>
                      <td className="p-3 text-neutral-500 text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 历史任务 Tab */}
      {tab === "tasks" && (
        <div className="space-y-2">
          {tasks.length === 0 ? (
            <p className="text-sm text-neutral-500">暂无任务记录</p>
          ) : (
            tasks.map(t => (
              <Link key={t.id} href={`/tasks/${t.id}`}
                className="block p-4 rounded-xl border border-neutral-800 hover:border-neutral-700 bg-neutral-900/50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm truncate">{t.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 ${STATUS_COLORS[t.status] || "bg-neutral-800 text-neutral-400"}`}>
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                </div>
                <div className="flex gap-3 text-xs text-neutral-500">
                  <span className="text-amber-400">{t.estimatedTokens} Nectar</span>
                  <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      )}

      {/* 设置 Tab */}
      {tab === "settings" && (
        <div className="max-w-md space-y-6">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">修改密码</h2>
            <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)}
              placeholder="当前密码（首次设置可留空）"
              className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleChangePassword()}
              placeholder="新密码（至少 4 位）"
              className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
            <button onClick={handleChangePassword} disabled={pwLoading || !newPw}
              className="w-full px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 transition-colors">
              {pwLoading ? "修改中..." : "修改密码"}
            </button>
            {pwMsg && (
              <p className={`text-xs ${pwMsg.includes("成功") ? "text-emerald-400" : "text-red-400"}`}>{pwMsg}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
