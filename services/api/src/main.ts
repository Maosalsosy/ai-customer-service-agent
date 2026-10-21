import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/http-exception.filter.js';
import { assertProductionConfiguration } from './common/runtime-mode.js';
import { createRequestContext } from './common/request-context.js';

async function bootstrap() {
  assertProductionConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useBodyParser('text', { type: ['text/xml', 'application/xml'] });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const context = createRequestContext(typeof incoming === 'string' ? incoming : undefined);
    res.setHeader('X-Request-ID', context.id);
    const startedAt = Date.now();
    context.run(() => {
      res.on('finish', () => {
        console.log(JSON.stringify({
          event: 'http.request',
          requestId: context.id,
          tenantId: req.auth?.tenantId,
          method: req.method,
          path: (req.originalUrl ?? req.url).split('?')[0],
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        }));
      });
      next();
    });
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  const origins = [process.env.WEB_ORIGIN ?? ''].filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: ['X-Request-ID'],
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`AI客服 API listening on http://localhost:${port}`);
}

await bootstrap();
