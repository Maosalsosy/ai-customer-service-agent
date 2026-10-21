import { describe, expect, it } from 'vitest';
import { normalizeRole } from './roles.js';

describe('normalizeRole', () => {
  it('keeps admin aliases', () => {
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('管理员')).toBe('admin');
  });

  it('maps customer without collapsing to agent', () => {
    expect(normalizeRole('customer')).toBe('customer');
    expect(normalizeRole('客户')).toBe('customer');
  });

  it('defaults unknown roles to agent', () => {
    expect(normalizeRole('agent')).toBe('agent');
    expect(normalizeRole('客服')).toBe('agent');
  });
});
