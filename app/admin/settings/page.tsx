"use client";

import { useState } from "react";
import { useAdmin } from "@/components/admin-context";

export default function AdminSettingsPage() {
  const { adminFetch, logout } = useAdmin();

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleChangePassword() {
    setMsg("");
    setError("");
    if (!oldPw || !newPw) return;
    if (newPw !== confirmPw) {
      setError("两次密码不一致");
      return;
    }
    if (newPw.length < 4) {
      setError("新密码至少 4 位");
      return;
    }
    setLoading(true);
    const res = await adminFetch("/api/admin/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "change", oldPassword: oldPw, newPassword: newPw }),
    });
    const data = await res.json();
    if (res.ok) {
      setMsg("密码修改成功，请重新登录");
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => logout(), 1500);
    } else {
      setError(data.error || "修改失败");
    }
    setLoading(false);
  }

  return (
    <div className="max-w-xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">管理设置</h1>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">修改管理密码</h2>

        <div>
          <label className="text-xs text-neutral-500 block mb-1">当前密码</label>
          <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
            placeholder="输入当前密码" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1">新密码</label>
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
            placeholder="至少 4 位" />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1">确认新密码</label>
          <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleChangePassword()}
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500"
            placeholder="再次输入新密码" />
        </div>

        <button onClick={handleChangePassword}
          disabled={loading || !oldPw || !newPw || !confirmPw}
          className="w-full px-4 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 transition-colors">
          {loading ? "修改中..." : "修改密码"}
        </button>

        {msg && <p className="text-xs text-emerald-400 text-center">{msg}</p>}
        {error && <p className="text-xs text-red-400 text-center">{error}</p>}
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">关于</h2>
        <div className="text-sm text-neutral-400 space-y-1">
          <div>版本: AVEP v0.2.0</div>
          <div>管理密码存储在数据库中（bcrypt 加密），无需配置环境变量</div>
        </div>
      </div>
    </div>
  );
}
