import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  type MessageEvent,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Observable } from 'rxjs';
import { RedisService } from '../common/redis.service.js';

export type RealtimeEvent =
  | { type: 'ping' }
  | {
      type: 'draft.updated';
      conversationId: string;
      draftId: string;
    }
  | {
      type: 'conversation.updated';
      conversationId: string;
    }
  | {
      type: 'message.created';
      conversationId: string;
      messageId: string;
    };

const CHANNEL = 'aikefu:realtime';

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly bus = new EventEmitter();
  private readonly instanceId = randomUUID();

  constructor(private readonly redis: RedisService) {
    this.bus.setMaxListeners(200);
  }

  async onModuleInit() {
    const sub = this.redis.getSubscriber();
    if (!sub) return;
    try {
      await sub.subscribe(CHANNEL);
      sub.on('message', (channel: string, raw: string) => {
        if (channel !== CHANNEL) return;
        try {
          const payload = JSON.parse(raw) as {
            instanceId?: string;
            tenantId?: string;
            event?: Exclude<RealtimeEvent, { type: 'ping' }>;
          };
          if (!payload.tenantId || !payload.event) return;
          if (payload.instanceId === this.instanceId) return;
          this.bus.emit(payload.tenantId, payload.event);
        } catch {
          /* ignore bad payloads */
        }
      });
      this.logger.log('Realtime Redis pub/sub ready');
    } catch (error) {
      this.logger.warn(
        `Realtime Redis subscribe failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  async onModuleDestroy() {
    const sub = this.redis.getSubscriber();
    if (!sub) return;
    try {
      await sub.unsubscribe(CHANNEL);
    } catch {
      /* ignore */
    }
  }

  publish(tenantId: string, event: Exclude<RealtimeEvent, { type: 'ping' }>) {
    this.bus.emit(tenantId, event);
    const client = this.redis.getClient();
    if (!client) return;
    void client
      .publish(
        CHANNEL,
        JSON.stringify({
          instanceId: this.instanceId,
          tenantId,
          event,
        }),
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `Realtime publish failed: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      });
  }

  subscribe(tenantId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const handler = (event: RealtimeEvent) => {
        subscriber.next({ data: event } as MessageEvent);
      };
      this.bus.on(tenantId, handler);
      subscriber.next({ data: { type: 'ping' } } as MessageEvent);

      const heartbeat = setInterval(() => {
        subscriber.next({ data: { type: 'ping' } } as MessageEvent);
      }, 25_000);

      return () => {
        clearInterval(heartbeat);
        this.bus.off(tenantId, handler);
      };
    });
  }
}
