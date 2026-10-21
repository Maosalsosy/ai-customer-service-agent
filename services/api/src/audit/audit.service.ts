import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { APP_STORE, type AppStore, type AuditLogQuery } from '../store/app-store.js';

export type AuditInput = {
  tenantId: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(APP_STORE) private readonly appStore: AppStore) {}

  record(input: AuditInput) {
    void this.write(input).catch((error: unknown) => {
      this.logger.warn(
        `audit write failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
  }

  async list(tenantId: string, query: Partial<AuditLogQuery> = {}) {
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const pageSize = Math.min(Math.max(Math.floor(Number(query.pageSize) || 20), 1), 100);
    for (const value of [query.from, query.to]) {
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('日期格式无效');
      }
      if (value) {
        const [year, month, day] = value.split('-').map(Number);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (
          parsed.getUTCFullYear() !== year ||
          parsed.getUTCMonth() !== month - 1 ||
          parsed.getUTCDate() !== day
        ) {
          throw new BadRequestException('日期无效');
        }
      }
    }
    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('开始日期不能晚于结束日期');
    }
    return this.appStore.listAuditLogs(tenantId, {
      page,
      pageSize,
      action: query.action?.trim() || undefined,
      actor: query.actor?.trim() || undefined,
      from: query.from,
      to: query.to,
      q: query.q?.trim() || undefined,
    });
  }

  private async write(input: AuditInput) {
    await this.appStore.createAuditLog({
      id: this.appStore.newId('audit'),
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      detail: input.detail ?? {},
      createdAt: new Date().toISOString(),
    });
  }
}
