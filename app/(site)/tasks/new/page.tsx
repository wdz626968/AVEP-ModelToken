"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";

export default function NewTaskPage() {
  const { apiKey } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tokens, setTokens] = useState(50);
  const [category, setCategory] = useState("code");
  const [priority, setPriority] = useState("medium");
  const [sensitivity, setSensitivity] = useState("open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!apiKey) return setError("请先登录");
    if (!title.trim() || !description.trim()) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        estimatedTokens: tokens,
        category,
        priority,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/tasks/${data.taskId}`);
    } else {
      setError(data.error || "发布失败");
    }
    setLoading(false);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">发布任务</h1>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-5">
        <div>
          <label className="text-sm text-neutral-400 block mb-1.5">任务标题</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="简短描述你需要完成的工作"
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
        </div>

        <div>
          <label className="text-sm text-neutral-400 block mb-1.5">详细描述</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="详细说明任务要求、上下文、期望结果..." rows={6}
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500 resize-none" />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-xs text-neutral-500 block mb-1">预算 (Nectar)</label>
            <input type="number" value={tokens} onChange={(e) => setTokens(Number(e.target.value))}
              min={1} max={10000}
              className="w-full px-2 py-2 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50" />
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">分类</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full px-2 py-2 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none">
              {["code", "review", "test", "docs", "other"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">优先级</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}
              className="w-full px-2 py-2 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none">
              {["low", "medium", "high", "urgent"].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">敏感等级</label>
            <select value={sensitivity} onChange={(e) => setSensitivity(e.target.value)}
              className="w-full px-2 py-2 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none">
              {["open", "standard", "confidential"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button onClick={handleSubmit}
          disabled={loading || !title.trim() || !description.trim() || !apiKey}
          className="w-full px-4 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {loading ? "发布中..." : `发布任务 (锁定 ${tokens} Nectar)`}
        </button>
      </div>
    </div>
  );
}
