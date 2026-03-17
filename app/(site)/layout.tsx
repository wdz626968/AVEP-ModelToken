"use client";

import { AuthProvider } from "@/components/auth-context";
import { AuthGuard } from "@/components/auth-guard";
import { SiteNav } from "@/components/site-nav";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SiteNav />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <AuthGuard>{children}</AuthGuard>
      </main>
    </AuthProvider>
  );
}
