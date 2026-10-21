import { describe, expect, it } from 'vitest';
import { evaluateReplyPolicy, findSensitiveKeywords } from './reply-policy.js';

describe('reply-policy', () => {
  it('flags sensitive business keywords', () => {
    expect(findSensitiveKeywords('我想申请退款')).toContain('退款');
    const decision = evaluateReplyPolicy(['订单要改价可以吗']);
    expect(decision.needsHuman).toBe(true);
    expect(decision.reason).toBe('policy_sensitive_business_action');
  });

  it('flags explicit human request', () => {
    const decision = evaluateReplyPolicy(['请转人工']);
    expect(decision.needsHuman).toBe(true);
    expect(decision.flags).toContain('request_human');
  });

  it('allows normal questions', () => {
    const decision = evaluateReplyPolicy(['200 个杯子能不能印单色 logo']);
    expect(decision.needsHuman).toBe(false);
  });

  it('flags contract liability keywords for gift sales', () => {
    const decision = evaluateReplyPolicy(['报价能不能写进合同？违约金怎么定？']);
    expect(decision.needsHuman).toBe(true);
    expect(decision.flags).toContain('违约金');
  });

  it('scans across multiple turns', () => {
    const decision = evaluateReplyPolicy(['刚才那个问题', '还是要退款']);
    expect(decision.needsHuman).toBe(true);
  });
});
