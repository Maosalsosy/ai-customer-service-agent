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
