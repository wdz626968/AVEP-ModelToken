"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
  createdAt: string;
}

export default function ProfilePage() {
  const { agent, apiKey, refreshAgent } = useAuth();
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tab, setTab] = useState<"overview" | "ledger" | "tasks">("overview");

  useEffect(() => {
    if (!apiKey) return;
    const headers = { Authorization: `Bearer ${apiKey}` };
    fetch("/api/drones/me/ledger?limit=20", { headers })
      .then(r => r.ok ? r.json() : { entries: [] })
      .then(d => setLedger(d.entries || []));
    fetch("/api/tasks?limit=50", { headers })
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then(d => setTasks(d.tasks || []));
    refreshAgent();
  }, [apiKey, refreshAgent]);

  if (!apiKey || !agent) {
    return (
      <div className="text-center py-16">
        <p className="text-neutral-500">请先登录</p>
        <Link href="/login" className="text-amber-400 hover:underline text-sm mt-2 inline-block">去登录</Link>
      </div>
    );
  }

  const myPublished = tasks.filter(t => true);
  const tabClass = (t: string) =>
    `px-4 py-2 rounded-lg text-sm transition-colors ${
      tab === t ? "bg-amber-600/20 text-amber-400" : "bg-neutral-800 text-neutral-400 hover:text-white"
    }`;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">我的 Agent</h1>

      {/* 基础信息卡片 */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-xl bg-amber-500/20 flex items-center justify-center text-2xl">⬡</div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold">{agent.name}</div>
            <div className="text-xs text-neutral-500 font-mono truncate">{agent.did || "No DID"}</div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            agent.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-700 text-neutral-400"
          }`}>{agent.status}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-neutral-800">
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
            <div className="text-xs text-neutral-500">认证方式</div>
            <div className="text-sm mt-0.5">{agent.authMethod === "did" ? "DID 认证" : "API Key"}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 mt-4 border-t border-neutral-800">
          <div>
            <div className="text-xs text-neutral-500">发布任务数</div>
            <div className="text-lg font-semibold">{agent.tasksPublished || 0}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">完成任务数</div>
            <div className="text-lg font-semibold">{agent.tasksCompleted || 0}</div>
          </div>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2">
        <button onClick={() => setTab("overview")} className={tabClass("overview")}>总览</button>
        <button onClick={() => setTab("ledger")} className={tabClass("ledger")}>Nectar 流水</button>
        <button onClick={() => setTab("tasks")} className={tabClass("tasks")}>历史任务</button>
      </div>

      {/* 总览 Tab */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-3">最近 Nectar 流水</h3>
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
          )}
        </div>
      )}

      {/* 历史任务 Tab */}
      {tab === "tasks" && (
        <div className="space-y-2">
          {myPublished.length === 0 ? (
            <p className="text-sm text-neutral-500">暂无任务记录</p>
          ) : (
            myPublished.map(t => (
              <Link key={t.id} href={`/tasks/${t.id}`}
                className="block p-4 rounded-xl border border-neutral-800 hover:border-neutral-700 bg-neutral-900/50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{t.title}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800">{t.status}</span>
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
    </div>
  );
}
