import { describe, expect, it } from 'vitest';
import {
  requestsHuman,
  statusAfterAgentReply,
  statusAfterCustomerInbound,
  statusAfterNeedsHuman,
} from './conversation-status.js';

describe('conversation-status', () => {
  it('detects human request keywords', () => {
    expect(requestsHuman('请转人工')).toBe(true);
    expect(requestsHuman('我想找客服')).toBe(true);
    expect(requestsHuman('物流到哪了')).toBe(false);
  });

  it('keeps waiting_human on customer inbound unless requesting human', () => {
    expect(
      statusAfterCustomerInbound('waiting_human', { requestHuman: false }),
    ).toBe('waiting_human');
    expect(
      statusAfterCustomerInbound('in_progress', { requestHuman: true }),
    ).toBe('waiting_human');
    expect(statusAfterCustomerInbound('closed', { requestHuman: false })).toBe(
      'open',
    );
  });

  it('moves to in_progress after agent reply', () => {
    expect(statusAfterAgentReply('waiting_human')).toBe('in_progress');
    expect(statusAfterAgentReply('open')).toBe('in_progress');
    expect(statusAfterAgentReply('in_progress')).toBe('in_progress');
  });

  it('needs human maps to waiting_human', () => {
    expect(statusAfterNeedsHuman()).toBe('waiting_human');
  });
});
