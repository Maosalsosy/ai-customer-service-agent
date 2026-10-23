import type {
  ConversationStatus,
  DocStatus,
  WecomStatus,
} from "./types";

export const conversationStatusLabel: Record<ConversationStatus, string> = {
  open: "未处理",
  in_progress: "处理中",
  waiting_human: "待人工",
  closed: "已关闭",
};

export const docStatusLabel: Record<DocStatus, string> = {
  draft: "草稿",
  pending: "待审批",
  rejected: "已驳回",
  processing: "处理中",
  ready: "已发布",
  failed: "失败",
  archived: "已下线",
};

export const wecomStatusLabel: Record<WecomStatus, string> = {
  draft: "草稿",
  pending_auth: "待授权",
  connected: "已连接",
  error: "异常",
  disabled: "已停用",
};

