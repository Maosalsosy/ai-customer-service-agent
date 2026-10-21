export type ConversationStatus =
  | "open"
  | "in_progress"
  | "waiting_human"
  | "closed";

export type MessageSender = "customer" | "agent" | "system";

export type DocStatus =
  | "draft"
  | "pending"
  | "rejected"
  | "processing"
  | "ready"
  | "failed"
  | "archived";

export type WecomStatus =
  | "draft"
  | "pending_auth"
  | "connected"
  | "error"
  | "disabled";

export interface Conversation {
  id: string;
  /** 企业微信联系人显示名，列表主标题 */
  contactName: string;
  /** 企业/部门等附属信息，可选 */
  contactMeta?: string;
  preview: string;
  status: ConversationStatus;
  handlingMode: "ai" | "human";
  assignee: string | null;
  updatedAt: string;
  unread: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: MessageSender;
  content: string;
  createdAt: string;
}

export interface ReplyDraft {
  id: string;
  conversationId: string;
  content: string;
  status: "pending" | "needs_human";
  reason?: string;
  citations: { documentTitle: string; quote: string }[];
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  sourceType: "faq" | "markdown";
  status: DocStatus;
  updatedAt: string;
  excerpt: string;
}

export interface WecomConnection {
  id: string;
  displayName: string;
  channelType: "wecom" | "wecom_mock" | "wechat_kf";
  capability: string;
  status: WecomStatus;
  lastEventAt: string | null;
  errorMessage?: string;
}
