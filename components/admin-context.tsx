"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";

interface AdminContextType {
  token: string;
  authed: boolean;
  loading: boolean;
  adminFetch: (url: string, init?: RequestInit) => Promise<Response>;
  logout: () => void;
}

const AdminContext = createContext<AdminContextType | null>(null);

const STORAGE_KEY = "avep_admin_token";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function AdminProvider({ children, onNeedAuth }: {
  children: ReactNode;
  onNeedAuth: (ctx: { login: (pw: string) => Promise<string | null>; setup: (pw: string) => Promise<string | null>; configured: boolean | null; dbError: string | null }) => ReactNode;
}) {
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      setToken(saved);
      setAuthed(true);
    }
    fetch("/api/admin/auth")
      .then(async (r) => {
        const data = await safeJson(r);
        if (data.error) setDbError(String(data.error));
        setConfigured(data.configured === true);
      })
      .catch(() => {
        setConfigured(false);
        setDbError("无法连接服务器");
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (password: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", password }),
      });
      const data = await safeJson(res);
      if (res.ok && data.token) {
        setToken(String(data.token));
        setAuthed(true);
        sessionStorage.setItem(STORAGE_KEY, String(data.token));
        return null;
      }
      return String(data.error || "登录失败");
    } catch {
      return "网络错误，请重试";
    }
  }, []);

  const setup = useCallback(async (password: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup", password }),
      });
      const data = await safeJson(res);
      if (res.ok && data.token) {
        setToken(String(data.token));
        setAuthed(true);
        setConfigured(true);
        sessionStorage.setItem(STORAGE_KEY, String(data.token));
        return null;
      }
      return String(data.error || "设置失败");
    } catch {
      return "网络错误，请重试";
    }
  }, []);

  const logout = useCallback(() => {
    setToken("");
    setAuthed(false);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const adminFetch = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (token) headers.set("x-admin-token", token);
    return fetch(url, { ...init, headers });
  }, [token]);

  if (loading) return null;

  if (!authed) {
    return <>{onNeedAuth({ login, setup, configured, dbError })}</>;
  }

  return (
    <AdminContext.Provider value={{ token, authed, loading, adminFetch, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
