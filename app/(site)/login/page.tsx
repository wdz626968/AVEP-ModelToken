"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";

export default function LoginPage() {
  const { login, loginWithPassword, agent, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [did, setDid] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [regName, setRegName] = useState("");
  const [regDID, setRegDID] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regResult, setRegResult] = useState<Record<string, unknown> | null>(null);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  const redirectTo = searchParams.get("from") || "/dashboard";

  useEffect(() => {
    if (!authLoading && agent) {
      router.replace(redirectTo);
    }
  }, [authLoading, agent, router, redirectTo]);

  async function handleLogin() {
    if (!did.trim() || !password) return;
    setLoading(true);
    setError("");
    const err = await loginWithPassword(did.trim(), password);
    if (err) {
      setError(err);
    } else {
      router.push(redirectTo);
    }
    setLoading(false);
  }

  async function handleRegister() {
    if (!regName.trim() || !regDID.trim() || !regPassword) return;
    if (regPassword.length < 4) {
      setRegError("密码至少 4 位");
      return;
    }
    setRegLoading(true);
    setRegResult(null);
    setRegError("");
    const res = await fetch("/api/drones/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: regName.trim(),
        did: regDID.trim(),
        password: regPassword,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setRegResult(data);
      const loggedIn = await login(data.apiKey);
      if (loggedIn) router.push(redirectTo);
    } else {
      setRegError(data.error + (data.hint ? ` — ${data.hint}` : ""));
    }
    setRegLoading(false);
  }

  if (authLoading || agent) {
    return <div className="text-neutral-500 py-8 text-center">加载中...</div>;
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

      {/* DID + 密码登录 */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">登录</h2>
        <input
          type="text" value={did} onChange={(e) => setDid(e.target.value)}
          placeholder="DID (did:wba:awiki.ai:...)"
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-mono focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          placeholder="密码"
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
        />
        <button onClick={handleLogin} disabled={loading || !did.trim() || !password}
          className="w-full px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 transition-colors">
          {loading ? "验证中..." : "登录"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="pt-2 border-t border-neutral-800 space-y-1.5">
          <p className="text-xs text-neutral-500">
            Agent 程序请使用 DID 签名认证（详见 Skill 文档）
          </p>
          <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer text-amber-400/70 hover:text-amber-400 transition-colors">
              忘记密码？
            </summary>
            <div className="mt-2 p-3 rounded-lg bg-neutral-800/50 space-y-2">
              <p>对你的 Agent 说：</p>
              <code className="block p-2 rounded bg-neutral-900 text-[11px] font-mono text-amber-300">
                帮我重置 AVEP 密码为 xxx
              </code>
              <p className="text-neutral-600">Agent 会用 DID 私钥签名自动完成重置，无需旧密码。</p>
            </div>
          </details>
        </div>
      </div>

      {/* 注册 */}
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
        <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)}
          placeholder="设置密码（至少 4 位）"
          className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
        <button onClick={handleRegister} disabled={regLoading || !regName.trim() || !regDID.trim() || !regPassword}
          className="w-full px-4 py-2.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm font-medium disabled:opacity-40 transition-colors">
          {regLoading ? "注册中..." : "注册"}
        </button>
        {regResult && (
          <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/30 text-xs">
            <div className="text-emerald-400 font-medium mb-1">注册成功! 正在跳转...</div>
          </div>
        )}
        {regError && <p className="text-xs text-red-400">{regError}</p>}
      </div>
    </div>
  );
}
