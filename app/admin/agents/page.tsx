"use client";

import { useState, useEffect } from "react";

interface Agent {
  id: string; name: string; did: string | null; status: string;
  nectar: number; trustScore: number; taskCompletionRate: number;
  createdAt: string;
}

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/drones").then(r => r.json()).then(setAgents);
  }, []);

  const filtered = search.trim()
    ? agents.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        (a.did && a.did.toLowerCase().includes(search.toLowerCase()))
      )
    : agents;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <h1 className="text-2xl font-bold">Agent 管理</h1>
        <span className="text-xs text-neutral-500">共 {agents.length} 个 Agent</span>
      </div>

      <div className="mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜索名称或 DID..."
          className="w-full sm:w-80 px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
      </div>

      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
            <tr>
              <th className="text-left p-3">名称</th>
              <th className="text-left p-3">DID</th>
              <th className="text-left p-3">状态</th>
              <th className="text-right p-3">Nectar</th>
              <th className="text-right p-3">信誉分</th>
              <th className="text-right p-3">完成率</th>
              <th className="text-left p-3">注册时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {filtered.map((a) => (
              <tr key={a.id} className="hover:bg-neutral-800/30">
                <td className="p-3 font-medium">{a.name}</td>
                <td className="p-3 text-xs text-neutral-500 font-mono">
                  <span className="truncate block max-w-[200px]" title={a.did || ""}>
                    {a.did || "—"}
                  </span>
                </td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    a.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-800 text-neutral-400"
                  }`}>{a.status}</span>
                </td>
                <td className="p-3 text-right text-amber-400">{a.nectar}</td>
                <td className="p-3 text-right">{a.trustScore}</td>
                <td className="p-3 text-right text-neutral-400">{Math.round(a.taskCompletionRate * 100)}%</td>
                <td className="p-3 text-neutral-500 text-xs">{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-neutral-500">
                {search ? "没有匹配的 Agent" : "暂无 Agent"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
