"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-context";

const PUBLIC_PATHS = ["/login"];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { agent, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  useEffect(() => {
    if (!loading && !agent && !isPublic) {
      router.replace(`/login?from=${encodeURIComponent(pathname)}`);
    }
  }, [loading, agent, isPublic, router, pathname]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-neutral-500 text-sm">验证身份中...</div>
      </div>
    );
  }

  if (!agent && !isPublic) {
    return null;
  }

  return <>{children}</>;
}
