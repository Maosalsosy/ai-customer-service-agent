import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { decryptSecret } from '../../common/secret-box.js';
import {
  decryptWecomMessage,
  extractEncryptPayload,
  parseXmlTag,
  wecomSignature,
} from './crypto.js';
import type {
  CallbackInput,
  ConnectionSnapshot,
  NormalizedIncomingMessage,
  NormalizedEventBatch,
  SendReplyInput,
  SendReplyResult,
  UrlVerifyResult,
  WeComAdapter,
} from './types.js';

type KfAccount = { open_kfid: string; name: string; avatar?: string };
type WecomApiResult = { errcode?: number; errmsg?: string };

class WecomApiError extends Error {}
class WecomHttpError extends Error {
  constructor(readonly status: number) {
    super(`企业微信接口 HTTP ${status}`);
  }
}

const API = 'https://qyapi.weixin.qq.com/cgi-bin';
const TOKEN_REFRESH_MS = 120_000;
const MAX_SYNC_PAGES = 10;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function secret(config: Record<string, unknown> | null | undefined, key: string) {
  const value = config?.[key];
  if (typeof value !== 'string' || !value.trim()) return '';
  return decryptSecret(value);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function eventXml(input: CallbackInput, connection: ConnectionSnapshot) {
  const encrypted = extractEncryptPayload(input.rawBody ?? '');
  if (!encrypted) throw new Error('微信客服回调缺少 Encrypt 字段');
  const encodingAesKey = secret(connection.config, 'encodingAesKey');
  if (!connection.corpId || !encodingAesKey) throw new Error('微信客服回调密钥未配置');
  return decryptWecomMessage(encrypted, encodingAesKey, connection.corpId);
}

@Injectable()
export class WeChatKfAdapter implements WeComAdapter {
  private readonly accessTokens = new Map<string, { value: string; expiresAt: number }>();

  async listAccounts(corpId: string, appSecret: string): Promise<KfAccount[]> {
    const accessToken = await this.getAccessToken(corpId, appSecret);
    const accounts: KfAccount[] = [];
    let offset = 0;
    const limit = 1000;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.postJson<WecomApiResult & {
        account_list?: KfAccount[];
        next_cursor?: string;
      }>(`kf/account/list?access_token=${encodeURIComponent(accessToken)}`, {
        offset,
        limit,
      });
      this.assertApiSuccess(result, '获取微信客服账号失败');
      const rows = Array.isArray(result.account_list) ? result.account_list : [];
      accounts.push(...rows.filter((item) => item.open_kfid && item.name));
      if (rows.length < limit) break;
      offset += rows.length;
    }
    return accounts;
  }

  async verifyUrl(input: CallbackInput, connection: ConnectionSnapshot): Promise<UrlVerifyResult> {
    try {
      const token = secret(connection.config, 'callbackToken');
      const encodingAesKey = secret(connection.config, 'encodingAesKey');
      const encrypted = input.query.echostr;
      if (!token || !encodingAesKey || !connection.corpId || !encrypted) {
        return { ok: false, message: '微信客服回调 Token、EncodingAESKey 或 echostr 缺失' };
      }
      const signature = wecomSignature(token, input.query.timestamp ?? '', input.query.nonce ?? '', encrypted);
      if (!safeEqual(signature, input.query.msg_signature ?? input.query.msgsignature ?? '')) {
        return { ok: false, message: '微信客服回调签名不匹配' };
      }
      const echo = decryptWecomMessage(encrypted, encodingAesKey, connection.corpId);
      return { ok: true, echo };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '微信客服回调验证失败' };
    }
  }

  async verifyCallback(input: CallbackInput, connection: ConnectionSnapshot): Promise<boolean> {
    try {
      const token = secret(connection.config, 'callbackToken');
      const encrypted = extractEncryptPayload(input.rawBody ?? '');
      if (!token || !encrypted) return false;
      const signature = wecomSignature(token, input.query.timestamp ?? '', input.query.nonce ?? '', encrypted);
      const valid = safeEqual(signature, input.query.msg_signature ?? input.query.msgsignature ?? '');
      if (!valid) return false;
      eventXml(input, connection);
      return true;
    } catch {
      return false;
    }
  }

  eventOpenKfId(input: CallbackInput, callbackConnection: ConnectionSnapshot): string | null {
    const xml = eventXml(input, callbackConnection);
    if (parseXmlTag(xml, 'Event') !== 'kf_msg_or_event') return null;
    const openKfId = parseXmlTag(xml, 'OpenKfId') ?? '';
    if (!openKfId) throw new Error('微信客服回调缺少 OpenKfId');
    return openKfId;
  }

  async normalizeEvent(
    input: CallbackInput,
    connection: ConnectionSnapshot,
    callbackConnection: ConnectionSnapshot = connection,
  ): Promise<NormalizedEventBatch> {
    const xml = eventXml(input, callbackConnection);
    if (parseXmlTag(xml, 'Event') !== 'kf_msg_or_event') return { messages: [] };

    const callbackToken = parseXmlTag(xml, 'Token') ?? '';
    const openKfId = parseXmlTag(xml, 'OpenKfId') ?? '';
    if (!openKfId) throw new Error('微信客服回调缺少 OpenKfId');
    if (openKfId !== connection.externalAccountId) {
      throw new Error('微信客服回调账号与当前连接不匹配');
    }
    const existingCursor = typeof connection.config?.syncCursor === 'string'
      ? connection.config.syncCursor
      : '';
    const appSecret = secret(connection.config, 'appSecret');
    const accessToken = await this.getAccessToken(connection.corpId ?? '', appSecret);
    const messages: NormalizedEventBatch['messages'] = [];
    let cursor = existingCursor;
    let nextCursor = cursor;

    for (let page = 0; page < MAX_SYNC_PAGES; page += 1) {
      const result = await this.postJson<WecomApiResult & {
        has_more?: number | boolean;
        next_cursor?: string;
        msg_list?: unknown[];
      }>(`kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`, {
        open_kfid: openKfId,
        cursor,
        token: callbackToken,
        limit: 1000,
        voice_format: 0,
      });
      this.assertApiSuccess(result, '同步微信客服消息失败');
      for (const row of result.msg_list ?? []) {
        const normalized = this.normalizeMessage(row, connection);
        if (normalized) messages.push(normalized);
      }
      nextCursor = typeof result.next_cursor === 'string' ? result.next_cursor : cursor;
      if (!result.has_more || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    return {
      messages,
      checkpoint: nextCursor !== existingCursor ? { syncCursor: nextCursor } : undefined,
    };
  }

  async sendReply(input: SendReplyInput, connection: ConnectionSnapshot): Promise<SendReplyResult> {
    const externalUserId = input.externalConversationId;
    const openKfId = connection.externalAccountId;
    if (!externalUserId || !openKfId) {
      return {
        status: 'failed',
        simulated: false,
        errorMessage: '会话缺少微信客户 ID 或客服账号 ID',
      };
    }
    let requestStarted = false;
    try {
      const appSecret = secret(connection.config, 'appSecret');
      const accessToken = await this.getAccessToken(connection.corpId ?? '', appSecret);
      requestStarted = true;
      const result = await this.postJson<WecomApiResult & { msgid?: string }>(
        `kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
        {
          touser: externalUserId,
          open_kfid: openKfId,
          msgid: input.idempotencyKey,
          msgtype: 'text',
          text: { content: input.content },
        },
      );
      this.assertApiSuccess(result, '微信客服消息发送失败');
      return {
        status: 'sent',
        simulated: false,
        externalMessageId: result.msgid ?? input.idempotencyKey,
      };
    } catch (error) {
      const uncertain = requestStarted && !(error instanceof WecomApiError) && !(error instanceof WecomHttpError && error.status < 500);
      return {
        status: uncertain ? 'unknown' : 'failed',
        simulated: false,
        errorMessage: uncertain
          ? '发送结果未知，请先在微信客服后台核对，避免重复发送'
          : error instanceof Error ? error.message : '微信客服消息发送失败',
      };
    }
  }

  private normalizeMessage(value: unknown, connection: ConnectionSnapshot): NormalizedIncomingMessage | null {
    if (!isRecord(value)) return null;
    const origin = Number(value.origin);
    const senderType: NormalizedIncomingMessage['senderType'] = origin === 3 ? 'customer' : origin === 5 ? 'agent' : 'system';
    const msgType = typeof value.msgtype === 'string' ? value.msgtype : '';
    if (value.open_kfid !== connection.externalAccountId) return null;
    const externalUserId = typeof value.external_userid === 'string' ? value.external_userid : '';
    const messageId = typeof value.msgid === 'string' ? value.msgid : '';
    if (!externalUserId || !messageId) return null;

    let content = '';
    if (msgType === 'text' && isRecord(value.text) && typeof value.text.content === 'string') {
      content = value.text.content.trim();
    } else {
      const label: Record<string, string> = {
        image: '图片', voice: '语音', video: '视频', file: '文件', location: '位置',
        link: '链接', miniprogram: '小程序', msgmenu: '菜单', event: '事件',
      };
      content = `[${label[msgType] ?? '非文本'}消息，无法自动处理]`;
    }

    const rawTime = Number(value.send_time);
    const occurredAt = Number.isFinite(rawTime)
      ? new Date(rawTime < 1_000_000_000_000 ? rawTime * 1000 : rawTime).toISOString()
      : new Date().toISOString();
    return {
      tenantId: connection.tenantId,
      connectionId: connection.id,
      channelType: 'wechat_kf' as const,
      capability: connection.capability,
      externalConversationId: externalUserId,
      externalMessageId: messageId,
      contactName: externalUserId,
      contactMeta: `微信客服 · ${connection.displayName}`,
      senderType,
      content,
      occurredAt,
      metadata: { source: 'wechat_kf_sync', origin, msgType },
      allowAutoDraft: senderType === 'customer' && msgType === 'text' && Boolean(content),
    };
  }

  private async getAccessToken(corpId: string, appSecret: string) {
    if (!corpId || !appSecret) throw new Error('请配置企业 ID 与微信客服应用 Secret');
    const cacheKey = createHash('sha256').update(`${corpId}:${appSecret}`).digest('hex');
    const cached = this.accessTokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_MS) return cached.value;
    const url = new URL(`${API}/gettoken`);
    url.searchParams.set('corpid', corpId);
    url.searchParams.set('corpsecret', appSecret);
    const result = await this.getJson<WecomApiResult & { access_token?: string; expires_in?: number }>(url);
    this.assertApiSuccess(result, '获取企业微信 access_token 失败');
    if (!result.access_token) throw new Error('企业微信未返回 access_token');
    this.accessTokens.set(cacheKey, {
      value: result.access_token,
      expiresAt: Date.now() + Math.max(60, result.expires_in ?? 7200) * 1000,
    });
    return result.access_token;
  }

  private async getJson<T>(url: URL): Promise<T> {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new WecomHttpError(response.status);
    return await response.json() as T;
  }

  private async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new WecomHttpError(response.status);
    return await response.json() as T;
  }

  private assertApiSuccess(result: WecomApiResult, fallback: string) {
    if (result.errcode !== undefined && result.errcode !== 0) {
      throw new WecomApiError(`${fallback}（${result.errcode}：${result.errmsg ?? '未知错误'}）`);
    }
  }
}
