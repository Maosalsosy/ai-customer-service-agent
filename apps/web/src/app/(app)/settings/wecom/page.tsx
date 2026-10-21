"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getStoredUser, isAdminRole } from "@/lib/auth";
import {
  api,
  getApiBase,
  type ApiWecomConnection,
  type ApiWechatKfAccount,
} from "@/lib/api";
import { Button, EmptyState, Field, PageHeader, Panel, TextInput } from "@/components/ui";

function callbackUrl(connectionId: string) {
  const callbackBase = (process.env.NEXT_PUBLIC_WECOM_CALLBACK_BASE ?? "").trim().replace(/\/+$/, "") || getApiBase();
  return `${callbackBase}/api/v1/wecom/callback/${encodeURIComponent(connectionId)}`;
}

function channelLabel(connection: ApiWecomConnection) {
  if (connection.channelType === "wechat_kf") return "微信客服";
  if (connection.channelType === "wecom_mock") return "演示连接";
  return "旧员工私聊连接";
}

function statusLabel(connection: ApiWecomConnection) {
  if (connection.channelType === "wecom") return "已停用";
  if (connection.status === "connected") return "回调已验证";
  if (connection.status === "disabled") return "已停用";
  if (connection.status === "error") return "连接异常";
  if (connection.status === "pending_auth") return "待回调验证";
  return "待配置";
}

export default function WecomSettingsPage() {
  const [connections, setConnections] = useState<ApiWecomConnection[]>([]);
  const [accounts, setAccounts] = useState<ApiWechatKfAccount[]>([]);
  const [admin] = useState(() => isAdminRole(getStoredUser()?.role));
  const [loading, setLoading] = useState(true);
  const [listingAccounts, setListingAccounts] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [corpId, setCorpId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [callbackToken, setCallbackToken] = useState("");
  const [encodingAesKey, setEncodingAesKey] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [connectionResult] = await Promise.allSettled([api.listWecom()]);
    if (connectionResult.status === "fulfilled") {
      setConnections(connectionResult.value.items);
      setError(null);
    } else {
      setError(connectionResult.reason instanceof Error ? connectionResult.reason.message : "无法加载连接");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (admin) queueMicrotask(() => void load());
  }, [admin, load]);

  async function loadAccounts() {
    if (!corpId.trim() || !appSecret.trim()) {
      setError("请先填写企业 ID 和微信客服应用 Secret");
      return;
    }
    setListingAccounts(true);
    setError(null);
    setAccounts([]);
    setSelectedAccountId("");
    try {
      const result = await api.listWechatKfAccounts(corpId.trim(), appSecret.trim());
      setAccounts(result);
      if (result[0]) setSelectedAccountId(result[0].open_kfid);
      if (result.length === 0) setNotice("凭证有效，但当前企业没有可用的微信客服账号");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取微信客服账号失败");
    } finally {
      setListingAccounts(false);
    }
  }

  async function createConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccountId) {
      setError("请先读取并选择一个微信客服账号");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const account = accounts.find((item) => item.open_kfid === selectedAccountId);
      const connection = await api.createWechatKf({
        displayName: account?.name,
        corpId: corpId.trim(),
        appSecret: appSecret.trim(),
        callbackToken: callbackToken.trim(),
        encodingAesKey: encodingAesKey.trim(),
        externalAccountId: selectedAccountId,
      });
      setNotice(`「${connection.displayName}」配置已保存。请在企业微信后台完成回调验证。`);
      setCorpId("");
      setAppSecret("");
      setCallbackToken("");
      setEncodingAesKey("");
      setAccounts([]);
      setSelectedAccountId("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建微信客服连接失败");
    } finally {
      setCreating(false);
    }
  }

  async function disable(connection: ApiWecomConnection) {
    setBusyId(connection.id);
    try {
      await api.disableWecom(connection.id);
      setNotice(`「${connection.displayName}」已停用，历史会话保留。`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "停用连接失败");
    } finally {
      setBusyId(null);
    }
  }

  async function copyCallbackUrl(connectionId: string) {
    try {
      await navigator.clipboard.writeText(callbackUrl(connectionId));
      setNotice("回调 URL 已复制");
    } catch {
      setError("浏览器未授权剪贴板，请手动复制回调 URL");
    }
  }

  if (!admin) {
    return (
      <div className="animate-rise space-y-4">
        <PageHeader title="微信客服接入" description="仅管理员可管理企业微信授权。" />
        <Panel className="p-8"><EmptyState title="无权查看" description="请联系工作区管理员。" /></Panel>
      </div>
    );
  }

  const callbackBase = (process.env.NEXT_PUBLIC_WECOM_CALLBACK_BASE ?? "").trim() || getApiBase();
  const publicCallbackApi = !callbackBase.includes("localhost") && !callbackBase.includes("127.0.0.1");

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="微信客服接入"
        description="将微信客服账号接入客服工作台；客户会话与回复均以所选微信客服账号为边界。"
      />

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      <Panel className="overflow-hidden">
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">添加客服账号</h2>
          <p className="mt-1 text-xs leading-5 text-ink-soft">使用企业微信后台已授权「微信客服-可调用接口的应用」的自建应用凭证。</p>
        </header>
        <form className="space-y-5 p-5" onSubmit={createConnection}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="企业 ID（CorpID）">
              <TextInput autoComplete="off" value={corpId} onChange={(event) => setCorpId(event.target.value)} placeholder="ww..." required />
            </Field>
            <Field label="微信客服应用 Secret">
              <TextInput type="password" autoComplete="new-password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder="应用凭证 Secret" required />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" disabled={listingAccounts} onClick={() => void loadAccounts()}>
              {listingAccounts ? "正在验证凭证…" : "验证并读取客服账号"}
            </Button>
            {accounts.length ? <span className="text-xs text-ink-soft">找到 {accounts.length} 个账号</span> : null}
          </div>

          {accounts.length ? (
            <div>
              <Field label="微信客服账号">
                <select
                  value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                  className="min-h-9 w-full rounded-[4px] border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                >
                  {accounts.map((account) => <option key={account.open_kfid} value={account.open_kfid}>{account.name} · {account.open_kfid}</option>)}
                </select>
              </Field>
            </div>
          ) : null}

          <div className="border-t border-line pt-5">
            <h3 className="text-sm font-medium text-ink">消息回调</h3>
            <p className="mt-1 text-xs leading-5 text-ink-soft">在企业微信「微信客服-开发配置」中填写相同 Token 与 EncodingAESKey，并订阅客服消息事件。</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="回调 Token">
                <TextInput autoComplete="off" value={callbackToken} onChange={(event) => setCallbackToken(event.target.value)} placeholder="与企业微信后台回调配置一致" required />
              </Field>
              <Field label="EncodingAESKey">
                <TextInput autoComplete="off" value={encodingAesKey} onChange={(event) => setEncodingAesKey(event.target.value)} placeholder="企业微信后台生成的 43 位密钥" maxLength={43} required />
              </Field>
            </div>
          </div>

          {accounts.length ? (
            <div className="flex justify-end border-t border-line pt-4">
              <Button type="submit" disabled={creating || !selectedAccountId}>
                {creating ? "正在创建…" : "接入微信客服账号"}
              </Button>
            </div>
          ) : null}
        </form>
      </Panel>

      {!publicCallbackApi ? (
        <div className="border border-warn/25 bg-warn-soft px-4 py-3 text-xs leading-5 text-warn">
          当前 API 地址是本机地址。真实回调要求企业微信服务器可访问，请部署后将 `NEXT_PUBLIC_API_BASE_URL` 配置为公网 HTTPS API 地址，再复制连接详情中的回调 URL。
        </div>
      ) : null}

      <Panel className="overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">接入连接</h2>
            <p className="mt-1 text-xs text-ink-soft">所有客服账号统一检索当前工作区的项目知识库。同一 CorpID 下共用回调入口，服务端按 OpenKfId 分发消息；回调验证或收到有效事件不代表真实回复投递已验收。</p>
          </div>
          <span className="text-xs text-ink-soft">{connections.length} 条</span>
        </header>
        {loading ? (
          <EmptyState title="正在加载" description="正在读取已配置的连接。" />
        ) : connections.length === 0 ? (
          <EmptyState title="尚未接入账号" description="验证企业凭证后，选择要接入的微信客服账号。" />
        ) : (
          <ul className="divide-y divide-line">
            {connections.map((connection) => {
              const active = connection.channelType === "wechat_kf" && connection.status === "connected";
              const sameCorpConnection = (item: ApiWecomConnection) =>
                item.channelType === "wechat_kf" && item.corpId === connection.corpId;
              const callbackConnectionId = connections.find(sameCorpConnection)?.id ?? connection.id;
              return (
                <li key={connection.id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">{connection.displayName}</p>
                        <span className={`border px-2 py-0.5 text-xs ${active ? "border-ok/20 bg-ok-soft text-ok" : "border-line bg-surface text-ink-soft"}`}>
                          {statusLabel(connection)}
                        </span>
                        <span className="border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft">{channelLabel(connection)}</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-ink-soft">
                        {connection.channelType === "wechat_kf"
                          ? `客服账号 ID：${connection.externalAccountId ?? "未记录"} · 企业 ID：${connection.corpId ?? "未记录"}`
                          : connection.channelType === "wecom_mock"
                            ? "仅用于本地流程演示，不会连接或发送到真实微信客服账号。"
                            : "历史员工私聊连接已隔离，不能用于微信客服收发。"}
                      </p>
                    </div>
                    {connection.channelType !== "wecom" && connection.status !== "disabled" ? (
                      <Button type="button" variant="secondary" disabled={busyId === connection.id} onClick={() => void disable(connection)}>
                        {busyId === connection.id ? "停用中…" : "停用"}
                      </Button>
                    ) : null}
                  </div>
                  {connection.channelType === "wechat_kf" ? (
                    <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink">共享回调入口 URL</p>
                        <code className="mt-1 block break-all text-xs text-ink-soft">{callbackUrl(callbackConnectionId)}</code>
                      </div>
                      <Button type="button" variant="secondary" className="shrink-0" onClick={() => void copyCallbackUrl(callbackConnectionId)}>复制 URL</Button>
                    </div>
                  ) : null}
                  {connection.errorMessage ? <p className="text-xs text-danger">{connection.errorMessage}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <a className="border border-line bg-paper px-4 py-3 text-sm text-accent underline underline-offset-2" href="https://developer.work.weixin.qq.com/document/path/94661" target="_blank" rel="noreferrer">微信客服账号列表接口</a>
        <a className="border border-line bg-paper px-4 py-3 text-sm text-accent underline underline-offset-2" href="https://developer.work.weixin.qq.com/document/path/94670" target="_blank" rel="noreferrer">接收消息与同步消息接口</a>
        <a className="border border-line bg-paper px-4 py-3 text-sm text-accent underline underline-offset-2" href="https://developer.work.weixin.qq.com/document/path/94677" target="_blank" rel="noreferrer">发送微信客服消息接口</a>
      </div>

      <p className="px-1 text-xs leading-5 text-ink-soft">微信客服 API 的客户会话仅在客户最近发言后的 48 小时内允许回复，每轮最多 5 条；非文本消息在工作台展示为提示，不触发 AI 自动回复。</p>

      {notice ? (
        <div role="status" className="fixed bottom-6 right-6 z-[70] max-w-sm border border-line bg-ink px-4 py-2.5 text-sm text-paper animate-rise">{notice}</div>
      ) : null}
    </div>
  );
}
