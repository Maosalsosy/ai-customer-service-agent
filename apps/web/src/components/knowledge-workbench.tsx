"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type ApiKnowledgeDoc,
  type ApiKnowledgeGap,
  type ApiKnowledgeIndexHealth,
  type ApiKnowledgeRetrieveResult,
} from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { Button, EmptyState, Modal, PageHeader, Pager } from "@/components/ui";

type SourceType = "faq" | "markdown";
type DocStatus = ApiKnowledgeDoc["status"];
type StatusTab = DocStatus | "other";
type SourceFilter = "all" | SourceType;
type DialogMode = "view" | "edit" | null;

const groups: { key: DocStatus; label: string; hint: string }[] = [
  { key: "pending", label: "待审批", hint: "客服提交的新知识，管理员批准后才会发布" },
  { key: "rejected", label: "已驳回", hint: "修改后重新提交，再次进入待审批" },
  { key: "ready", label: "已发布", hint: "会进入客服回复检索" },
  { key: "draft", label: "草稿", hint: "管理员草稿；客服新建会直接进入待审批" },
  { key: "archived", label: "已下线", hint: "文章保留，回复不再引用" },
];

const AGENT_EDITABLE = new Set<DocStatus>(["draft", "pending", "rejected"]);

const sourceFilters: { key: SourceFilter; label: string }[] = [
  { key: "all", label: "全部类型" },
  { key: "faq", label: "FAQ" },
  { key: "markdown", label: "Markdown" },
];

const FAQ_TEMPLATE =
  "Q: 马克杯印单色 logo 起订多少？200 个能不能做？\nA: 陶瓷马克杯单色丝印起订 100 个。200 个可以做。常规交期 7 个工作日（从效果图确认并付定金起算）。";

const DOC_PAGE_SIZE = 8;

type EditorBaseline = {
  title: string;
  body: string;
  sourceType: SourceType;
};

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

function parseFaqBlocks(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: { q: string; a: string }[] = [];
  let q = "";
  let a: string[] = [];
  const flush = () => {
    if (!q && !a.length) return;
    blocks.push({
      q: q || "（未写问题）",
      a: a.join("\n").trim() || "（未写答案）",
    });
    q = "";
    a = [];
  };
  for (const line of lines) {
    if (/^Q[:：]/.test(line.trim())) {
      flush();
      q = line.trim().replace(/^Q[:：]\s*/, "");
      continue;
    }
    if (/^A[:：]/.test(line.trim()) && q) {
      a.push(line.trim().replace(/^A[:：]\s*/, ""));
      continue;
    }
    if (q) a.push(line);
  }
  flush();
  return blocks;
}

function PreviewBody({
  sourceType,
  body,
}: {
  sourceType: SourceType;
  body: string;
}) {
  if (!body.trim()) {
    return <p className="text-sm text-ink-soft">正文为空</p>;
  }
  if (sourceType === "faq") {
    const blocks = parseFaqBlocks(body);
    if (!blocks.length) {
      return (
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
          {body}
        </pre>
      );
    }
    return (
      <div className="space-y-4">
        {blocks.map((block, index) => (
          <article
            key={`${block.q}-${index}`}
            className="border-b border-line pb-4 last:border-b-0"
          >
            <p className="text-sm font-medium text-ink">问：{block.q}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              答：{block.a}
            </p>
          </article>
        ))}
      </div>
    );
  }

  const parts = body.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="space-y-3">
      {parts.map((part, index) => {
        const heading = part.match(/^(#{1,3})\s+(.+)$/m);
        if (heading && part.trim().startsWith("#")) {
          const level = heading[1].length;
          const title = heading[2];
          const rest = part.replace(/^#{1,3}\s+.+$/m, "").trim();
          const HeadingTag = level === 1 ? "h3" : "h4";
          return (
            <div key={index}>
              <HeadingTag className="font-display text-base font-semibold text-ink">
                {title}
              </HeadingTag>
              {rest ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                  {rest}
                </p>
              ) : null}
            </div>
          );
        }
        return (
          <p
            key={index}
            className="whitespace-pre-wrap text-sm leading-relaxed text-ink"
          >
            {part}
          </p>
        );
      })}
    </div>
  );
}

export function KnowledgeWorkbench() {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [gaps, setGaps] = useState<ApiKnowledgeGap[]>([]);
  const [showGaps, setShowGaps] = useState(false);
  const [docs, setDocs] = useState<ApiKnowledgeDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("faq");
  const [baseline, setBaseline] = useState<EditorBaseline | null>(null);
  const [status, setStatus] = useState<DocStatus>("draft");
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [admin, setAdmin] = useState(() => isAdminRole(getStoredUser()?.role));
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [indexSettings, setIndexSettings] = useState({
    chunkSize: 480,
    chunkOverlap: 80,
    maxChunksPerDoc: 40,
  });
  const [indexBaseline, setIndexBaseline] = useState(indexSettings);
  const [indexSaving, setIndexSaving] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [gapBusyId, setGapBusyId] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<StatusTab>("pending");
  const [statusTabTouched, setStatusTabTouched] = useState(false);
  const [retrieveOpen, setRetrieveOpen] = useState(false);
  const [retrieveQuery, setRetrieveQuery] = useState("");
  const [retrieveBusy, setRetrieveBusy] = useState(false);
  const [retrieveResult, setRetrieveResult] =
    useState<ApiKnowledgeRetrieveResult | null>(null);
  const [indexHealth, setIndexHealth] =
    useState<ApiKnowledgeIndexHealth | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.listKnowledge(query || undefined, { limit: 200 });
      setDocs(data.items);
      setGaps(await api.listKnowledgeGaps());
      window.dispatchEvent(new Event("aikefu:knowledge-changed"));
      return data.items;
    } catch {
      setDocs([]);
      notify("无法加载知识库，请确认 API 已启动");
      return [];
    } finally {
      setListLoading(false);
    }
  }, [notify, query]);

  useEffect(() => {
    void api
      .me()
      .then((profile) => {
        const isAdmin = isAdminRole(profile.user.role);
        setAdmin(isAdmin);
        if (!isAdmin) return;
        return Promise.all([
          api.getKnowledgeIndexSettings().then((settings) => {
            setIndexSettings(settings);
            setIndexBaseline(settings);
          }),
          api.getKnowledgeIndexHealth().then(setIndexHealth).catch(() => undefined),
        ]);
      })
      .catch(() => undefined);
  }, []);

  async function runRetrieve() {
    const q = retrieveQuery.trim();
    if (!q || retrieveBusy) return;
    setRetrieveBusy(true);
    try {
      const result = await api.retrieveKnowledge(q, 5);
      setRetrieveResult(result);
      setIndexHealth(result.index);
    } catch (err) {
      notify(err instanceof Error ? err.message : "试检索失败");
    } finally {
      setRetrieveBusy(false);
    }
  }

  async function runReindexMissing() {
    if (reindexing) return;
    if (
      !window.confirm(
        "将对已发布但缺少向量索引的文档补建索引。确定继续？",
      )
    ) {
      return;
    }
    setReindexing(true);
    try {
      const result = await api.reindexMissingKnowledge();
      setIndexHealth(result.index);
      notify(
        result.errors.length
          ? `已补索引 ${result.indexedCount} 篇，失败 ${result.errors.length} 篇`
          : `已补索引 ${result.indexedCount} 篇`,
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "补索引失败");
    } finally {
      setReindexing(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const dirty =
    baseline != null &&
    (title !== baseline.title ||
      body !== baseline.body ||
      sourceType !== baseline.sourceType);

  const filtered = useMemo(
    () =>
      docs.filter((doc) =>
        sourceFilter === "all" ? true : doc.sourceType === sourceFilter,
      ),
    [docs, sourceFilter],
  );

  const grouped = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        items: filtered.filter((doc) => doc.status === group.key),
      })),
    [filtered],
  );

  const statusTabs = useMemo(() => {
    const primary = new Set<DocStatus>(["pending", "ready", "draft"]);
    return grouped.filter(
      (group) => primary.has(group.key) || group.items.length > 0,
    );
  }, [grouped]);

  const otherDocs = filtered.filter(
    (doc) => !groups.some((group) => group.key === doc.status),
  );
  const publishedCount = docs.filter((doc) => doc.status === "ready").length;
  const pendingCount = docs.filter((doc) => doc.status === "pending").length;
  const activeGaps = useMemo(
    () =>
      gaps.filter(
        (gap) => gap.status === "open" || gap.status === "in_progress",
      ),
    [gaps],
  );
  const openGapCount = activeGaps.length;

  const preferredTab = (() => {
    if (statusTabTouched || listLoading) return statusTab;
    const preferred: DocStatus[] = admin
      ? ["pending", "ready", "draft", "rejected", "archived"]
      : ["ready", "pending", "draft", "rejected", "archived"];
    return (
      preferred.find((key) => {
        const count =
          grouped.find((group) => group.key === key)?.items.length ?? 0;
        return count > 0;
      }) ?? (admin ? "pending" : "ready")
    );
  })();
  const activeStatusTab: StatusTab = preferredTab === "other"
    ? (otherDocs.length > 0 ? "other" : statusTabs[0]?.key ?? "other")
    : statusTabs.some((group) => group.key === preferredTab)
      ? preferredTab
      : statusTabs[0]?.key ?? preferredTab;
  const activeGroup =
    activeStatusTab === "other"
      ? null
      : (statusTabs.find((group) => group.key === activeStatusTab) ??
        statusTabs[0] ??
        null);

  function remember(next: EditorBaseline, meta?: { updatedAt?: string }) {
    setTitle(next.title);
    setBody(next.body);
    setSourceType(next.sourceType);
    setBaseline(next);
    if (meta?.updatedAt !== undefined) setUpdatedAt(meta.updatedAt);
  }

  function confirmDiscard() {
    if (!dirty || dialog !== "edit") return true;
    return window.confirm("有未保存的修改，确定离开？");
  }

  function closeDialog() {
    if (!confirmDiscard()) return;
    setDialog(null);
    setCreating(false);
    setSelectedId(null);
    setBaseline(null);
  }

  function startCreate(preset: SourceType = "faq") {
    if (!confirmDiscard()) return;
    setCreating(true);
    setSelectedId(null);
    setStatus(admin ? "draft" : "pending");
    setReviewNote(null);
    setUpdatedAt(null);
    setDialog("edit");
    remember({
      title: "",
      body: preset === "faq" ? FAQ_TEMPLATE : "# 标题\n\n在此编写政策说明。",
      sourceType: preset,
    });
  }

  async function openDoc(id: string, mode: "view" | "edit") {
    if (dialog === "edit" && selectedId !== id && !confirmDiscard()) return;
    setCreating(false);
    setSelectedId(id);
    setDialog(mode);
    setDetailLoading(true);
    try {
      const doc = await api.getKnowledge(id);
      setStatus(doc.status);
      setReviewNote(doc.reviewNote ?? null);
      setUpdatedAt(doc.updatedAt);
      remember({
        title: doc.title,
        body: doc.body,
        sourceType: doc.sourceType,
      });
    } catch (err) {
      setDialog(null);
      notify(err instanceof Error ? err.message : "无法打开文档");
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveDraft() {
    const payload = {
      title: title.trim(),
      sourceType,
      body: body.trim(),
    };
    if (!payload.title || !payload.body) {
      notify("请填写标题和正文");
      return null;
    }
    if (creating) {
      const created = await api.createKnowledge(payload);
      setCreating(false);
      setSelectedId(created.id);
      setStatus(created.status ?? "draft");
      setUpdatedAt(created.updatedAt ?? null);
      remember(payload, { updatedAt: created.updatedAt });
      return created.id;
    }
    if (!selectedId) return null;
    const updated = await api.updateKnowledge(selectedId, payload);
    setStatus(updated.status);
    setUpdatedAt(updated.updatedAt);
    remember(payload, { updatedAt: updated.updatedAt });
    return selectedId;
  }

  async function handleSave() {
    const wasCreate = creating;
    if (
      admin &&
      !wasCreate &&
      (status === "ready" || status === "archived")
    ) {
      const ok = window.confirm(
        status === "ready"
          ? "保存后将退出已发布状态并清除检索索引，需重新发布后才会被回复引用。确定继续？"
          : "保存后将变为草稿，需重新发布后才会被回复引用。确定继续？",
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const id = await saveDraft();
      if (!id) return;
      if (admin) {
        notify(
          wasCreate ? "已保存为草稿" : "已保存修改。发布后才会进入检索",
        );
        if (wasCreate || status === "ready" || status === "archived") {
          setStatusTabTouched(true);
          setStatusTab("draft");
        }
      } else {
        notify(wasCreate ? "已提交，等待管理员审批" : "已重新提交审批");
        setReviewNote(null);
        setStatusTabTouched(true);
        setStatusTab("pending");
      }
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    const wasReady = status === "ready" && !dirty;
    const wasArchived = status === "archived";
    const wasPending = status === "pending";
    setBusy(true);
    try {
      let docId = selectedId;
      if (dirty || creating || !docId) {
        const saved = await saveDraft();
        if (!saved) return;
        docId = saved;
      }
      const published = await api.publishKnowledge(docId);
      setSelectedId(docId);
      setCreating(false);
      setStatus(published.status ?? "ready");
      setReviewNote(null);
      setUpdatedAt(published.updatedAt ?? null);
      remember(
        { title: title.trim(), body: body.trim(), sourceType },
        { updatedAt: published.updatedAt },
      );
      notify(
        wasReady
          ? "已重新索引"
          : wasArchived
            ? "已重新发布"
            : wasPending
              ? "已批准并发布，可用于检索"
              : "已发布，可用于检索",
      );
      setStatusTabTouched(true);
      setStatusTab("ready");
      await load();
      setDialog("view");
    } catch (err) {
      notify(err instanceof Error ? err.message : "发布失败");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function publishRow(id: string) {
    const wasPending = docs.find((doc) => doc.id === id)?.status === "pending";
    setBusy(true);
    try {
      await api.publishKnowledge(id);
      notify(
        wasPending
          ? "已批准并发布，可用于检索"
          : "已发布，可用于检索",
      );
      if (selectedId === id) {
        setStatus("ready");
        setReviewNote(null);
      }
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  function openReject(id: string) {
    setRejectTargetId(id);
    setRejectNote("");
  }

  function closeReject() {
    if (rejecting) return;
    setRejectTargetId(null);
    setRejectNote("");
  }

  async function confirmReject() {
    if (!rejectTargetId) return;
    setRejecting(true);
    try {
      const rejected = await api.rejectKnowledge(
        rejectTargetId,
        rejectNote.trim() || undefined,
      );
      const reason = rejected.reviewNote?.trim();
      notify(reason ? `已驳回：${reason}` : "已驳回");
      if (selectedId === rejectTargetId) {
        setStatus(rejected.status);
        setReviewNote(rejected.reviewNote ?? null);
        setDialog("view");
      }
      setRejectTargetId(null);
      setRejectNote("");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "驳回失败");
    } finally {
      setRejecting(false);
    }
  }

  async function archiveRow(id: string) {
    if (!window.confirm("下线后回复将不再引用此文章，确定下线？")) return;
    setBusy(true);
    try {
      await api.archiveKnowledge(id);
      notify("已下线，回复不再引用");
      if (selectedId === id) setStatus("archived");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "下线失败");
    } finally {
      setBusy(false);
    }
  }

  async function convertGap(id: string) {
    if (gapBusyId) return;
    setGapBusyId(id);
    try {
      await api.convertKnowledgeGapToFaq(id);
      notify("已生成待审批 FAQ");
      setStatusTabTouched(true);
      setStatusTab("pending");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "创建 FAQ 失败");
    } finally {
      setGapBusyId(null);
    }
  }

  async function ignoreGap(id: string) {
    if (gapBusyId) return;
    if (!window.confirm("忽略后将从待补充列表移除，确定忽略？")) return;
    setGapBusyId(id);
    try {
      await api.updateKnowledgeGap(id, "ignored");
      notify("已忽略该知识缺口");
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "忽略失败");
    } finally {
      setGapBusyId(null);
    }
  }

  async function handleDelete(id?: string) {
    const targetId = id ?? selectedId;
    if (!targetId) return;
    if (!window.confirm("删除后不可恢复，确定删除这篇文章？")) return;
    setBusy(true);
    let deleted = false;
    try {
      await api.deleteKnowledge(targetId);
      deleted = true;
    } catch (err) {
      // 后端可能已删成功但返回空 body，旧客户端会把 JSON 解析失败当成错误。
      const message = err instanceof Error ? err.message : "删除失败";
      const looksLikeEmptyParse =
        /unexpected end of json|json.parse|unexpected eof|failed to execute 'json'/i.test(
          message,
        );
      const looksGone =
        err instanceof Error &&
        (("status" in err && (err as { status?: number }).status === 404) ||
          /not found|未找到|不存在/i.test(message));
      if (looksLikeEmptyParse || looksGone) {
        deleted = true;
      } else {
        notify(message);
      }
    } finally {
      if (deleted) {
        if (selectedId === targetId) {
          setDialog(null);
          setSelectedId(null);
          setCreating(false);
          setBaseline(null);
        }
        setDocs((prev) => prev.filter((doc) => doc.id !== targetId));
        notify("文章已删除");
        await load();
      }
      setBusy(false);
    }
  }

  const canEdit = creating || admin || AGENT_EDITABLE.has(status);
  const canDeleteCurrent =
    Boolean(selectedId) &&
    !creating &&
    (admin || AGENT_EDITABLE.has(status));
  const publishLabel =
    status === "ready" && !dirty
      ? "重新索引"
      : status === "archived"
        ? "重新发布"
        : status === "pending"
          ? "批准发布"
          : "发布";
  const saveLabel = creating
    ? admin
      ? "保存草稿"
      : "提交审批"
    : admin
      ? "保存修改"
      : status === "rejected"
        ? "修改并重新提交"
        : "保存并提交";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (rejectTargetId) {
          event.preventDefault();
          closeReject();
          return;
        }
        if (dialog) {
          event.preventDefault();
          closeDialog();
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      if (dialog !== "edit") return;
      event.preventDefault();
      if (busy || !canEdit || !dirty || !title.trim() || !body.trim()) return;
      void handleSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function insertFaqPair() {
    const snippet = "\n\nQ: \nA: ";
    setBody((prev) => (prev.trim() ? `${prev.trim()}${snippet}` : FAQ_TEMPLATE));
  }

  async function uploadFiles(list: FileList | File[]) {
    const files = [...list];
    if (!files.length || uploading) return;
    setUploading(true);
    try {
      const result = await api.uploadKnowledge(files);
      const failed = result.errors
        .map((item) => `${item.filename}：${item.message}`)
        .join("；");
      const pendingCount = result.items.filter(
        (item) => item.status === "pending",
      ).length;
      notify(
        failed
          ? `已导入 ${result.items.length} 篇。${failed}`
          : pendingCount === result.items.length
            ? `已导入 ${result.items.length} 篇，等待管理员审批`
            : `已导入 ${result.items.length} 篇草稿，发布后才会被检索`,
      );
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="animate-rise space-y-4">
      <PageHeader
        title="知识库"
        description={admin
          ? "客服新建的知识需在此批准后才会进入检索；检索规则仅管理员可改。"
          : "新建或上传后进入待审批，管理员批准后才会被检索。"}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setRetrieveResult(null);
                setRetrieveOpen(true);
              }}
            >
              试检索
            </Button>
            {admin ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setIndexSettings(indexBaseline);
                  setIndexOpen(true);
                  void api
                    .getKnowledgeIndexHealth()
                    .then(setIndexHealth)
                    .catch(() => undefined);
                }}
              >
                检索规则
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => startCreate("markdown")}
            >
              新建 Markdown
            </Button>
            <Button disabled={busy} onClick={() => startCreate("faq")}>
              新建 FAQ
            </Button>
          </div>
        }
      />

      <Modal
        open={retrieveOpen}
        title="试检索"
        description="用客户口吻提问，查看当前已发布知识会被命中哪些条目（不生成回复）。"
        onClose={() => setRetrieveOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRetrieveOpen(false)}>
              关闭
            </Button>
            <Button
              disabled={retrieveBusy || !retrieveQuery.trim()}
              onClick={() => void runRetrieve()}
            >
              {retrieveBusy ? "检索中…" : "开始检索"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="text-xs text-ink-soft">测试问题</span>
            <input
              value={retrieveQuery}
              onChange={(e) => setRetrieveQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runRetrieve();
                }
              }}
              placeholder="例如：马克杯起订量是多少？"
              className="w-full border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          {retrieveResult ? (
            <div className="space-y-3">
              <p className="text-xs text-ink-soft">
                模式{" "}
                {retrieveResult.mode === "vector"
                  ? "向量"
                  : retrieveResult.mode === "lexical"
                    ? "关键词"
                    : "无命中"}
                {" · "}
                已发布 {retrieveResult.index.readyDocuments} · 已索引{" "}
                {retrieveResult.index.indexedDocuments}
                {retrieveResult.index.missingDocuments.length
                  ? ` · 缺索引 ${retrieveResult.index.missingDocuments.length}`
                  : ""}
              </p>
              {retrieveResult.hits.length ? (
                <ul className="divide-y divide-line border border-line">
                  {retrieveResult.hits.map((hit) => (
                    <li key={`${hit.documentId}-${hit.score}`} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-ink">{hit.title}</p>
                        <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                          {hit.score.toFixed(2)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                        {hit.excerpt}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-soft">
                  没有足够依据的命中。可检查文档是否已发布，或管理员是否需补建索引。
                </p>
              )}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={indexOpen}
        title="检索索引规则"
        description="保存后对新发布或重新发布的文档生效。已发布文档需再点一次「发布」才会按新规则重建分段。"
        onClose={() => {
          setIndexSettings(indexBaseline);
          setIndexOpen(false);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={indexSaving || reindexing}
              onClick={() => {
                setIndexSettings(indexBaseline);
                setIndexOpen(false);
              }}
            >
              取消
            </Button>
            <Button
              disabled={
                indexSaving ||
                reindexing ||
                (indexSettings.chunkSize === indexBaseline.chunkSize &&
                  indexSettings.chunkOverlap === indexBaseline.chunkOverlap &&
                  indexSettings.maxChunksPerDoc ===
                    indexBaseline.maxChunksPerDoc)
              }
              onClick={async () => {
                setIndexSaving(true);
                try {
                  const saved = await api.updateKnowledgeIndexSettings(
                    indexSettings,
                  );
                  setIndexSettings(saved);
                  setIndexBaseline(saved);
                  setIndexOpen(false);
                  notify("索引规则已保存");
                } catch (err) {
                  notify(err instanceof Error ? err.message : "保存失败");
                } finally {
                  setIndexSaving(false);
                }
              }}
            >
              {indexSaving ? "保存中…" : "保存规则"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {indexHealth ? (
            <div className="border border-line bg-surface/40 px-3 py-3 text-sm">
              <p className="font-medium text-ink">索引健康</p>
              <p className="mt-1 text-xs text-ink-soft">
                Embedding：
                {indexHealth.embedding === "api"
                  ? `可用${indexHealth.embeddingModel ? `（${indexHealth.embeddingModel}）` : ""}`
                  : indexHealth.embedding === "hash"
                    ? "开发哈希回退"
                    : "不可用（将仅关键词检索）"}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                已发布 {indexHealth.readyDocuments} · 已索引{" "}
                {indexHealth.indexedDocuments}
                {indexHealth.missingDocuments.length
                  ? ` · 缺索引 ${indexHealth.missingDocuments.length}`
                  : ""}
              </p>
              {indexHealth.missingDocuments.length ? (
                <Button
                  variant="secondary"
                  className="mt-3"
                  disabled={reindexing}
                  onClick={() => void runReindexMissing()}
                >
                  {reindexing ? "补索引中…" : "补建缺失索引"}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs text-ink-soft">分段长度（字）</span>
              <input
                type="number"
                min={200}
                max={2000}
                value={indexSettings.chunkSize}
                onChange={(e) =>
                  setIndexSettings((prev) => ({
                    ...prev,
                    chunkSize: Number(e.target.value),
                  }))
                }
                className="w-full border border-line bg-paper px-3 py-2 outline-none focus:border-accent"
              />
              <span className="block text-[11px] text-ink-soft">200–2000，默认 480</span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs text-ink-soft">重叠长度（字）</span>
              <input
                type="number"
                min={0}
                max={Math.floor(indexSettings.chunkSize / 2)}
                value={indexSettings.chunkOverlap}
                onChange={(e) =>
                  setIndexSettings((prev) => ({
                    ...prev,
                    chunkOverlap: Number(e.target.value),
                  }))
                }
                className="w-full border border-line bg-paper px-3 py-2 outline-none focus:border-accent"
              />
              <span className="block text-[11px] text-ink-soft">
                0–分段一半，默认 80
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs text-ink-soft">单篇最多段数</span>
              <input
                type="number"
                min={5}
                max={200}
                value={indexSettings.maxChunksPerDoc}
                onChange={(e) =>
                  setIndexSettings((prev) => ({
                    ...prev,
                    maxChunksPerDoc: Number(e.target.value),
                  }))
                }
                className="w-full border border-line bg-paper px-3 py-2 outline-none focus:border-accent"
              />
              <span className="block text-[11px] text-ink-soft">5–200，默认 40</span>
            </label>
          </div>
          <p className="text-xs leading-relaxed text-ink-soft">
            仍会优先按 FAQ 问答与 Markdown 标题整段切开，过长段落再按上面的窗口滑动切分。向量模型跟随「AI
            模型」里的 Embeddings 配置。
          </p>
        </div>
      </Modal>

      <Modal
        open={rejectTargetId !== null}
        title="驳回知识"
        description="客服修改后可重新提交审批。原因会展示给提交人。"
        onClose={closeReject}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={rejecting}
              onClick={closeReject}
            >
              取消
            </Button>
            <Button
              variant="danger"
              disabled={rejecting}
              onClick={() => void confirmReject()}
            >
              {rejecting ? "驳回中…" : "确认驳回"}
            </Button>
          </>
        }
      >
        <label className="block space-y-1.5 text-sm">
          <span className="text-xs text-ink-soft">驳回原因（可选）</span>
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="例如：缺少起订量或交期说明"
            className="w-full resize-y border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
            disabled={rejecting}
          />
        </label>
      </Modal>

      <div
        className={`flex flex-col gap-3 border border-dashed px-4 py-4 transition sm:flex-row sm:items-center sm:justify-between ${
          dragOver ? "border-accent bg-accent/5" : "border-line bg-surface/50"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void uploadFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.markdown,.csv,.docx,.pdf,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void uploadFiles(event.target.files);
          }}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            {uploading
              ? admin
                ? "正在解析并保存草稿…"
                : "正在解析并提交审批…"
              : dragOver ? "松开鼠标即可导入文件" : "导入知识文档"}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            支持 txt、Markdown、CSV 问答、Word、PDF。一次最多 10 个，单个不超过 15 MB。扫描版 PDF 无法提取文字。
          </p>
        </div>
        <Button
          variant="secondary"
          className="shrink-0"
          disabled={uploading || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          选择文件
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-y border-line bg-paper py-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="搜索标题、摘要或正文"
            aria-label="搜索知识文档"
            className="min-h-10 w-full border border-line bg-surface px-3 py-2 pr-16 text-sm outline-none transition focus:border-accent"
          />
          {queryInput ? (
            <button
              type="button"
              onClick={() => setQueryInput("")}
              className="absolute inset-y-0 right-0 px-3 text-xs text-ink-soft hover:text-ink"
            >
              清除
            </button>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5">
          {sourceFilters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setSourceFilter(item.key)}
              className={`min-h-8 shrink-0 px-3 text-xs transition ${
                sourceFilter === item.key
                  ? "bg-ink text-paper"
                  : "border border-line bg-paper text-ink-soft hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <Button
          variant={showGaps ? "primary" : "secondary"}
          className="shrink-0"
          aria-pressed={showGaps}
          onClick={() => setShowGaps((value) => !value)}
        >
          知识缺口 <span className="tabular-nums">{openGapCount}</span>
        </Button>
      </div>

      {showGaps ? (
        <section className="border border-line bg-paper">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="text-sm font-medium text-ink">待补充知识</p>
            <span className="text-xs text-ink-soft">{openGapCount} 条待处理</span>
          </div>
          {activeGaps.length ? (
            <ul className="divide-y divide-line">
              {activeGaps.map((gap) => (
                <li
                  key={gap.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{gap.query}</p>
                    <p className="mt-1 text-xs text-ink-soft">
                      {gap.contactName} · 出现 {gap.occurrences} 次 · 最近{" "}
                      {new Date(gap.lastSeenAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      disabled={gapBusyId !== null}
                      onClick={() => void convertGap(gap.id)}
                    >
                      {gapBusyId === gap.id ? "处理中…" : "整理为 FAQ"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={gapBusyId !== null}
                      onClick={() => void ignoreGap(gap.id)}
                    >
                      忽略
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-ink-soft">暂无待补充问题</p>
          )}
        </section>
      ) : null}

      <section className="min-w-0 border border-line bg-paper">
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-surface/50">
        <div className="px-4 py-3">
          <p className="text-[11px] text-ink-soft">全部文档</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-ink">{docs.length}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] text-ink-soft">已发布</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-ink">{publishedCount}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] text-ink-soft">待审批</p>
          <p className="mt-1 font-display text-lg font-semibold tabular-nums text-ink">{pendingCount}</p>
        </div>
      </div>
      {listLoading ? (
        <div className="p-8">
          <EmptyState title="加载中" description="正在拉取知识文档…" />
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="知识状态"
            className="flex flex-nowrap gap-1 overflow-x-auto border-b border-line px-2 pt-1 sm:px-3"
          >
            {statusTabs.map((group) => {
              const active = activeStatusTab === group.key;
              return (
                <button
                  key={group.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setStatusTabTouched(true);
                    setStatusTab(group.key);
                  }}
                  className={`relative shrink-0 px-3 py-2.5 text-sm transition ${
                    active
                      ? "font-medium text-ink"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {group.label}
                  <span
                    className={`ml-1.5 text-xs ${
                      active ? "text-ink" : "text-ink-soft"
                    }`}
                  >
                    {group.items.length}
                  </span>
                  {active ? (
                    <span className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" />
                  ) : null}
                </button>
              );
            })}
            {otherDocs.length > 0 ? (
              <button
                type="button"
                role="tab"
                aria-selected={activeStatusTab === "other"}
                onClick={() => {
                  setStatusTabTouched(true);
                  setStatusTab("other");
                }}
                className={`relative px-3 py-2.5 text-sm transition ${
                  activeStatusTab === "other"
                    ? "font-medium text-ink"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                其他
                <span className="ml-1.5 text-xs text-ink-soft">
                  {otherDocs.length}
                </span>
                {activeStatusTab === "other" ? (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" />
                ) : null}
              </button>
            ) : null}
          </div>

          {activeStatusTab === "other" ? (
            <DocList
              docs={otherDocs}
              empty="没有其他状态的文章"
              busy={busy}
              admin={admin}
              onView={(id) => void openDoc(id, "view")}
              onEdit={(id) => void openDoc(id, "edit")}
              onDelete={(id) => void handleDelete(id)}
              onArchive={(id) => void archiveRow(id)}
              onPublish={(id) => void publishRow(id)}
              onReject={(id) => openReject(id)}
            />
          ) : activeGroup ? (
            <>
              <p className="border-b border-line px-4 py-2.5 text-xs text-ink-soft">
                {activeGroup.hint}
              </p>
              <DocList
                docs={activeGroup.items}
                empty={
                  filtered.length === 0
                    ? "没有匹配的文章，换一个关键词或类型后再看"
                    : activeGroup.key === "pending"
                      ? admin
                        ? "暂无待审批，客服提交后会出现在这里"
                        : "暂无待审批的提交"
                      : "这一栏还没有文章"
                }
                busy={busy}
                admin={admin}
                onView={(id) => void openDoc(id, "view")}
                onEdit={(id) => void openDoc(id, "edit")}
                onDelete={(id) => void handleDelete(id)}
                onArchive={(id) => void archiveRow(id)}
                onPublish={(id) => void publishRow(id)}
                onReject={(id) => openReject(id)}
              />
            </>
          ) : (
            <p className="px-4 py-6 text-sm text-ink-soft">暂无分组</p>
          )}
        </>
      )}
      </section>

      <Modal
        open={dialog !== null}
        wide
        title={creating ? "新建文章" : dialog === "view" ? "查看文章" : "修改文章"}
        titleExtra={
          <>
            {creating ? null : <StatusBadge kind="doc" value={status} />}
            {dialog === "edit" && dirty ? (
              <span className="text-xs text-warn">未保存</span>
            ) : null}
          </>
        }
        onClose={() => {
          if (rejectTargetId) {
            closeReject();
            return;
          }
          closeDialog();
        }}
        footerAlign="between"
        footer={
          <>
            <div className="flex flex-wrap gap-2">
              {dialog === "view" && selectedId ? (
                <Button
                  variant="secondary"
                  disabled={busy || (!admin && !AGENT_EDITABLE.has(status))}
                  onClick={() => setDialog("edit")}
                >
                  去修改
                </Button>
              ) : null}
              {canDeleteCurrent ? (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void handleDelete()}
                >
                  删除
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {dialog === "edit" ? (
                <Button
                  variant="secondary"
                  disabled={busy || !canEdit || !dirty || !title.trim() || !body.trim()}
                  onClick={() => void handleSave()}
                >
                  {saveLabel}
                </Button>
              ) : null}
              {admin && status === "pending" && selectedId && !creating ? (
                <Button
                  variant="secondary"
                  disabled={busy || rejecting}
                  onClick={() => openReject(selectedId)}
                >
                  驳回
                </Button>
              ) : null}
              {admin && (dialog === "edit" || selectedId) ? (
                <Button
                  disabled={busy || !title.trim() || !body.trim()}
                  onClick={() => void handlePublish()}
                >
                  {publishLabel}
                </Button>
              ) : null}
            </div>
          </>
        }
      >
        {detailLoading ? (
          <EmptyState title="打开中" description="正在加载正文…" />
        ) : dialog === "view" ? (
          <div className="space-y-4">
            <div>
              <p className="font-display text-2xl font-semibold text-ink">
                {title || "未命名"}
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {sourceType === "faq" ? "FAQ" : "Markdown"}
                {updatedAt ? ` · 更新 ${updatedAt}` : ""}
              </p>
            </div>
            {reviewNote ? <ReviewNoteBanner note={reviewNote} /> : null}
            <PreviewBody sourceType={sourceType} body={body} />
          </div>
        ) : (
          <div className="space-y-4">
            {reviewNote ? <ReviewNoteBanner note={reviewNote} /> : null}
            <input
              value={title}
              disabled={!canEdit || busy}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="文章标题"
              className="w-full border border-line bg-paper px-3 py-2 font-display text-xl text-ink outline-none focus:border-accent disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-2 text-xs text-ink-soft">文档类型</span>
              {(
                [
                  ["faq", "FAQ"],
                  ["markdown", "Markdown"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={!canEdit || busy}
                  onClick={() => setSourceType(value)}
                  className={`px-2.5 py-1 text-xs disabled:opacity-50 ${
                    sourceType === value
                      ? "bg-ink text-paper"
                      : "border border-line text-ink-soft"
                  }`}
                >
                  {label}
                </button>
              ))}
              {sourceType === "faq" && canEdit ? (
                <button
                  type="button"
                  className="text-xs text-accent"
                  disabled={busy}
                  onClick={insertFaqPair}
                >
                  + 插入问答
                </button>
              ) : null}
            </div>
            {!canEdit ? (
              <p className="text-xs text-warn">
                已发布或已下线的文章仅管理员可修改。
              </p>
            ) : null}
            <textarea
              value={body}
              disabled={!canEdit || busy}
              onChange={(e) => setBody(e.target.value)}
              spellCheck={false}
              className="min-h-[280px] w-full resize-y border border-line bg-paper px-3 py-3 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-accent disabled:opacity-60"
              placeholder={
                sourceType === "faq" ? "Q: 问题\nA: 答案" : "在此编写 Markdown…"
              }
            />
          </div>
        )}
      </Modal>

      {toast ? (
        <div className="fixed bottom-6 right-6 z-[70] border border-line bg-ink px-4 py-2.5 text-sm text-paper animate-rise">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function ReviewNoteBanner({ note }: { note: string }) {
  return (
    <div className="border border-danger/30 bg-danger-soft/40 px-3 py-2.5">
      <p className="text-xs font-medium text-danger">已驳回</p>
      <p className="mt-0.5 text-sm text-ink">原因：{note}</p>
    </div>
  );
}

function DocList({
  docs,
  empty,
  busy,
  admin,
  onView,
  onEdit,
  onDelete,
  onArchive,
  onPublish,
  onReject,
}: {
  docs: ApiKnowledgeDoc[];
  empty?: string;
  busy: boolean;
  admin: boolean;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onPublish: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const docsSignature = docs.map((doc) => doc.id).join(",");
  useEffect(() => {
    setPage(1);
  }, [docsSignature]);
  const pages = Math.max(1, Math.ceil(docs.length / DOC_PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = docs.slice(
    (current - 1) * DOC_PAGE_SIZE,
    current * DOC_PAGE_SIZE,
  );

  return (
    <>
      {docs.length === 0 ? (
        <p className="px-4 py-8 text-sm text-ink-soft">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              busy={busy}
              admin={admin}
              onView={() => onView(doc.id)}
              onEdit={() => onEdit(doc.id)}
              onDelete={() => onDelete(doc.id)}
              onArchive={() => onArchive(doc.id)}
              onPublish={() => onPublish(doc.id)}
              onReject={() => onReject(doc.id)}
            />
          ))}
        </ul>
      )}
      <Pager
        page={current}
        pageSize={DOC_PAGE_SIZE}
        total={docs.length}
        onPage={setPage}
      />
    </>
  );
}

function DocRow({
  doc,
  busy,
  admin,
  onView,
  onEdit,
  onDelete,
  onArchive,
  onPublish,
  onReject,
}: {
  doc: ApiKnowledgeDoc;
  busy: boolean;
  admin: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onPublish: () => void;
  onReject: () => void;
}) {
  const canMutate = admin || AGENT_EDITABLE.has(doc.status);
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {doc.title}
          </span>
          <StatusBadge kind="doc" value={doc.status} />
        </span>
        <span className="mt-1 block truncate text-xs text-ink-soft">
          {doc.sourceType === "faq" ? "FAQ" : "Markdown"} · v{doc.version ?? 1} · {doc.updatedAt}
          {doc.reviewNote ? ` · 驳回：${doc.reviewNote}` : ""}
          {!doc.reviewNote && doc.excerpt ? ` · ${doc.excerpt}` : ""}
        </span>
      </button>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          variant="secondary"
          className="px-2.5 py-1.5"
          disabled={busy || !canMutate}
          title={canMutate ? undefined : "仅管理员可修改"}
          onClick={onEdit}
        >
          修改
        </Button>
        {doc.status === "ready" && admin ? (
          <Button variant="ghost" className="px-2.5 py-1.5" disabled={busy} onClick={onArchive}>
            下线
          </Button>
        ) : null}
        {doc.status === "pending" && admin ? (
          <Button
            variant="secondary"
            className="px-2.5 py-1.5"
            disabled={busy}
            onClick={onReject}
          >
            驳回
          </Button>
        ) : null}
        {doc.status !== "ready" && admin ? (
          <Button className="px-2.5 py-1.5" disabled={busy} onClick={onPublish}>
            {doc.status === "archived"
              ? "重新发布"
              : doc.status === "pending"
                ? "批准"
                : "发布"}
          </Button>
        ) : null}
        {canMutate ? (
          <Button variant="danger" className="px-2.5 py-1.5" disabled={busy} onClick={onDelete}>
            删除
          </Button>
        ) : null}
      </div>
    </li>
  );
}
