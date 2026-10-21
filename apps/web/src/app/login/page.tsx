"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import {
  getSession,
  homePathForRole,
  isCustomerRole,
  onAuthSessionChange,
  setAuthSession,
  type AuthUser,
} from "@/lib/auth";
import { Button, Field, TextInput } from "@/components/ui";

function readDualSessions() {
  return {
    staff: getSession("staff")?.user ?? null,
    customer: getSession("customer")?.user ?? null,
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffUser, setStaffUser] = useState<AuthUser | null>(null);
  const [customerUser, setCustomerUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const sync = () => {
      const dual = readDualSessions();
      setStaffUser(dual.staff);
      setCustomerUser(dual.customer);
    };
    sync();
    return onAuthSessionChange(() => sync());
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await api.login(email.trim(), password, {
        persist: false,
      });
      // 仅影响本标签；其他标签的管理员/客服/客户会话互不影响
      const existingStaff = getSession("staff");
      if (
        !isCustomerRole(session.user.role) &&
        existingStaff &&
        existingStaff.user.id !== session.user.id
      ) {
        const ok = window.confirm(
          `本页工作台已登录「${existingStaff.user.displayName}」。\n` +
            `继续将在本标签替换为「${session.user.displayName}」（其他标签不受影响）。\n\n是否继续？`,
        );
        if (!ok) {
          setLoading(false);
          return;
        }
      }
      setAuthSession(session.accessToken, session.user);
      const dual = readDualSessions();
      setStaffUser(dual.staff);
      setCustomerUser(dual.customer);
      router.replace(homePathForRole(session.user.role));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "登录失败",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-mist">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between border-b border-line px-5 sm:px-8">
        <Link href="/login" className="flex items-center gap-3" aria-label="AI客服登录页">
          <span className="flex size-9 items-center justify-center bg-accent text-sm font-semibold text-white">AI</span>
          <span>
            <span className="block text-sm font-semibold text-ink">AI客服</span>
            <span className="block text-[11px] text-ink-soft">微信客服 AI 助手</span>
          </span>
        </Link>
        <span className="text-xs text-ink-soft">安全登录</span>
      </header>

      <main className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-20">
        <section className="order-2 pb-4 lg:order-1 lg:pb-0">
          <p className="text-xs font-medium text-accent">AI KEFU · SERVICE CONSOLE</p>
          <h1 className="mt-4 max-w-lg text-3xl font-semibold leading-tight text-ink sm:text-4xl">
            让每一次客户咨询，<br className="hidden sm:block" />都有清晰的处理路径
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-ink-soft">
            登录后进入对应工作空间。演示环境账号请查看项目 README。
          </p>
          <ol className="mt-8 grid max-w-lg grid-cols-3 border-y border-line py-4">
            {[
              ["01", "接收咨询"],
              ["02", "知识辅助"],
              ["03", "人工跟进"],
            ].map(([number, label]) => (
              <li key={number} className="flex items-center gap-2 pr-2 text-xs text-ink-soft">
                <span className="font-mono text-accent">{number}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="order-1 border border-line bg-paper p-6 shadow-[var(--shadow)] sm:p-8 lg:order-2">
          <div>
            <p className="text-xs font-medium text-accent">欢迎回来</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">登录账号</h2>
            <p className="mt-2 text-sm text-ink-soft">使用你的工作邮箱和密码继续。</p>
          </div>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <Field label="邮箱">
              <TextInput
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="密码">
              <TextInput
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "登录中…" : "登录"}
            </Button>
          </form>

          {staffUser || customerUser ? (
            <div className="mt-5 space-y-2 border-t border-line pt-4 text-xs">
              {staffUser ? (
                <Link href="/dashboard" className="block text-accent hover:text-accent-deep">
                  已登录客服：{staffUser.displayName} · 进入工作台 →
                </Link>
              ) : null}
              {customerUser ? (
                <Link href="/customer" className="block text-accent hover:text-accent-deep">
                  已登录客户：{customerUser.displayName} · 进入客户门户 →
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
