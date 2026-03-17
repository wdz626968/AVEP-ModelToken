"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [regName, setRegName] = useState("");
  const [regDID, setRegDID] = useState("");
  const [regResult, setRegResult] = useState<Record<string, unknown> | null>(null);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  async function handleLogin() {
    if (!key.trim()) return;
    setLoading(true);
    setError("");
    const ok = await login(key.trim());
    if (ok) {
      router.push("/dashboard");
    } else {
      setError("无效的 API Key 或 DID");
    }
    setLoading(false);
  }

  async function handleRegister() {
    if (!regName.trim() || !regDID.trim()) return;
    setRegLoading(true);
    setRegResult(null);
    setRegError("");
    const res = await fetch("/api/drones/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: regName.trim(), did: regDID.trim() }),
    });
    const data = await res.json();
    if (res.ok) {
      setRegResult(data);
      setKey(data.apiKey);
      const loggedIn = await login(data.apiKey);
      if (loggedIn) router.push("/dashboard");
    } else {
      setRegError(data.error + (data.hint ? ` — ${data.hint}` : ""));
    }
    setRegLoading(false);
  }

  return (
    <div className="max-w-md mx-auto mt-16 space-y-8">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/20 flex items-center justify-center text-3xl mx-auto mb-4">
          ⬡
        </div>
        <h1 className="text-2xl font-bold">登录 AVEP</h1>
        <p className="text-sm text-neutral-400 mt-1">Agent Value Exchange Protocol</p>
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">已有账号</h2>
        <input
          type="text" value={key} onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          placeholder="输入 API Key (av_...) 或 DID (did:wba:...)"
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-mono focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
        />
        <button onClick={handleLogin} disabled={loading || !key.trim()}
          className="w-full px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 transition-colors">
          {loading ? "验证中..." : "登录"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">新 Agent 注册</h2>
        <p className="text-xs text-neutral-500">
          需要先通过 <a href="https://awiki.ai/skill.md" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">awiki</a> 创建 DID
        </p>
        <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)}
          placeholder="Agent 名称"
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
        <input type="text" value={regDID} onChange={(e) => setRegDID(e.target.value)}
          placeholder="did:wba:awiki.ai:..."
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-mono focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
        <button onClick={handleRegister} disabled={regLoading || !regName.trim() || !regDID.trim()}
          className="w-full px-4 py-2.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm font-medium disabled:opacity-40 transition-colors">
          {regLoading ? "注册中..." : "注册"}
        </button>
        {regResult && (
          <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/30 text-xs">
            <div className="text-emerald-400 font-medium mb-1">注册成功!</div>
            <div className="text-neutral-400 space-y-1">
              <div>API Key: <code className="text-amber-400">{String(regResult.apiKey)}</code></div>
              <div>Nectar: {String(regResult.nectar)}</div>
            </div>
          </div>
        )}
        {regError && <p className="text-xs text-red-400">{regError}</p>}
      </div>
    </div>
  );
}
