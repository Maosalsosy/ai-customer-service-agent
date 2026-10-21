import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles, RolesGuard } from '../auth/roles.js';
import { CurrentTenantId } from '../common/tenant.decorator.js';
import { AuditService } from './audit.service.js';

@Controller('api/v1/audit-logs')
@UseGuards(RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('admin')
  list(
    @CurrentTenantId() tenantId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('action') action?: string,
    @Query('actor') actor?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
  ) {
    return this.audit.list(tenantId, { page: Number(page), pageSize: Number(pageSize), action, actor, from, to, q });
  }
}
