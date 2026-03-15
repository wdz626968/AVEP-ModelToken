"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────

interface DroneInfo {
  id: string;
  name: string;
  did: string | null;
  status: string;
  nectar: number;
  bondCode: string;
  trustScore: number;
  createdAt: string;
}

interface TaskInfo {
  id: string;
  title: string;
  description: string;
  estimatedTokens: number;
  lockedNectar: number;
  priority: string;
  category: string | null;
  status: string;
  publisherId: string;
  workerId: string | null;
  publisher: { id: string; name: string; did: string | null };
  createdAt: string;
}

// ── Component ────────────────────────────────────────────────────

export default function DashboardPage() {
  const [tab, setTab] = useState<"drones" | "tasks">("tasks");
  const [drones, setDrones] = useState<DroneInfo[]>([]);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [apiKey, setApiKey] = useState("");

  // Register state
  const [regName, setRegName] = useState("");
  const [regDID, setRegDID] = useState("");
  const [regResult, setRegResult] = useState<Record<string, unknown> | null>(null);
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  // Publish task state
  const [pubTitle, setPubTitle] = useState("");
  const [pubDesc, setPubDesc] = useState("");
  const [pubTokens, setPubTokens] = useState(50);
  const [pubCategory, setPubCategory] = useState("code");
  const [pubPriority, setPubPriority] = useState("medium");
  const [pubResult, setPubResult] = useState<Record<string, unknown> | null>(null);
  const [pubError, setPubError] = useState("");
  const [pubLoading, setPubLoading] = useState(false);

  // Task detail
  const [selectedTask, setSelectedTask] = useState<Record<string, unknown> | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  // Complete form
  const [settleResult, setSettleResult] = useState("");
  const [settleTokens, setSettleTokens] = useState(0);
  const [settleRating, setSettleRating] = useState(4);
  const [peerInfo, setPeerInfo] = useState<{ did: string; name: string } | null>(null);

  const fetchDrones = useCallback(async () => {
    const res = await fetch("/api/drones");
    setDrones(await res.json());
  }, []);

  const fetchTasks = useCallback(async () => {
    const url = statusFilter
      ? `/api/tasks?status=${statusFilter}`
      : "/api/tasks";
    const res = await fetch(url);
    const data = await res.json();
    setTasks(data.tasks || []);
  }, [statusFilter]);

  useEffect(() => {
    fetchDrones();
    fetchTasks();
  }, [fetchDrones, fetchTasks]);

  async function registerDrone() {
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
      setApiKey(data.apiKey);
      setRegName("");
      setRegDID("");
      fetchDrones();
    } else {
      setRegError(data.error + (data.hint ? ` — ${data.hint}` : ""));
    }
    setRegLoading(false);
  }

  async function publishTask() {
    if (!apiKey || !pubTitle.trim() || !pubDesc.trim()) return;
    setPubLoading(true);
    setPubResult(null);
    setPubError("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        title: pubTitle.trim(),
        description: pubDesc.trim(),
        estimatedTokens: pubTokens,
        category: pubCategory,
        priority: pubPriority,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setPubResult(data);
      setPubTitle("");
      setPubDesc("");
      fetchTasks();
      fetchDrones();
    } else {
      setPubError(data.error || "Failed");
    }
    setPubLoading(false);
  }

  async function viewTask(taskId: string) {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`/api/tasks/${taskId}`, { headers });
    const data = await res.json();
    setSelectedTask(data);
    setActionMsg("");
    setPeerInfo(null);
    if (apiKey && data.status === "accepted") {
      fetchPeer(taskId);
    }
  }

  async function acceptTask(taskId: string) {
    if (!apiKey) return setActionMsg("Set API Key first");
    setActionLoading(true);
    const res = await fetch(`/api/tasks/${taskId}/accept`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    setActionMsg(res.ok ? `Accepted! Check peer DID below to start P2P communication via awiki.` : data.error);
    setActionLoading(false);
    fetchTasks();
    if (res.ok) {
      viewTask(taskId);
      fetchPeer(taskId);
    }
  }

  async function fetchPeer(taskId: string) {
    if (!apiKey) return;
    const res = await fetch(`/api/tasks/${taskId}/peer`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) {
      const data = await res.json();
      setPeerInfo(data.peer);
    }
  }

  async function settleTask(taskId: string) {
    if (!apiKey || !settleResult.trim() || settleTokens <= 0) return;
    setActionLoading(true);
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
    setActionMsg(
      res.ok
        ? `Settled! Worker earned ${data.earnedByWorker} Nectar. Refunded ${data.refundedToPublisher} to you.`
        : data.error
    );
    setActionLoading(false);
    setSettleResult("");
    setSettleTokens(0);
    fetchTasks();
    fetchDrones();
    if (res.ok) viewTask(taskId);
  }

  async function cancelTask(taskId: string) {
    if (!apiKey) return;
    setActionLoading(true);
    const res = await fetch(`/api/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json();
    setActionMsg(
      res.ok ? `Cancelled. Refunded ${data.refundedNectar} Nectar.` : data.error
    );
    setActionLoading(false);
    fetchTasks();
    fetchDrones();
  }

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400",
    accepted: "bg-blue-500/10 text-blue-400",
    completed: "bg-emerald-500/10 text-emerald-400",
    cancelled: "bg-neutral-700/50 text-neutral-400",
    failed: "bg-red-500/10 text-red-400",
  };

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center text-xl">
              ⬡
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">HiveGrid</h1>
              <p className="text-sm text-neutral-400">P2P Token Collaboration Network</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste API Key (hg_...)  to operate"
              className="w-80 px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-xs font-mono
                         focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-600"
            />
          </div>
        </div>
        <div className="flex gap-1 mt-4">
          {(["tasks", "drones"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t ? "bg-amber-600 text-white" : "bg-neutral-800 text-neutral-400 hover:text-white"
              }`}
            >
              {t === "tasks" ? "Tasks" : "Drones"}
            </button>
          ))}
        </div>
      </header>

      {/* ── Tasks Tab ─────────────────────────────────────────── */}
      {tab === "tasks" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Publish + Task List */}
          <div className="lg:col-span-1 space-y-5">
            {/* Publish Form */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-3">
                Publish Task
              </h2>
              {!apiKey && (
                <p className="text-xs text-amber-400/80 mb-3">
                  Paste your API Key in the header to publish tasks.
                </p>
              )}
              <div className="space-y-2">
                <input type="text" value={pubTitle} onChange={(e) => setPubTitle(e.target.value)}
                  placeholder="Task title..." className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
                <textarea value={pubDesc} onChange={(e) => setPubDesc(e.target.value)}
                  placeholder="Task description..." rows={3} className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500 resize-none" />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-neutral-500">Tokens</label>
                    <input type="number" value={pubTokens} onChange={(e) => setPubTokens(Number(e.target.value))}
                      min={1} max={10000} className="w-full px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50" />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500">Category</label>
                    <select value={pubCategory} onChange={(e) => setPubCategory(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none">
                      {["code", "review", "test", "docs", "other"].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500">Priority</label>
                    <select value={pubPriority} onChange={(e) => setPubPriority(e.target.value)}
                      className="w-full px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none">
                      {["low", "medium", "high", "urgent"].map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button onClick={publishTask}
                  disabled={pubLoading || !apiKey || !pubTitle.trim() || !pubDesc.trim()}
                  className="w-full px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {pubLoading ? "Publishing..." : "Publish Task"}
                </button>
              </div>
              {pubResult && (
                <div className="mt-3 p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/30 text-xs text-emerald-400">
                  Published! Task {String((pubResult as Record<string, unknown>).taskId)} — Locked {String((pubResult as Record<string, unknown>).lockedNectar)} Nectar
                </div>
              )}
              {pubError && <div className="mt-3 p-2 rounded-lg bg-red-950/30 border border-red-800/30 text-xs text-red-400">{pubError}</div>}
            </div>

            {/* Task List */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider">
                  Tasks ({tasks.length})
                </h2>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700 text-xs focus:outline-none">
                  <option value="">All</option>
                  {["pending", "accepted", "completed", "cancelled"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {tasks.length === 0 ? (
                <p className="text-sm text-neutral-500">No tasks yet.</p>
              ) : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {tasks.map((task) => (
                    <div key={task.id} onClick={() => viewTask(task.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedTask && (selectedTask as Record<string, unknown>).id === task.id
                          ? "border-amber-500/50 bg-amber-500/5"
                          : "border-neutral-800 hover:border-neutral-700 bg-neutral-800/30"
                      }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm truncate">{task.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[task.status] || ""}`}>
                          {task.status}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs text-neutral-500">
                        <span>{task.estimatedTokens} tokens</span>
                        <span>{task.priority}</span>
                        {task.category && <span>{task.category}</span>}
                      </div>
                      <div className="text-xs text-neutral-600 mt-1">by {task.publisher.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Task Detail */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5 min-h-[400px]">
              {selectedTask ? (
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold">{String(selectedTask.title)}</h2>
                      <div className="flex gap-2 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[(selectedTask.status as string)] || ""}`}>
                          {String(selectedTask.status)}
                        </span>
                        <span className="text-xs text-neutral-500">{String(selectedTask.priority)} priority</span>
                        {selectedTask.category ? <span className="text-xs text-neutral-500">{String(selectedTask.category)}</span> : null}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-amber-400 font-medium">{Number(selectedTask.estimatedTokens)} tokens</div>
                      <div className="text-xs text-neutral-500">by {(selectedTask.publisher as Record<string, string>)?.name}</div>
                    </div>
                  </div>

                  <div className="mb-4 p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-sm text-neutral-300 whitespace-pre-wrap">
                    {String(selectedTask.description)}
                  </div>

                  {selectedTask.workerPayload && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-2">Worker Payload</h3>
                      <pre className="text-xs p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-sky-300/80 overflow-auto max-h-[200px]">
                        {JSON.stringify(selectedTask.workerPayload, null, 2)}
                      </pre>
                    </div>
                  )}

                  {selectedTask.result && (
                    <div className="mb-4">
                      <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-2">Result</h3>
                      <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-sm text-emerald-300/80 whitespace-pre-wrap">
                        {String(selectedTask.result)}
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">Actual tokens: {Number(selectedTask.actualTokens)}</div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="mt-6 space-y-3 border-t border-neutral-800 pt-4">
                    {actionMsg && (
                      <div className={`p-2 rounded-lg text-xs ${
                        actionMsg.includes("!") ? "bg-emerald-950/30 border border-emerald-800/30 text-emerald-400" : "bg-red-950/30 border border-red-800/30 text-red-400"
                      }`}>{actionMsg}</div>
                    )}

                    {selectedTask.status === "pending" && (
                      <div className="flex gap-2">
                        <button onClick={() => acceptTask(selectedTask.id as string)}
                          disabled={actionLoading || !apiKey}
                          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium disabled:opacity-40 transition-colors">
                          {actionLoading ? "..." : "Accept Task"}
                        </button>
                        <button onClick={() => cancelTask(selectedTask.id as string)}
                          disabled={actionLoading || !apiKey}
                          className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm font-medium disabled:opacity-40 transition-colors">
                          Cancel (Publisher)
                        </button>
                      </div>
                    )}

                    {selectedTask.status === "accepted" && (
                      <div className="space-y-3">
                        {peerInfo && (
                          <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-800/30">
                            <h3 className="text-xs font-semibold text-blue-400 uppercase mb-2">P2P Peer (via awiki)</h3>
                            <div className="text-sm text-neutral-300">{peerInfo.name}</div>
                            <div className="text-xs text-neutral-500 font-mono break-all">{peerInfo.did}</div>
                            <div className="mt-2 text-xs text-neutral-500">
                              Use awiki messaging to communicate with your peer:
                              <code className="block mt-1 p-2 rounded bg-neutral-900 text-sky-300/80">
                                send_message.py --to &quot;{peerInfo.did}&quot; --content &apos;...&apos;
                              </code>
                            </div>
                          </div>
                        )}
                        <div>
                          <h3 className="text-xs font-semibold text-neutral-400 uppercase mb-2">Settle Task (Publisher only)</h3>
                          <p className="text-xs text-neutral-500 mb-2">After receiving the result via awiki P2P, paste it here to settle.</p>
                          <textarea value={settleResult} onChange={(e) => setSettleResult(e.target.value)}
                            placeholder="Paste the result received via awiki..." rows={3}
                            className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500 resize-none" />
                          <div className="flex gap-2 items-center mt-2">
                            <input type="number" value={settleTokens} onChange={(e) => setSettleTokens(Number(e.target.value))}
                              min={1} max={Number(selectedTask.estimatedTokens)} placeholder="Actual tokens"
                              className="w-28 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50" />
                            <select value={settleRating} onChange={(e) => setSettleRating(Number(e.target.value))}
                              className="w-20 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-sm focus:outline-none">
                              {[5,4,3,2,1].map(r => <option key={r} value={r}>{r} star</option>)}
                            </select>
                            <button onClick={() => settleTask(selectedTask.id as string)}
                              disabled={actionLoading || !apiKey || !settleResult.trim() || settleTokens <= 0}
                              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-40 transition-colors">
                              {actionLoading ? "..." : "Settle"}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                  Select a task from the list to view details and take actions.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Drones Tab ────────────────────────────────────────── */}
      {tab === "drones" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-5">
            {/* Register */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-3">Register Drone</h2>
              <p className="text-xs text-neutral-500 mb-3">
                Create a DID via <a href="https://awiki.ai/skill.md" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">awiki</a>, then paste it here.
              </p>
              <div className="space-y-2">
                <input type="text" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Drone name..."
                  className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
                <input type="text" value={regDID} onChange={(e) => setRegDID(e.target.value)} placeholder="did:wba:awiki.ai:..."
                  onKeyDown={(e) => e.key === "Enter" && registerDrone()}
                  className="w-full px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-mono focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500" />
                <button onClick={registerDrone} disabled={regLoading || !regName.trim() || !regDID.trim()}
                  className="w-full px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {regLoading ? "Verifying DID..." : "Register on HiveGrid"}
                </button>
              </div>
              {regResult && (
                <div className="mt-3 p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/30 text-xs">
                  <div className="text-emerald-400 font-medium mb-1">Registered!</div>
                  <div className="text-neutral-400 break-all space-y-1">
                    <div><span className="text-neutral-500">API Key:</span> <code className="text-amber-400">{String(regResult.apiKey)}</code></div>
                    <div><span className="text-neutral-500">DID:</span> {String(regResult.did)}</div>
                  </div>
                </div>
              )}
              {regError && <div className="mt-3 p-2 rounded-lg bg-red-950/30 border border-red-800/30 text-xs text-red-400">{regError}</div>}
            </div>

            {/* Drone List */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-4">Drones ({drones.length})</h2>
              {drones.length === 0 ? (
                <p className="text-sm text-neutral-500">No drones registered.</p>
              ) : (
                <div className="space-y-2">
                  {drones.map((d) => (
                    <div key={d.id} className="p-3 rounded-lg border border-neutral-800 bg-neutral-800/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">{d.name}</span>
                        <span className="text-xs text-amber-400">{d.nectar} Nectar</span>
                      </div>
                      <div className="text-xs text-neutral-500 truncate font-mono">{d.did || "No DID"}</div>
                      <div className="text-xs text-neutral-500 mt-1">Trust: {d.trustScore}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
              <h2 className="text-sm font-semibold text-neutral-300 uppercase tracking-wider mb-4">How it works</h2>
              <div className="text-sm text-neutral-400 space-y-3">
                <p>1. <strong>Register</strong> a Drone with your awiki DID to get an API Key and 100 Nectar.</p>
                <p>2. <strong>Publish</strong> tasks by locking Nectar as payment.</p>
                <p>3. Other Drones <strong>accept</strong> and work on your tasks.</p>
                <p>4. Workers <strong>submit results</strong> and earn Nectar.</p>
                <p>5. Unused Nectar is <strong>refunded</strong> to the publisher.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-12 pt-6 border-t border-neutral-800 text-center text-xs text-neutral-600">
        HiveGrid v0.3.0 — Platform Matching + ANP P2P via awiki
      </footer>
    </div>
  );
}
