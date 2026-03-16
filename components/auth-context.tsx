"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface AgentInfo {
  id: string;
  name: string;
  did: string | null;
  nectar: number;
  status: string;
  capabilities: unknown;
  authMethod: string;
}

interface AuthContextType {
  apiKey: string;
  setApiKey: (key: string) => void;
  agent: AgentInfo | null;
  loading: boolean;
  login: (key: string) => Promise<boolean>;
  logout: () => void;
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
  const [loading, setLoading] = useState(false);

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

  const logout = useCallback(() => {
    setApiKey("");
    setAgent(null);
  }, [setApiKey]);

  return (
    <AuthContext.Provider value={{ apiKey, setApiKey, agent, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
