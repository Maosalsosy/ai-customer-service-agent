import { requestsHuman } from './conversation-status.js';

/** 敏感业务动作：业务侧先于 AI 判定，命中则强制转人工。 */
export const SENSITIVE_KEYWORDS = [
  '退款',
  '赔偿',
  '改价',
  '取消订单',
  '律师',
  '投诉',
  '违约金',
  '合同条款',
  '框架协议',
  '色差赔偿',
  '月结',
] as const;

export type PolicyDecision = {
  needsHuman: boolean;
  reason?: string;
  flags: string[];
};

export function findSensitiveKeywords(text: string): string[] {
  const source = text.trim();
  if (!source) return [];
  return SENSITIVE_KEYWORDS.filter((k) => source.includes(k));
}

/** 合并多段文本做策略扫描（客户最新句 + 近期客户句）。 */
export function evaluateReplyPolicy(texts: string[]): PolicyDecision {
  const joined = texts.map((t) => t.trim()).filter(Boolean).join('\n');
  if (!joined) {
    return { needsHuman: true, reason: 'empty_customer_message', flags: ['empty_input'] };
  }

  if (requestsHuman(joined)) {
    return {
      needsHuman: true,
      reason: '客户要求人工',
      flags: ['request_human'],
    };
  }

  const sensitive = findSensitiveKeywords(joined);
  if (sensitive.length) {
    return {
      needsHuman: true,
      reason: 'policy_sensitive_business_action',
      flags: sensitive,
    };
  }

  return { needsHuman: false, flags: [] };
}

const CHITCHAT_EXACT = new Set([
  '你好',
  '您好',
  '在吗',
  '在嘛',
  '嗨',
  'hi',
  'hello',
  '早上好',
  '下午好',
  '晚上好',
  '谢谢',
  '谢谢你',
  '谢谢您',
  '感谢',
  '多谢',
  '好的',
  '好的谢谢',
  '收到',
  '嗯',
  'ok',
]);

/** 寒暄/致谢：无知识命中时允许短回复，不必一律转人工。 */
export function isChitchatMessage(text: string): boolean {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[！!。.?？~～]+$/g, '');
  if (!normalized) return false;
  if (CHITCHAT_EXACT.has(normalized)) return true;
  if (
    normalized.length <= 8 &&
    ['你好', '您好', '谢谢', '感谢', '好的'].some((p) => normalized.startsWith(p))
  ) {
    return true;
  }
  return false;
}

export function chitchatReply(text: string): string {
  const t = text.trim();
  if (/^(你好|您好|在吗|在嘛|嗨|hi|hello)/i.test(t)) {
    return '您好，我是客服助手，请问有什么可以帮您？';
  }
  return '好的，有需要随时告诉我。';
}
