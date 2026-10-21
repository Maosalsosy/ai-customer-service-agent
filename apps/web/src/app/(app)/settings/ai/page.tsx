"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  api,
  type AiProfile,
  type AiProviderPreset,
  type AiEvaluationReport,
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
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<AiEvaluationReport | null>(null);

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
    void Promise.allSettled([api.aiSettings(), api.autoSendSetting()]).then(([models, autoSend]) => {
      if (models.status === "fulfilled") applyPayload(models.value);
      else setError(models.reason instanceof ApiError ? models.reason.message : "无法读取模型配置");
      if (autoSend.status === "fulfilled") setAutoSendEnabled(autoSend.value.enabled);
      else setError(autoSend.reason instanceof ApiError ? autoSend.reason.message : "无法读取自动发送设置");
      setSettingsLoading(false);
    });
  }, []);

  async function toggleAutoSend() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.setAutoSendSetting(!autoSendEnabled);
      setAutoSendEnabled(result.enabled);
      setToast(result.enabled ? "已启用自动发送" : "自动发送已暂停");
      window.setTimeout(() => setToast(null), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "更新自动发送设置失败");
    } finally {
      setBusy(false);
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

      <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-ink">租户自动发送</h2>
            <span className={`text-xs ${settingsLoading ? "text-ink-soft" : autoSendEnabled ? "text-success" : "text-ink-soft"}`}>
              {settingsLoading ? "读取中" : autoSendEnabled ? "运行中" : "已暂停"}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {autoSendEnabled
              ? "符合回复策略的 AI 草稿可自动发送；人工接管和风险规则仍优先。"
              : "已暂停自动发送；AI 仍可生成草稿供客服审核。"}
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
      </Panel>

      <Panel>
        <header className="flex flex-col gap-1 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-medium text-ink">模型配置 <span className="ml-1 font-normal text-ink-soft">{settingsLoading ? "读取中" : items.length}</span></h2>
            <p className="mt-0.5 text-xs text-ink-soft">当前配置用于生成 AI 回复；密钥仅显示末四位。</p>
          </div>
        </header>
        {settingsLoading ? (
          <EmptyState title="正在加载配置" description="正在读取当前租户的模型连接。" />
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
