import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Roles, RolesGuard } from '../auth/roles.js';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import type { User } from '../store/types.js';
import { ConversationsService } from './conversations.service.js';

@Controller('api/v1/auto-draft-jobs')
@UseGuards(RolesGuard)
@Roles('admin')
export class AutoDraftJobsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get('dead')
  listDead(@CurrentTenantId() tenantId: string) {
    return this.conversations.listDeadAutoDraftJobs(tenantId);
  }

  @Get('overview')
  overview(@CurrentTenantId() tenantId: string) {
    return this.conversations.autoDraftJobMetrics(tenantId);
  }

  @Post(':id/replay')
  replay(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.conversations.replayDeadAutoDraftJob(tenantId, id, user.id);
  }
}
