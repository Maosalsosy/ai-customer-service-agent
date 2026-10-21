"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import {
  clearAuthSession,
  getSession,
  getStoredUser,
  isAdminRole,
  isCustomerRole,
  onAuthSessionChange,
  type AuthUser,
} from "@/lib/auth";

function roleLabel(role?: string) {
  if (!role) return "";
  if (isAdminRole(role)) return "管理员";
  if (isCustomerRole(role)) return "客户";
  if (role === "agent") return "客服";
  return role;
}

const navGroups = [
  {
    label: "工作",
    items: [
      { href: "/dashboard", label: "概览" },
      { href: "/analytics", label: "服务分析" },
      { href: "/inbox", label: "客服工作台" },
      { href: "/knowledge", label: "知识库" },
      { href: "/customers", label: "客户管理" },
    ],
  },
  {
    label: "设置",
    items: [
      { href: "/settings/wecom", label: "微信客服接入", adminOnly: true },
      { href: "/settings/ai", label: "AI 模型", adminOnly: true },
      { href: "/settings/auto-tasks", label: "自动任务", adminOnly: true },
      { href: "/settings/members", label: "成员", adminOnly: true },
      { href: "/settings/audit", label: "操作记录", adminOnly: true },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [tenants, setTenants] = useState<
    { id: string; name: string; slug: string }[]
  >([]);
  const [currentTenantId, setCurrentTenantId] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [pendingKnowledge, setPendingKnowledge] = useState(0);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    queueMicrotask(() => { setNavOpen(false); setAccountOpen(false); });
  }, [pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  useEffect(() => {
    let cancelled = false;

    function refreshProfile() {
      void api
        .me("staff")
        .then((profile) => {
          if (cancelled) return;
          setUser(profile.user);
          setTenants(profile.tenants);
          setCurrentTenantId(profile.currentTenantId);
        })
        .catch(() => {
          /* AuthGate handles redirect */
        });
    }

    refreshProfile();

    const unsub = onAuthSessionChange((detail) => {
      if (detail.realm !== "staff" && detail.realm !== "all") return;
      const session = getSession("staff");
      if (!session) return;
      setUser(session.user);
      refreshProfile();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    function refreshPending() {
      void api
        .listKnowledge()
        .then((data) => {
          if (cancelled) return;
          setPendingKnowledge(
            data.items.filter((doc) => doc.status === "pending").length,
          );
        })
        .catch(() => {
          if (!cancelled) setPendingKnowledge(0);
        });
    }
    refreshPending();
    const onChanged = () => refreshPending();
    window.addEventListener("aikefu:knowledge-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("aikefu:knowledge-changed", onChanged);
    };
  }, [pathname, currentTenantId]);

  async function onSwitchTenant(tenantId: string) {
    if (!tenantId || tenantId === currentTenantId) return;
    await api.switchTenant(tenantId);
    router.replace("/dashboard");
  }

  const tenantName =
    tenants.find((item) => item.id === currentTenantId)?.name ?? "租户";
  const role = roleLabel(user?.role);
  function logout() {
    clearAuthSession("staff");
    router.replace("/login");
  }

  return (
    <div className={`flex ${pathname === "/inbox" ? "h-dvh overflow-hidden" : "min-h-full"}`}>
      {navOpen ? (
        <button
          type="button"
          aria-label="关闭导航"
          className="fixed inset-0 z-30 bg-ink/30 lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[220px] shrink-0 flex-col border-r border-line bg-paper/95 backdrop-blur-sm transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center px-6">
          <Link href="/dashboard" className="block">
            <p className="font-display text-xl font-semibold text-ink">
              AI客服
            </p>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          {navGroups.map((group) => {
            const items = group.items.filter(
              (item) =>
                !("adminOnly" in item && item.adminOnly) ||
                isAdminRole(user?.role),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.label} className={group.label === "设置" ? "border-t border-line pt-3" : ""}>
                <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-ink-soft">
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const active =
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`relative rounded-[4px] px-3 py-2.5 text-sm transition-colors ${
                          active
                            ? "bg-accent-soft font-medium text-accent-deep"
                            : "text-ink-soft hover:bg-surface hover:text-ink"
                        }`}
                      >
                        {active ? (
                          <span className="nav-active-rail absolute inset-y-2 left-0 w-[3px] bg-accent" />
                        ) : null}
                        <span className="flex items-center justify-between gap-2">
                          <span>{item.label}</span>
                          {item.href === "/knowledge" && pendingKnowledge > 0 ? (
                            <span className="min-w-[1.25rem] rounded-sm bg-warn-soft px-1.5 py-0.5 text-center text-[10px] font-medium text-warn">
                              {pendingKnowledge > 99 ? "99+" : pendingKnowledge}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className={`flex min-w-0 flex-1 flex-col ${pathname === "/inbox" ? "min-h-0" : ""}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-line bg-paper px-3 sm:gap-3 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="shrink-0 border border-line px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-surface sm:px-3 sm:text-sm lg:hidden"
              onClick={() => setNavOpen(true)}
            >
              菜单
            </button>
            <Link href="/dashboard" className="truncate text-sm font-semibold text-ink sm:text-base">
              AI 客服
            </Link>
          </div>

          <div className="hidden min-w-0 flex-1 truncate px-3 text-right text-xs text-ink-soft md:block">{tenantName}</div>
          <div ref={accountRef} className="relative">
            <button
              type="button"
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              onClick={() => setAccountOpen((open) => !open)}
              className="flex max-w-[16rem] items-center gap-2 border border-transparent px-1.5 py-1 hover:border-line hover:bg-surface"
            >
              <span className="min-w-0 text-left">
                <span className="block truncate text-xs font-medium leading-5 text-ink">
                  {user?.displayName ?? "未登录"}{role ? ` · ${role}` : ""}
                </span>
              </span>
            </button>
            {accountOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+6px)] z-30 w-56 border border-line bg-paper shadow-[var(--shadow)]"
              >
                <div className="border-b border-line px-3 py-3">
                  <p className="truncate text-sm font-medium text-ink">
                    {user?.displayName ?? "未登录"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {tenantName}
                    {role ? ` · ${role}` : ""}
                  </p>
                </div>
                {tenants.length > 1 ? (
                  <div className="border-b border-line px-3 py-3">
                    <label className="block text-[11px] text-ink-soft">
                      切换租户
                      <select
                        value={currentTenantId}
                        onChange={(event) =>
                          void onSwitchTenant(event.target.value)
                        }
                        className="mt-1 w-full border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none"
                      >
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={logout}
                  className="block w-full px-3 py-2.5 text-left text-sm text-ink hover:bg-surface"
                >
                  退出登录
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className={`min-w-0 flex-1 animate-fade ${pathname === "/inbox" ? "flex min-h-0 flex-col overflow-hidden" : ""}`}>
          <div className={`mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-6 sm:py-6 lg:px-7 ${pathname === "/inbox" ? "flex min-h-0 flex-1 flex-col p-0 sm:p-0 lg:p-0" : ""}`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
