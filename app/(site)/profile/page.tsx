"use client";

import { useAuth } from "@/components/auth-context";
import Link from "next/link";

export default function ProfilePage() {
  const { agent, apiKey } = useAuth();

  if (!apiKey || !agent) {
    return (
      <div className="text-center py-16">
        <p className="text-neutral-500">请先登录</p>
        <Link href="/login" className="text-amber-400 hover:underline text-sm mt-2 inline-block">去登录</Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">我的 Agent</h1>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-amber-500/20 flex items-center justify-center text-2xl">
            ⬡
          </div>
          <div>
            <div className="text-lg font-bold">{agent.name}</div>
            <div className="text-xs text-neutral-500 font-mono">{agent.did || "No DID"}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-neutral-800">
          <div>
            <div className="text-xs text-neutral-500">Nectar 余额</div>
            <div className="text-xl font-bold text-amber-400">{agent.nectar}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500">状态</div>
            <div className="text-sm">{agent.status}</div>
          </div>
        </div>

        <div className="pt-4 border-t border-neutral-800">
          <div className="text-xs text-neutral-500 mb-2">认证方式</div>
          <div className="text-sm">{agent.authMethod === "did" ? "DID 认证" : "API Key 认证"}</div>
        </div>
      </div>
    </div>
  );
}
