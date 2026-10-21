import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

type RedisClient = InstanceType<typeof Redis>;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClient | null = null;
  private subscriber: RedisClient | null = null;

  enabled(): boolean {
    return Boolean(process.env.REDIS_URL?.trim());
  }

  async onModuleInit() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return;
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      this.client.on('close', () => this.logger.warn('Redis connection closed'));
      this.client.on('ready', () => this.logger.log('Redis connection ready'));
      await this.client.connect();
      this.subscriber = this.client.duplicate();
      this.subscriber.on('close', () => this.logger.warn('Redis subscriber connection closed'));
      this.subscriber.on('ready', () => this.logger.log('Redis subscriber connection ready'));
      await this.subscriber.connect();
      this.logger.log('Redis connected');
    } catch (error) {
      this.logger.warn(
        `Redis unavailable, fallback to memory: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      await this.shutdown();
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Redis is required in production; refusing process-local fallback');
      }
    }
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  getClient(): RedisClient | null {
    return this.client?.status === 'ready' ? this.client : null;
  }

  getSubscriber(): RedisClient | null {
    return this.subscriber?.status === 'ready' ? this.subscriber : null;
  }

  isReady(): boolean {
    return this.getClient() !== null && this.getSubscriber() !== null;
  }

  private async shutdown() {
    const close = async (conn: RedisClient | null) => {
      if (!conn) return;
      try {
        conn.disconnect();
      } catch {
        /* ignore */
      }
    };
    await close(this.subscriber);
    await close(this.client);
    this.subscriber = null;
    this.client = null;
  }
}
