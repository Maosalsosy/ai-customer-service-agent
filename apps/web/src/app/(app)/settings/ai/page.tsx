"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  api,
  type AiProfile,
  type AiProviderPreset,
  type AiEvaluationReport,
  type AiReplyStyle,
  type AiSettingsPayload,
} from "@/lib/api";
import { getStoredUser, isAdminRole as hasAdminRole } from "@/lib/auth";
import {
  Button,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Panel,
  TextInput,
} from "@/components/ui";

function isAllowedBase(raw: string) {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase();
    const privateHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^10\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "接口地址需使用 HTTP 或 HTTPS";
    }
    if (url.protocol === "http:" && !privateHost) {
      return "公网接口地址需使用 HTTPS";
    }
    return null;
  } catch {
    return "接口地址无效";
  }
}

function isAdminRole(role?: string) {
  const raw = (role ?? "").trim();
  const lower = raw.toLowerCase();
  return (
    lower === "admin" ||
    lower === "owner" ||
    raw === "管理员" ||
    raw === "工作区管理员" ||
    raw === "租户管理员"
  );
}

export default function AiSettingsPage() {
  const [admin] = useState<boolean | null>(() => hasAdminRole(getStoredUser()?.role));
  const [items, setItems] = useState<AiProfile[]>([]);
  const [presets, setPresets] = useState<AiProviderPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("custom");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoSendEnabled, setAutoSendEnabled] = useState(true);
  const [autoSendWindowStart, setAutoSendWindowStart] = useState("");
  const [autoSendWindowEnd, setAutoSendWindowEnd] = useState("");
  const [autoSendInWindow, setAutoSendInWindow] = useState(true);
  const [autoSendActiveNow, setAutoSendActiveNow] = useState(true);
  const [autoSendTimezone, setAutoSendTimezone] = useState("Asia/Shanghai");
  const [windowBusy, setWindowBusy] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<AiEvaluationReport | null>(null);
  const [tone, setTone] = useState<AiReplyStyle["tone"]>("direct");
  const [persona, setPersona] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxLength, setMaxLength] = useState(500);
  const [styleBusy, setStyleBusy] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);

  const editing = items.find((item) => item.id === editingId) ?? null;

  function applyPayload(data: AiSettingsPayload) {
    setItems(data.items);
    setPresets(data.presets);
  }

  function resetForm() {
    setEditingId(null);
    setApiKey("");
    setTestMessage(null);
    setTestOk(null);
    setError(null);
    setFormOpen(false);
    setName("");
    setBaseUrl("");
    setModel("");
    setProvider("custom");
  }

  function openCreate() {
    resetForm();
    const first = presets.find((item) => item.id !== "custom");
    if (first) {
      setProvider(first.id);
      setName(first.label);
      setBaseUrl(first.baseUrl);
      setModel(first.models[0] ?? "");
    }
    setFormOpen(true);
  }

  function chooseProvider(providerId: string) {
    const preset = presets.find((item) => item.id === providerId);
    setProvider(providerId);
    if (!editingId && preset) setName(preset.id === "custom" ? "" : preset.label);
    if (preset?.baseUrl) setBaseUrl(preset.baseUrl);
    else if (preset?.id === "custom") setBaseUrl("");
    setModel(preset?.models[0] ?? "");
    setTestOk(null);
    setTestMessage(null);
    setError(null);
  }

  useEffect(() => {
    const ok = isAdminRole(getStoredUser()?.role);
    if (!ok) return;
    void Promise.allSettled([
      api.aiSettings(),
      api.autoSendSetting(),
      api.replyStyle(),
    ]).then(([models, autoSend, style]) => {
      if (models.status === "fulfilled") applyPayload(models.value);
      else setError(models.reason instanceof ApiError ? models.reason.message : "无法读取模型配置");
      if (autoSend.status === "fulfilled") {
        applyAutoSend(autoSend.value);
      } else {
        setError(
          autoSend.reason instanceof ApiError
            ? autoSend.reason.message
            : "无法读取自动发送设置",
        );
      }
      if (style.status === "fulfilled") {
        setTone(style.value.tone);
        setPersona(style.value.persona ?? "");
        setSystemPrompt(style.value.systemPrompt ?? "");
        setMaxLength(style.value.maxLength ?? 500);
      } else {
        setError(style.reason instanceof ApiError ? style.reason.message : "无法读取回复风格");
      }
      setSettingsLoading(false);
    });
  }, []);

  async function saveReplyStyle() {
    setStyleBusy(true);
    setError(null);
    try {
      const saved = await api.setReplyStyle({
        tone,
        persona: persona.trim(),
        systemPrompt: systemPrompt.trim(),
        maxLength,
      });
      setTone(saved.tone);
      setPersona(saved.persona ?? "");
      setSystemPrompt(saved.systemPrompt ?? "");
      setMaxLength(saved.maxLength);
      setToast("回复风格已保存");
      window.setTimeout(() => setToast(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存回复风格失败");
    } finally {
      setStyleBusy(false);
    }
  }

  function applyAutoSend(result: {
    enabled: boolean;
    windowStart: string | null;
    windowEnd: string | null;
    timezone: string;
    inWindow: boolean;
    activeNow: boolean;
  }) {
    setAutoSendEnabled(result.enabled);
    setAutoSendWindowStart(
      result.windowStart ? normalizeTimeValue(result.windowStart) : "",
    );
    setAutoSendWindowEnd(
      result.windowEnd ? normalizeTimeValue(result.windowEnd) : "",
    );
    setAutoSendInWindow(result.inWindow);
    setAutoSendActiveNow(result.activeNow);
    setAutoSendTimezone(result.timezone || "Asia/Shanghai");
  }

  async function toggleAutoSend() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.setAutoSendSetting({ enabled: !autoSendEnabled });
      applyAutoSend(result);
      setToast(result.enabled ? "已启用自动发送" : "自动发送已暂停");
      window.setTimeout(() => setToast(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新自动发送设置失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveAutoSendWindow() {
    const start = autoSendWindowStart.trim();
    const end = autoSendWindowEnd.trim();
    if ((start && !end) || (!start && end)) {
      setError("请同时填写开始和结束时间，或都留空表示全天");
      return;
    }
    setWindowBusy(true);
    setError(null);
    try {
      const result = await api.setAutoSendSetting({
        windowStart: start || null,
        windowEnd: end || null,
      });
      applyAutoSend(result);
      setToast(start && end ? `已设置自动发送时段 ${start}–${end}` : "已改为全天自动发送");
      window.setTimeout(() => setToast(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存时段失败");
    } finally {
      setWindowBusy(false);
    }
  }

  function edit(item: AiProfile) {
    setEditingId(item.id);
    setProvider(presets.some((preset) => preset.id === item.provider) ? item.provider : "custom");
    setName(item.name);
    setBaseUrl(item.baseUrl);
    setModel(item.model);
    setApiKey("");
    setTestMessage(null);
    setTestOk(null);
    setError(null);
    setFormOpen(true);
  }

  function validateForm() {
    if (!name.trim()) return "请填写配置名称";
    if (!baseUrl.trim()) return "请填写接口地址";
    const baseError = isAllowedBase(baseUrl);
    if (baseError) return baseError;
    if (!model.trim()) return "请填写模型名称";
    if (!editingId && apiKey.trim().length < 8) return "请填写 API Key";
    return null;
  }

  async function save() {
    const invalid = validateForm();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      name: name.trim(),
      provider,
      baseUrl: baseUrl.trim().replace(/\/$/, ""),
      model: model.trim(),
      apiKey: apiKey.trim() || undefined,
    };
    try {
      const data = editingId
        ? await api.updateAiProfile(editingId, input)
        : await api.createAiProfile(input);
      applyPayload(data);
      resetForm();
      setToast(editingId ? "已更新模型配置" : "已添加模型配置");
      window.setTimeout(() => setToast(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    if (!baseUrl.trim()) {
      setError("请填写接口地址");
      return;
    }
    if (!model.trim()) {
      setError("请填写模型名称");
      return;
    }
    const baseError = isAllowedBase(baseUrl);
    if (baseError) {
      setError(baseError);
      return;
    }
    if (!editingId && apiKey.trim().length < 8) {
      setError("请填写 API Key");
      return;
    }
    setBusy(true);
    setError(null);
    setTestMessage(null);
    setTestOk(null);
    try {
      const result = await api.testAiSettings({
        id: editingId ?? undefined,
        provider,
        baseUrl: baseUrl.trim().replace(/\/$/, ""),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      setTestOk(result.ok);
      setTestMessage(result.message);
    } catch (err) {
      setTestOk(false);
      setTestMessage(err instanceof ApiError ? err.message : "测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    try {
      applyPayload(await api.activateAiProfile(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "切换失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const target = items.find((item) => item.id === id);
    const ok = window.confirm(
      `删除「${target?.name ?? "这套配置"}」？生成回复将改用剩余配置或本地规则。`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      applyPayload(await api.deleteAiProfile(id));
      if (editingId === id) resetForm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function runEvaluation() {
    setBusy(true);
    setError(null);
    try {
      setEvaluation(await api.evaluateAi(items.find((item) => item.active)?.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "运行 AI 评估失败");
    } finally {
      setBusy(false);
    }
  }

  if (admin === false) {
    return (
      <div className="animate-rise space-y-4">
        <PageHeader title="AI 模型" description="仅管理员可配置模型密钥。" />
        <Panel className="p-8">
          <EmptyState
            title="无权查看"
            description="模型密钥由管理员在服务端保存。客服账号看不到这一页。"
          />
        </Panel>
      </div>
    );
  }

  if (admin === null) {
    return (
      <div className="animate-rise space-y-4">
        <PageHeader title="AI 模型" description="正在确认权限…" />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="AI 模型"
        description="管理模型连接、当前使用配置与自动发送策略。密钥加密保存在服务端。"
        action={
          <Button type="button" onClick={openCreate}>
            添加配置
          </Button>
        }
      />

      {error && !formOpen ? <p className="text-sm text-danger">{error}</p> : null}

      <Panel className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-ink">工作区自动发送</h2>
              <span
                className={`text-xs ${
                  settingsLoading
                    ? "text-ink-soft"
                    : !autoSendEnabled
                      ? "text-ink-soft"
                      : autoSendActiveNow
                        ? "text-success"
                        : "text-warn"
                }`}
              >
                {settingsLoading
                  ? "读取中"
                  : !autoSendEnabled
                    ? "已暂停"
                    : autoSendActiveNow
                      ? "运行中"
                      : "时段外"}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {!autoSendEnabled
                ? "已暂停自动发送；AI 仍可生成草稿供客服审核。"
                : autoSendActiveNow
                  ? "符合回复策略的 AI 草稿可自动发送；人工接管和风险规则仍优先。"
                  : "当前不在自动发送时段，草稿将留给客服审核。"}
            </p>
          </div>
          <Button
            type="button"
            variant={autoSendEnabled ? "danger" : "secondary"}
            disabled={busy || settingsLoading}
            onClick={() => void toggleAutoSend()}
          >
            {autoSendEnabled ? "暂停自动发送" : "启用自动发送"}
          </Button>
        </div>

        <div className="border-t border-line pt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">自动发送时段</p>
              <p className="mt-1 text-xs text-ink-soft">
                按北京时间判断；时段外仍生成草稿，不会自动发出。
              </p>
            </div>
            <div className="inline-flex rounded-[4px] border border-line bg-surface p-0.5">
              {(
                [
                  ["all", "全天"],
                  ["custom", "指定时段"],
                ] as const
              ).map(([mode, label]) => {
                const active =
                  mode === "all"
                    ? !autoSendWindowStart && !autoSendWindowEnd
                    : Boolean(autoSendWindowStart || autoSendWindowEnd);
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={settingsLoading || windowBusy}
                    onClick={() => {
                      if (mode === "all") {
                        setAutoSendWindowStart("");
                        setAutoSendWindowEnd("");
                        return;
                      }
                      if (!autoSendWindowStart && !autoSendWindowEnd) {
                        setAutoSendWindowStart("09:00");
                        setAutoSendWindowEnd("18:00");
                      }
                    }}
                    className={`min-h-8 px-3 text-xs transition ${
                      active
                        ? "bg-ink text-paper"
                        : "text-ink-soft hover:text-ink"
                    } disabled:opacity-50`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {!autoSendWindowStart && !autoSendWindowEnd ? (
            <div className="mt-3 rounded-[4px] border border-dashed border-line bg-surface/60 px-4 py-5">
              <p className="text-sm text-ink">全天均可自动发送</p>
              <p className="mt-1 text-xs text-ink-soft">
                启用自动发送后，不限制钟点。需要休息时段时，切换到「指定时段」。
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="rounded-[4px] border border-line bg-surface/40 p-3 sm:p-4">
                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                  <TimeSelectField
                    label="开始"
                    value={autoSendWindowStart}
                    disabled={settingsLoading || windowBusy}
                    onChange={setAutoSendWindowStart}
                  />
                  <div className="flex items-center justify-center sm:px-1 sm:pt-5">
                    <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-line bg-paper text-xs text-ink-soft">
                      至
                    </span>
                  </div>
                  <TimeSelectField
                    label="结束"
                    value={autoSendWindowEnd}
                    disabled={settingsLoading || windowBusy}
                    onChange={setAutoSendWindowEnd}
                  />
                </div>

                <AutoSendWindowTimeline
                  start={autoSendWindowStart}
                  end={autoSendWindowEnd}
                  inWindow={autoSendInWindow}
                />

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 ${
                      autoSendInWindow
                        ? "bg-ok-soft text-ok"
                        : "bg-warn-soft text-warn"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        autoSendInWindow ? "bg-ok" : "bg-warn"
                      }`}
                    />
                    {autoSendInWindow ? "当前在时段内" : "当前在时段外"}
                  </span>
                  <span className="text-ink-soft">
                    {autoSendWindowStart} – {autoSendWindowEnd}
                    {autoSendWindowStart > autoSendWindowEnd ? "（跨夜）" : ""}
                    · {autoSendTimezone}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["09:00", "18:00", "工作时段"],
                    ["08:00", "22:00", "延长服务"],
                    ["22:00", "06:00", "夜间值守"],
                  ] as const
                ).map(([start, end, label]) => {
                  const selected =
                    autoSendWindowStart === start && autoSendWindowEnd === end;
                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={settingsLoading || windowBusy}
                      onClick={() => {
                        setAutoSendWindowStart(start);
                        setAutoSendWindowEnd(end);
                      }}
                      className={`rounded-[4px] border px-2.5 py-1.5 text-xs transition disabled:opacity-50 ${
                        selected
                          ? "border-accent bg-accent-soft text-accent-deep"
                          : "border-line bg-paper text-ink-soft hover:border-ink/20 hover:text-ink"
                      }`}
                    >
                      {label}
                      <span className="ml-1.5 tabular-nums opacity-70">
                        {start}–{end}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={settingsLoading || windowBusy}
              onClick={() => {
                setAutoSendWindowStart("");
                setAutoSendWindowEnd("");
              }}
            >
              重置为全天
            </Button>
            <Button
              type="button"
              disabled={settingsLoading || windowBusy}
              onClick={() => void saveAutoSendWindow()}
            >
              {windowBusy ? "保存中…" : "保存时段"}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-surface/60"
          aria-expanded={styleOpen}
          onClick={() => setStyleOpen((open) => !open)}
        >
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-ink">回复人设与语气</h2>
            <p className="mt-1 text-xs text-ink-soft">
              {styleOpen
                ? "作用于本工作区全部 AI 草稿。模型连接仍在下方单独配置。"
                : [
                    tone === "warm" ? "亲切温和" : tone === "formal" ? "正式书面" : "直接简洁",
                    `${maxLength} 字`,
                    persona.trim() || null,
                    systemPrompt.trim() ? "已设补充指令" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </div>
          <span className="shrink-0 pt-0.5 text-xs text-accent">
            {styleOpen ? "收起" : "展开"}
          </span>
        </button>
        {styleOpen ? (
          <div className="space-y-4 border-t border-line px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="语气">
                <select
                  className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                  value={tone}
                  disabled={settingsLoading || styleBusy}
                  onChange={(e) => setTone(e.target.value as AiReplyStyle["tone"])}
                >
                  <option value="direct">直接简洁</option>
                  <option value="warm">亲切温和</option>
                  <option value="formal">正式书面</option>
                </select>
              </Field>
              <Field label="长度上限（字）">
                <TextInput
                  type="number"
                  min={50}
                  max={2000}
                  value={String(maxLength)}
                  disabled={settingsLoading || styleBusy}
                  onChange={(e) => setMaxLength(Number(e.target.value) || 500)}
                />
              </Field>
            </div>
            <Field label="人设称谓（可选）">
              <TextInput
                placeholder="例如：云帆礼品客服"
                value={persona}
                disabled={settingsLoading || styleBusy}
                onChange={(e) => setPersona(e.target.value)}
              />
            </Field>
            <Field label="补充指令（可选）">
              <textarea
                className="min-h-24 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
                placeholder="例如：报价口径以知识库为准；不确定时先确认数量。"
                value={systemPrompt}
                disabled={settingsLoading || styleBusy}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={settingsLoading || styleBusy}
                onClick={() => void saveReplyStyle()}
              >
                {styleBusy ? "保存中…" : "保存回复风格"}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel>
        <header className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-ink">模型配置 <span className="ml-1 font-normal text-ink-soft">{settingsLoading ? "读取中" : items.length}</span></h2>
            <p className="mt-0.5 text-xs text-ink-soft">当前配置用于生成 AI 回复；密钥仅显示末四位。</p>
          </div>
        </header>
        {settingsLoading ? (
          <EmptyState title="正在加载配置" description="正在读取当前工作区的模型连接。" />
        ) : items.length === 0 ? (
          <EmptyState
            title="还没有配置"
            description="点右上角添加一套模型，填写接口地址、模型名和 API Key。"
          />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li
                key={item.id}
                className={`grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5 ${
                  item.id === editingId ? "bg-surface" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                    {item.active ? (
                      <span className="border border-accent/20 bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-deep">当前使用</span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <span>{item.providerLabel}</span>
                    <span>模型 {item.model}</span>
                    <span>密钥 {item.keyHint}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-soft" title={item.baseUrl}>{item.baseUrl}</p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:justify-end">
                  {item.active ? null : (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void activate(item.id)}
                    >
                      设为当前
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => edit(item)}
                  >
                    编辑
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void remove(item.id)}
                  >
                    删除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-ink">AI 回复评估</h2>
            <p className="mt-1 text-xs text-ink-soft">检查知识命中、引用对应关系、无依据时的处理和转人工策略。结果不等同于人工事实准确性验收。</p>
          </div>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void runEvaluation()}>
            {busy ? "评估中…" : "运行评估"}
          </Button>
        </div>
        {evaluation ? (
          <div className="p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <strong className="text-ink">通过 {evaluation.summary.passed}/{evaluation.summary.total}</strong>
              <span className="text-ink-soft">失败 {evaluation.summary.failed}</span>
              <span className="text-ink-soft">模型 {evaluation.model?.model ?? "未配置"}</span>
              <span className="text-ink-soft">{new Date(evaluation.generatedAt).toLocaleString("zh-CN")}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-soft">{evaluation.summary.note}</p>
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {evaluation.results.map((result) => (
                <li key={result.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`text-sm font-medium ${result.passed ? "text-ok" : "text-danger"}`}>{result.passed ? "通过" : "未通过"}</span>
                    <span className="text-sm text-ink">{result.title}</span>
                    <span className="text-xs text-ink-soft">{result.status} · {result.durationMs} ms</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{result.customerMessage}</p>
                  {result.reason ? <p className="mt-1 text-xs text-ink-soft">处理原因：{result.reason}</p> : null}
                  <p className="mt-1 text-xs text-ink-soft">知识命中 {result.retrievalHits.length} · 有效引用 {result.validCitationCount}/{result.citationCount}</p>
                  {result.draft ? <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{result.draft}</p> : null}
                  {result.retrievalHits.length ? <ul className="mt-2 space-y-1 border-l-2 border-line pl-3">{result.retrievalHits.map((hit) => <li key={hit.documentId} className="text-xs text-ink-soft"><span className="font-medium text-ink">{hit.title}</span> · 分数 {hit.score} · {hit.excerpt}</li>)}</ul> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Modal
        open={formOpen}
        wide
        title={editingId ? "编辑配置" : "添加配置"}
        description="每套配置对应一个模型。需要使用多个模型时，分别添加配置，再切换当前使用项。"
        onClose={() => resetForm()}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => resetForm()}>
              取消
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void test()}
            >
              测试连接
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {editingId ? "保存修改" : "添加"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="服务商">
              <select value={provider} onChange={(event) => chooseProvider(event.target.value)} disabled={busy} className="min-h-9 w-full border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-accent">
                {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </Field>
            <Field label="配置名称">
              <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 DeepSeek 客服主模型" autoComplete="off" />
            </Field>
          </div>
          <section className="space-y-4 border-t border-line pt-4">
            <div>
              <h3 className="text-xs font-semibold text-ink">模型与连接</h3>
              <p className="mt-1 text-xs text-ink-soft">选择建议模型，或按服务商控制台输入其他模型 ID。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="模型 ID">
                <TextInput
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                    setTestOk(null);
                    setTestMessage(null);
                  }}
                  list="ai-provider-model-options"
                  placeholder="选择或输入模型 ID"
                  spellCheck={false}
                  autoComplete="off"
                />
                <datalist id="ai-provider-model-options">
                  {presets.find((preset) => preset.id === provider)?.models.map((modelName) => <option key={modelName} value={modelName} />)}
                </datalist>
              </Field>
              <Field label="接口地址（Base URL）">
                <TextInput
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                    setTestOk(null);
                    setTestMessage(null);
                  }}
                  placeholder="服务商接口地址或自建兼容网关"
                  spellCheck={false}
                />
              </Field>
            </div>
            <p className="text-xs text-ink-soft">使用 OpenAI 兼容协议：<code className="text-[11px]">{"{地址}/chat/completions"}</code>。地址可按服务商文档修改；内网可使用 HTTP。</p>
          </section>

          <section className="space-y-4 border-t border-line pt-4">
            <h3 className="text-xs font-semibold text-ink">身份验证</h3>
            <Field label="API Key">
              <TextInput
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setTestOk(null);
                  setTestMessage(null);
                }}
                placeholder={editing ? `已隐藏（${editing.keyHint}），留空表示沿用` : "填写该服务商的 API Key"}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <p className="text-xs leading-relaxed text-ink-soft">测试连接会用当前填写的服务商、模型和密钥发起真实请求。建议测试通过后再保存。</p>
          </section>

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {testMessage ? (
            <div role="status" className={`border px-4 py-3 text-sm ${testOk ? "border-ok/30 bg-ok-soft" : "border-danger/20 bg-danger-soft"}`}>
              <p className={testOk ? "text-ok" : "text-danger"}>{testMessage}</p>
            </div>
          ) : null}
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
const MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

function normalizeTimeValue(value: string, fallback = "09:00"): string {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) return fallback;
  const hour = match[1];
  const minuteNum = Number(match[2]);
  const snapped = Math.round(minuteNum / 5) * 5;
  const minute = String(snapped === 60 ? 55 : snapped).padStart(2, "0");
  return `${hour}:${minute}`;
}

function parseTimeParts(value: string): { hour: string; minute: string } {
  const normalized = normalizeTimeValue(value);
  const [hour, minute] = normalized.split(":");
  return { hour, minute };
}

function TimeSelectField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const { hour, minute } = parseTimeParts(value || "09:00");

  function update(nextHour: string, nextMinute: string) {
    onChange(`${nextHour}:${nextMinute}`);
  }

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      <div
        className={`flex min-h-11 items-stretch overflow-hidden rounded-[4px] border border-line bg-paper transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15 ${
          disabled ? "opacity-60" : ""
        }`}
      >
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{label}小时</span>
          <select
            value={hour}
            disabled={disabled}
            onChange={(e) => update(e.target.value, minute)}
            className="h-full w-full cursor-pointer appearance-none bg-transparent py-2.5 pl-3 pr-8 font-display text-lg tabular-nums text-ink outline-none disabled:cursor-not-allowed"
          >
            {HOUR_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <SelectChevron />
        </label>
        <span
          aria-hidden
          className="flex items-center border-x border-line bg-surface/70 px-2 font-display text-lg text-ink-soft"
        >
          :
        </span>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{label}分钟</span>
          <select
            value={minute}
            disabled={disabled}
            onChange={(e) => update(hour, e.target.value)}
            className="h-full w-full cursor-pointer appearance-none bg-transparent py-2.5 pl-3 pr-8 font-display text-lg tabular-nums text-ink outline-none disabled:cursor-not-allowed"
          >
            {MINUTE_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <SelectChevron />
        </label>
      </div>
    </div>
  );
}

function SelectChevron() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ink-soft"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2.5 4.5L6 8L9.5 4.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function parseTimeToMinutes(value: string): number | null {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function AutoSendWindowTimeline({
  start,
  end,
  inWindow,
}: {
  start: string;
  end: string;
  inWindow: boolean;
}) {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin == null || endMin == null) return null;

  const overnight = startMin > endMin;
  const same = startMin === endMin;
  const segments = same
    ? [{ left: 0, width: 100 }]
    : overnight
      ? [
          { left: (startMin / 1440) * 100, width: 100 - (startMin / 1440) * 100 },
          { left: 0, width: (endMin / 1440) * 100 },
        ]
      : [
          {
            left: (startMin / 1440) * 100,
            width: ((endMin - startMin) / 1440) * 100,
          },
        ];

  return (
    <div className="mt-4 space-y-2">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-line/70">
        {segments.map((seg, index) => (
          <span
            key={index}
            className={`absolute inset-y-0 rounded-full ${
              inWindow ? "bg-accent" : "bg-warn"
            }`}
            style={{ left: `${seg.left}%`, width: `${Math.max(seg.width, 1.2)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-ink-soft">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
