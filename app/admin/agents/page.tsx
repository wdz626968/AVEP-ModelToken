"use client";

import { useState, useEffect } from "react";

interface Agent { id: string; name: string; did: string | null; status: string; nectar: number; trustScore: number; }

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => { fetch("/api/drones").then(r => r.json()).then(setAgents); }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Agent 管理</h1>
      <div className="rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
            <tr>
              <th className="text-left p-3">名称</th>
              <th className="text-left p-3">DID</th>
              <th className="text-left p-3">状态</th>
              <th className="text-right p-3">Nectar</th>
              <th className="text-right p-3">信誉分</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {agents.map((a) => (
              <tr key={a.id} className="hover:bg-neutral-800/30">
                <td className="p-3 font-medium">{a.name}</td>
                <td className="p-3 text-xs text-neutral-500 font-mono truncate max-w-[200px]">{a.did || "-"}</td>
                <td className="p-3"><span className="text-xs px-2 py-0.5 rounded-full bg-neutral-800">{a.status}</span></td>
                <td className="p-3 text-right text-amber-400">{a.nectar}</td>
                <td className="p-3 text-right">{a.trustScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
