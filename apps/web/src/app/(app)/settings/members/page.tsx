"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button, EmptyState, Field, Modal, PageHeader, Panel, TextInput } from "@/components/ui";

type Member = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
};

export default function MembersPage() {
  const [items, setItems] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "agent" | "customer">("agent");
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const visibleItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return items.filter((member) => {
      const matchesSearch = !term || `${member.displayName} ${member.email}`.toLocaleLowerCase().includes(term);
      const matchesRole = roleFilter === "all" || memberRoleValue(member.role) === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [items, search, roleFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listMembers();
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function invite() {
    setSaving(true);
    setError(null);
    try {
      await api.inviteMember({
        email: email.trim(),
        displayName: displayName.trim() || undefined,
        role,
        password,
      });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("agent");
      setInviteOpen(false);
      setToast("已邀请成员");
      window.setTimeout(() => setToast(null), 2000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "邀请失败");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(
    userId: string,
    next: "admin" | "agent" | "customer",
  ) {
    setError(null);
    try {
      await api.updateMemberRole(userId, next);
      setToast("角色已更新");
      window.setTimeout(() => setToast(null), 2000);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失败");
    }
  }

  function memberRoleValue(raw: string): "admin" | "agent" | "customer" {
    const lower = raw.trim().toLowerCase();
    if (lower === "admin" || lower === "owner") return "admin";
    if (lower === "customer" || lower === "user") return "customer";
    return "agent";
  }

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="成员管理"
        description="管理当前工作区的成员、角色和访问权限。"
        action={
          <Button type="button" onClick={() => setInviteOpen(true)}>
            邀请成员
          </Button>
        }
      />

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Panel className="overflow-hidden">
          <header className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-medium text-ink">成员</h2>
              <p className="mt-0.5 text-xs text-ink-soft">
                共 {items.length} 人 · 管理员 {items.filter((item) => memberRoleValue(item.role) === "admin").length} 人 · 客服 {items.filter((item) => memberRoleValue(item.role) === "agent").length} 人
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_9rem]">
              <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名或邮箱" aria-label="搜索成员" />
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="按角色筛选" className="min-h-9 border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-accent">
                <option value="all">全部角色</option>
                <option value="admin">管理员</option>
                <option value="agent">客服</option>
                <option value="customer">客户</option>
              </select>
            </div>
          </header>
          {!loading && items.length > 0 ? <div className="hidden grid-cols-[minmax(0,1fr)_10rem] gap-4 bg-surface px-4 py-2 text-[11px] font-medium text-ink-soft sm:grid"><span>成员</span><span>角色</span></div> : null}
          {loading ? (
            <EmptyState title="加载中" description="正在拉取成员列表…" />
          ) : items.length === 0 ? (
            <EmptyState title="暂无成员" description="点右上角邀请同事加入当前工作区。" />
          ) : visibleItems.length === 0 ? (
            <EmptyState title="没有匹配的成员" description="调整姓名、邮箱或角色筛选条件。" />
          ) : (
            <ul className="divide-y divide-line">
              {visibleItems.map((member) => (
                <li
                  key={member.userId}
                  className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center bg-accent-soft text-xs font-semibold text-accent-deep">{(member.displayName || member.email || "?").trim().slice(0, 1).toLocaleUpperCase()}</span>
                    <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {member.displayName}
                    </p>
                    <p className="truncate text-xs text-ink-soft">{member.email} · {member.status === "active" ? "正常" : member.status}</p>
                    </div>
                  </div>
                  <select
                    value={memberRoleValue(member.role)}
                    onChange={(e) =>
                      void changeRole(
                        member.userId,
                        e.target.value as "admin" | "agent" | "customer",
                      )
                    }
                    aria-label={`${member.displayName}的角色`}
                    className="min-h-9 w-full border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-accent sm:w-40"
                  >
                    <option value="agent">客服</option>
                    <option value="admin">管理员</option>
                    <option value="customer">客户</option>
                  </select>
                </li>
              ))}
            </ul>
          )}
      </Panel>

      <Modal
        open={inviteOpen}
        title="邀请成员"
        description="邀请只加入当前工作区。"
        onClose={() => setInviteOpen(false)}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setInviteOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={saving} onClick={() => void invite()}>
              {saving ? "提交中…" : "邀请"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="邮箱">
            <TextInput
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </Field>
          <Field label="显示名">
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="可选"
            />
          </Field>
          <Field label="初始密码">
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
            />
          </Field>
          <Field label="角色">
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "admin" | "agent" | "customer")
              }
              className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
            >
              <option value="agent">客服</option>
              <option value="admin">管理员</option>
              <option value="customer">客户（演示门户）</option>
            </select>
          </Field>
        </div>
      </Modal>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-[70] border border-line bg-ink px-4 py-2.5 text-sm text-paper animate-rise">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
