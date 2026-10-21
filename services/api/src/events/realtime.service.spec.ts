import { describe, expect, it } from 'vitest';
import { RedisService } from '../common/redis.service.js';
import { RealtimeService } from './realtime.service.js';

describe('RealtimeService', () => {
  it('delivers tenant-scoped events', async () => {
    const redis = {
      getClient: () => null,
      getSubscriber: () => null,
    } as unknown as RedisService;
    const realtime = new RealtimeService(redis);
    const received: unknown[] = [];
    const sub = realtime.subscribe('tenant-a').subscribe((ev) => {
      received.push(ev.data);
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(received[0]).toMatchObject({ type: 'ping' });

    realtime.publish('tenant-a', {
      type: 'draft.updated',
      conversationId: 'c1',
      draftId: 'd1',
    });
    realtime.publish('tenant-b', {
      type: 'draft.updated',
      conversationId: 'c2',
      draftId: 'd2',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(
      received.some(
        (row) =>
          (row as { type?: string; conversationId?: string }).type ===
            'draft.updated' &&
          (row as { conversationId?: string }).conversationId === 'c1',
      ),
    ).toBe(true);
    expect(
      received.some(
        (row) =>
          (row as { conversationId?: string }).conversationId === 'c2',
      ),
    ).toBe(false);

    sub.unsubscribe();
  });
});
