import { describe, expect, it } from 'vitest';
import { latestInteractionBeforePreparedReply } from './wecom-dispatch.service.js';

describe('latestInteractionBeforePreparedReply', () => {
  it('ignores the queued reply being checked', () => {
    const latest = latestInteractionBeforePreparedReply(
      [
        { id: 'customer-1', sender: 'customer' },
        { id: 'reply-1', sender: 'agent' },
      ],
      'reply-1',
    );

    expect(latest).toEqual({ id: 'customer-1', sender: 'customer' });
  });

  it('keeps a newer manual reply as the latest interaction', () => {
    const latest = latestInteractionBeforePreparedReply(
      [
        { id: 'customer-1', sender: 'customer' },
        { id: 'reply-1', sender: 'agent' },
        { id: 'manual-reply', sender: 'agent' },
      ],
      'reply-1',
    );

    expect(latest).toEqual({ id: 'manual-reply', sender: 'agent' });
  });
});
