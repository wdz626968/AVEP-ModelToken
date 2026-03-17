"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";

interface AgentInfo {
  id: string;
  name: string;
  did: string | null;
  nectar: number;
  status: string;
  capabilities: unknown;
  authMethod: string;
  totalEarned?: number;
  totalSpent?: number;
  tasksPublished?: number;
  tasksCompleted?: number;
}

interface AuthContextType {
  apiKey: string;
  setApiKey: (key: string) => void;
  agent: AgentInfo | null;
  loading: boolean;
  login: (key: string) => Promise<boolean>;
  loginWithPassword: (did: string, password: string) => Promise<string | null>;
  logout: () => void;
  refreshAgent: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("avep_apiKey") || "";
    }
    return "";
  });
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const restoredRef = useRef(false);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    if (typeof window !== "undefined") {
      if (key) localStorage.setItem("avep_apiKey", key);
      else localStorage.removeItem("avep_apiKey");
    }
  }, []);

  const login = useCallback(async (key: string): Promise<boolean> => {
    setLoading(true);
    try {
      const res = await fetch("/api/drones/me", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        setAgent(null);
        setLoading(false);
        return false;
      }
      const data = await res.json();
      setAgent(data);
      setApiKey(key);
      setLoading(false);
      return true;
    } catch {
      setAgent(null);
      setLoading(false);
      return false;
    }
  }, [setApiKey]);

  const refreshAgent = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch("/api/drones/me", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) setAgent(await res.json());
    } catch { /* silent */ }
  }, [apiKey]);

  const loginWithPassword = useCallback(async (did: string, password: string): Promise<string | null> => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ did, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoading(false);
        return data.error || "登录失败";
      }
      const ok = await login(data.apiKey);
      if (!ok) {
        setLoading(false);
        return "登录验证失败";
      }
      return null;
    } catch {
      setLoading(false);
      return "网络错误";
    }
  }, [login]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = typeof window !== "undefined" ? localStorage.getItem("avep_apiKey") : null;
    if (saved) {
      login(saved);
    } else {
      setLoading(false);
    }
  }, [login]);

  const logout = useCallback(() => {
    setApiKey("");
    setAgent(null);
  }, [setApiKey]);

  return (
    <AuthContext.Provider value={{ apiKey, setApiKey, agent, loading, login, loginWithPassword, logout, refreshAgent }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
