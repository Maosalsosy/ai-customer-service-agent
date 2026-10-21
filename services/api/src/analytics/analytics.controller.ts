import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles, RolesGuard } from '../auth/roles.js';
import { CurrentTenantId } from '../common/tenant.decorator.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('api/v1/analytics')
@UseGuards(RolesGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('support')
  @Roles('admin', 'agent')
  support(
    @CurrentTenantId() tenantId: string,
    @Query('period') period?: string,
  ) {
    return this.analytics.support(tenantId, period);
  }
}
