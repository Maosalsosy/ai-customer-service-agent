import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './auth/public.decorator.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RedisService } from './common/redis.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true, service: 'aikefu-api' };
  }

  @Public()
  @Get('ready')
  async readiness(@Res({ passthrough: true }) response: Response) {
    const database = (await this.prisma.ping()) ? 'up' : 'down';
    const redisRequired = process.env.NODE_ENV === 'production';
    const redisReady = this.redis.isReady();
    const redis = redisReady ? 'up' : redisRequired ? 'down' : 'optional';
    const ready = database === 'up' && (!redisRequired || redisReady);
    response.status(ready ? 200 : 503);

    const aiUrl = process.env.AI_SERVICE_URL?.replace(/\/$/, '');
    let ai: 'up' | 'down' | 'skipped' = 'skipped';
    if (aiUrl) {
      try {
        const res = await fetch(`${aiUrl}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        ai = res.ok ? 'up' : 'down';
      } catch {
        ai = 'down';
      }
    }

    return {
      ok: ready,
      service: 'aikefu-api',
      database,
      redis,
      ai,
    };
  }
}
