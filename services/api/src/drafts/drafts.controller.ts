import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Roles, RolesGuard } from '../auth/roles.js';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard.js';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import type { User } from '../store/types.js';
import { DraftsService } from './drafts.service.js';

@Controller('api/v1/reply-drafts')
@UseGuards(RolesGuard)
@Roles('admin', 'agent')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.drafts.update(tenantId, id, body.content, user.id);
  }

  @Post(':id/accept')
  accept(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.drafts.accept(tenantId, id, user.id);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  @Post(':id/accept-and-send')
  acceptAndSend(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { content?: string },
  ) {
    return this.drafts.acceptAndSend(tenantId, id, body.content, user.id);
  }

  @Post(':id/reject')
  reject(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.drafts.reject(tenantId, id, user.id);
  }
}
