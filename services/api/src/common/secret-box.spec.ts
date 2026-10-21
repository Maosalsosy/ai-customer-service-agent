import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './secret-box.js';

describe('secret-box', () => {
  it('round-trips plaintext', () => {
    const stored = encryptSecret('sk-test-secret-key');
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe('sk-test-secret-key');
    expect(stored).not.toContain('sk-test-secret-key');
  });

  it('leaves legacy plaintext readable', () => {
    expect(decryptSecret('sk-legacy-plain')).toBe('sk-legacy-plain');
    expect(isEncryptedSecret('sk-legacy-plain')).toBe(false);
  });

  it('does not double-encrypt', () => {
    const once = encryptSecret('sk-once');
    expect(encryptSecret(once)).toBe(once);
  });
});
