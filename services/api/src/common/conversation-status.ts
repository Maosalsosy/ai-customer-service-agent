import type { ConversationStatus } from '../store/types.js';

/** 客户明确要求人工时的关键词（子串匹配）。 */
const HUMAN_REQUEST_KEYWORDS = [
  '转人工',
  '找人工',
  '真人客服',
  '人工客服',
  '找客服',
];

export function requestsHuman(text: string): boolean {
  const source = text.trim();
  if (!source) return false;
  return HUMAN_REQUEST_KEYWORDS.some((k) => source.includes(k));
}

/** 客户入站后的会话状态。 */
export function statusAfterCustomerInbound(
  current: ConversationStatus,
  opts: { requestHuman: boolean },
): ConversationStatus {
  if (opts.requestHuman) return 'waiting_human';
  if (current === 'closed') return 'open';
  // waiting_human / in_progress / open 保持，避免冲掉「待人工」队列
  return current;
}

/** 坐席成功回复后的会话状态。 */
export function statusAfterAgentReply(
  current: ConversationStatus,
): ConversationStatus {
  if (
    current === 'closed' ||
    current === 'open' ||
    current === 'waiting_human'
  ) {
    return 'in_progress';
  }
  return current;
}

/** AI / 策略判定需人工时的会话状态。 */
export function statusAfterNeedsHuman(): ConversationStatus {
  return 'waiting_human';
}
