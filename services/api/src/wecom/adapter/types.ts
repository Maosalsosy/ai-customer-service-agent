export type WecomChannelType = 'wecom' | 'wecom_mock' | 'wechat_kf';

export type WecomCapability = string;

export type NormalizedIncomingMessage = {
  tenantId: string;
  connectionId: string;
  channelType: WecomChannelType;
  capability: WecomCapability;
  externalConversationId: string;
  externalMessageId: string;
  contactName: string;
  contactMeta?: string;
  senderType: 'customer' | 'agent' | 'system';
  content: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
  allowAutoDraft?: boolean;
};

export type NormalizedEventBatch = {
  messages: NormalizedIncomingMessage[];
  checkpoint?: { syncCursor: string };
};

export type CallbackInput = {
  connectionId: string;
  method: 'GET' | 'POST';
  query: Record<string, string | undefined>;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
};

export type UrlVerifyResult = {
  ok: boolean;
  echo?: string;
  message?: string;
};

export type SendReplyInput = {
  tenantId: string;
  connectionId: string;
  conversationId: string;
  externalConversationId?: string;
  content: string;
  idempotencyKey: string;
};

export type SendReplyResult = {
  status: 'sent' | 'failed' | 'queued' | 'unknown';
  simulated: boolean;
  externalMessageId?: string;
  errorMessage?: string;
};

export type ConnectionSnapshot = {
  id: string;
  tenantId: string;
  channelType: WecomChannelType;
  capability: WecomCapability;
  status: string;
  displayName: string;
  corpId?: string | null;
  agentId?: string | null;
  knowledgeBaseId?: string | null;
  knowledgeBaseIds?: string[];
  externalAccountId?: string | null;
  config?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

export interface WeComAdapter {
  verifyUrl(input: CallbackInput, connection: ConnectionSnapshot): Promise<UrlVerifyResult>;
  verifyCallback(input: CallbackInput, connection: ConnectionSnapshot): Promise<boolean>;
  normalizeEvent(
    input: CallbackInput,
    connection: ConnectionSnapshot,
  ): Promise<NormalizedEventBatch>;
  sendReply(
    input: SendReplyInput,
    connection: ConnectionSnapshot,
  ): Promise<SendReplyResult>;
}
