"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  getAccessToken,
  getStoredUser,
  isAdminRole,
  setAuthSession,
} from "@/lib/auth";

/** 设置类页面：仅管理员可进入，客服会被送回概览。 */
export function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = getStoredUser("staff");
    if (!isAdminRole(cached?.role)) {
      router.replace("/dashboard");
      return;
    }

    const token = getAccessToken("staff");
    if (!token) {
      router.replace("/login");
      return;
    }

    void api
      .me("staff")
      .then((profile) => {
        if (cancelled) return;
        setAuthSession(token, profile.user);
        if (!isAdminRole(profile.user.role)) {
          router.replace("/dashboard");
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) router.replace("/dashboard");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink-soft">
        正在确认管理员权限…
      </div>
    );
  }

  return <>{children}</>;
}
