import { describe, expect, it } from 'vitest';
import {
  signAuthToken,
  signStreamTicket,
  verifyAuthToken,
  verifyStreamTicket,
} from './token.js';

const user = {
  sub: 'u1',
  tenantId: 't1',
  email: 'a@b.c',
  displayName: 'A',
  role: 'agent',
};

describe('stream ticket', () => {
  it('accepts a short-lived sse ticket and rejects it as an API token', () => {
    const ticket = signStreamTicket(user);
    expect(verifyStreamTicket(ticket)?.tenantId).toBe('t1');
    expect(verifyAuthToken(ticket)).toBeNull();
  });

  it('rejects a login token as an sse ticket', () => {
    const access = signAuthToken(user);
    expect(verifyAuthToken(access)?.sub).toBe('u1');
    expect(verifyStreamTicket(access)).toBeNull();
  });
});
