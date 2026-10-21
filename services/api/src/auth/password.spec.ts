import { describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, DEMO_PASSWORD_HASH } from '../store/seed.js';
import { hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('verifies demo seed hash', () => {
    expect(verifyPassword(DEMO_PASSWORD, DEMO_PASSWORD_HASH)).toBe(true);
    expect(verifyPassword('wrong', DEMO_PASSWORD_HASH)).toBe(false);
  });

  it('round-trips hashPassword', () => {
    const stored = hashPassword('secret-one');
    expect(verifyPassword('secret-one', stored)).toBe(true);
    expect(verifyPassword('secret-two', stored)).toBe(false);
  });
});
