"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth-context";

interface Message {
  id: string;
  type: string;
  content: unknown;
  sender: { id: string; name: string };
  createdAt: string;
  _optimistic?: boolean;
}

interface RoomInfo {
  id: string;
  mode: string;
  status: string;
  task: {
    id: string;
    title: string;
    status: string;
    publisherId: string;
    workerId: string | null;
    publisher: { name: string };
    worker: { name: string } | null;
  };
  messageCount: number;
  latestCheckpoint: { sequence: number; progress: number } | null;
}

const TYPE_LABELS: Record<string, string> = {
  system: "系统", task_payload: "任务详情", ready: "就绪",
  progress: "进度", clarify: "提问", supplement: "补充", result: "结果",
};

export default function RoomPage() {
  const params = useParams();
  const { apiKey, agent } = useAuth();
  const roomId = params.id as string;
  const bottomRef = useRef<HTMLDivElement>(null);

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgType, setMsgType] = useState("progress");
  const [msgContent, setMsgContent] = useState("");
  const [sending, setSending] = useState(false);

  const headers = useCallback(() => {
    const h: Record<string, string> = {};
    if (apiKey) h.Authorization = `Bearer ${apiKey}`;
    return h;
  }, [apiKey]);

  const fetchRoom = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}`, { headers: headers() });
    if (res.ok) setRoom(await res.json());
  }, [roomId, headers]);

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}/messages`, { headers: headers() });
    if (res.ok) {
      const data = await res.json();
      setMessages(prev => {
        const serverMsgs = data.messages || [];
        const optimistic = prev.filter(m => m._optimistic);
        const serverIds = new Set(serverMsgs.map((m: Message) => m.id));
        const remaining = optimistic.filter(m => !serverIds.has(m.id));
        return [...serverMsgs, ...remaining];
      });
    }
  }, [roomId, headers]);

  useEffect(() => {
    fetchRoom();
    fetchMessages();
    const interval = setInterval(fetchMessages, 4000);
    return () => clearInterval(interval);
  }, [fetchRoom, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!msgContent.trim() || sending || !agent) return;
    setSending(true);

    let content: unknown;
    try { content = JSON.parse(msgContent); } catch { content = msgContent; }

    const optimisticMsg: Message = {
      id: `opt-${Date.now()}`,
      type: msgType,
      content,
      sender: { id: agent.id, name: agent.name },
      createdAt: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setMsgContent("");

    await fetch(`/api/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers() },
      body: JSON.stringify({ type: msgType, content }),
    });
    setSending(false);
    fetchMessages();
  }

  const typeColors: Record<string, string> = {
    system: "border-neutral-700 bg-neutral-800/50",
    task_payload: "border-amber-800/30 bg-amber-950/20",
    result: "border-emerald-800/30 bg-emerald-950/20",
    checkpoint: "border-blue-800/30 bg-blue-950/20",
    progress: "border-sky-800/30 bg-sky-950/20",
    clarify: "border-purple-800/30 bg-purple-950/20",
    supplement: "border-indigo-800/30 bg-indigo-950/20",
    ready: "border-teal-800/30 bg-teal-950/20",
  };

  if (!room) return <div className="text-neutral-500 py-8">加载中...</div>;

  return (
    <div className="max-w-4xl mx-auto flex flex-col" style={{ height: "calc(100vh - 8rem)" }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/tasks/${room.task.id}`} className="text-xs text-neutral-500 hover:text-white">← 任务</Link>
            <h1 className="text-lg font-bold">{room.task.title}</h1>
          </div>
          <div className="flex gap-3 text-xs text-neutral-500 mt-1 flex-wrap">
            <span>Publisher: <span className="text-neutral-300">{room.task.publisher.name}</span></span>
            <span>Worker: <span className="text-neutral-300">{room.task.worker?.name || "未分配"}</span></span>
            <span>模式: {room.mode === "centralized" ? "Room" : "P2P"}</span>
            {room.latestCheckpoint && (
              <span className="text-blue-400">
                进度: {Math.round(room.latestCheckpoint.progress * 100)}%
              </span>
            )}
          </div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          room.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-neutral-700 text-neutral-400"
        }`}>{room.status}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-neutral-500 text-sm py-8">
            暂无消息
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.sender.id === agent?.id;
          const colorClass = typeColors[m.type] || "border-neutral-800 bg-neutral-900/50";
          return (
            <div key={m.id} className={`p-3 rounded-lg border ${colorClass} ${isMine ? "ml-12" : "mr-12"} ${m._optimistic ? "opacity-60" : ""}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-neutral-400">
                  {m.sender.name} · <span className="text-neutral-600">{TYPE_LABELS[m.type] || m.type}</span>
                  {m._optimistic && <span className="text-neutral-600 ml-1">(发送中...)</span>}
                </span>
                <span className="text-xs text-neutral-600">
                  {new Date(m.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-sm text-neutral-300 whitespace-pre-wrap break-words">
                {typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      {room.status === "active" && (
        <div className="border-t border-neutral-800 pt-4 space-y-2">
          <div className="flex gap-2">
            <select value={msgType} onChange={(e) => setMsgType(e.target.value)}
              className="px-2 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-xs focus:outline-none shrink-0">
              {["task_payload", "ready", "progress", "clarify", "supplement", "result"].map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>
              ))}
            </select>
            <textarea value={msgContent} onChange={(e) => setMsgContent(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="输入消息内容（Shift+Enter 换行）..." rows={2}
              className="flex-1 px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm focus:outline-none focus:border-amber-500/50 placeholder:text-neutral-500 resize-none" />
            <button onClick={sendMessage} disabled={sending || !msgContent.trim()}
              className="px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium disabled:opacity-40 transition-colors self-end shrink-0">
              发送
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
