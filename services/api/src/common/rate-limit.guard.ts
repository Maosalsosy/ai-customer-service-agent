import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  SetMetadata,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import '../auth/auth.types.js';
import { RedisService } from './redis.service.js';

export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs });

type Bucket = { count: number; resetAt: number };

const INCREMENT_WITH_TTL = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly buckets = new Map<string, Bucket>();
  private warnedRedisFallback = false;

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const cfg = this.reflector.getAllAndOverride<{
      limit: number;
      windowMs: number;
    }>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!cfg) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const authUserId = req.auth?.user?.id;
    // Express only trusts forwarding headers when proxy trust is configured.
    // Reading the raw header here lets clients rotate it to evade throttling.
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const actor = authUserId ? `user:${authUserId}` : `ip:${ip}`;
    const key = `${context.getClass().name}:${context.getHandler().name}:${actor}`;

    const redis = this.redis.getClient();
    if (redis) {
      try {
        const redisKey = `aikefu:rl:${key}`;
        const count = Number(
          await redis.eval(INCREMENT_WITH_TTL, 1, redisKey, cfg.windowMs),
        );
        this.warnedRedisFallback = false;
        if (count > cfg.limit) throwRateLimited();
        return true;
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (process.env.NODE_ENV === 'production') {
          throw new ServiceUnavailableException('共享限流服务暂不可用，请稍后重试');
        }
        if (!this.warnedRedisFallback) {
          this.warnedRedisFallback = true;
          // Local fallback preserves a per-process limit while Redis recovers.
          this.logger.warn(
            'Redis rate limit unavailable; using process-local limits',
          );
        }
      }
    }

    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('共享限流服务暂不可用，请稍后重试');
    }

    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (this.buckets.size >= 1_000) {
        for (const [bucketKey, entry] of this.buckets) {
          if (entry.resetAt <= now) this.buckets.delete(bucketKey);
        }
        if (this.buckets.size >= 10_000) {
          const oldestKey = this.buckets.keys().next().value;
          if (oldestKey) this.buckets.delete(oldestKey);
        }
      }
      this.buckets.set(key, { count: 1, resetAt: now + cfg.windowMs });
      return true;
    }
    bucket.count += 1;
    if (bucket.count > cfg.limit) {
      throwRateLimited();
    }
    return true;
  }
}

function throwRateLimited(): never {
  throw new HttpException(
    {
      error: {
        code: 'RATE_LIMITED',
        message: '请求过于频繁，请稍后再试',
      },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
