"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  clearAuthSession,
  getAccessToken,
  getSession,
  homePathForRole,
  isCustomerRole,
  onAuthSessionChange,
  setAuthSession,
  setAuthSessionIfEmpty,
} from "@/lib/auth";

/** 坐席/管理端入口：只认 staff 槽；客户角色会被送到客户演示页。 */
export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function applyStaffProfile(
      token: string,
      user: Parameters<typeof setAuthSession>[1],
    ) {
      if (isCustomerRole(user.role)) {
        setAuthSessionIfEmpty(token, user);
        clearAuthSession("staff");
        router.replace(
          getSession("customer") ? homePathForRole(user.role) : "/login",
        );
        return false;
      }
      setAuthSession(token, user);
      userIdRef.current = user.id;
      return true;
    }

    function bootstrap() {
      const token = getAccessToken("staff");
      if (!token) {
        router.replace("/login");
        return;
      }
      void api
        .me("staff")
        .then((profile) => {
          if (cancelled) return;
          if (!applyStaffProfile(token, profile.user)) return;
          setReady(true);
        })
        .catch(() => {
          if (cancelled) return;
          if (getAccessToken("staff") !== token) return;
          clearAuthSession("staff");
          router.replace("/login");
        });
    }

    bootstrap();

    const unsub = onAuthSessionChange((detail) => {
      if (detail.realm !== "staff" && detail.realm !== "all") return;
      const next = getSession("staff");
      if (!next) {
        setReady(false);
        router.replace("/login");
        return;
      }
      // 本标签内切换了坐席账号：重载以刷新角色相关 UI
      if (userIdRef.current && next.user.id !== userIdRef.current) {
        window.location.reload();
        return;
      }
      userIdRef.current = next.user.id;
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-soft">
        正在验证登录状态…
      </div>
    );
  }

  return <>{children}</>;
}

/** 客户演示入口：只认 customer 槽；非客户角色回到工作台。 */
export function CustomerAuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function bootstrap() {
      const token = getAccessToken("customer");
      if (!token) {
        router.replace("/login");
        return;
      }
      void api
        .me("customer")
        .then((profile) => {
          if (cancelled) return;
          if (!isCustomerRole(profile.user.role)) {
            setAuthSessionIfEmpty(token, profile.user);
            clearAuthSession("customer");
            router.replace(
              getSession("staff")
                ? homePathForRole(profile.user.role)
                : "/login",
            );
            return;
          }
          setAuthSession(token, profile.user);
          userIdRef.current = profile.user.id;
          setReady(true);
        })
        .catch(() => {
          if (cancelled) return;
          if (getAccessToken("customer") !== token) return;
          clearAuthSession("customer");
          router.replace("/login");
        });
    }

    bootstrap();

    const unsub = onAuthSessionChange((detail) => {
      if (detail.realm !== "customer" && detail.realm !== "all") return;
      const next = getSession("customer");
      if (!next) {
        setReady(false);
        router.replace("/login");
        return;
      }
      if (userIdRef.current && next.user.id !== userIdRef.current) {
        window.location.reload();
        return;
      }
      userIdRef.current = next.user.id;
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-soft">
        正在验证登录状态…
      </div>
    );
  }

  return <>{children}</>;
}
