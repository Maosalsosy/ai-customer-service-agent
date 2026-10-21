import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard.js';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import { Roles, RolesGuard } from '../auth/roles.js';
import type { User } from '../store/types.js';
import { CustomerService } from './customer.service.js';

@Controller('api/v1/customer')
@UseGuards(RolesGuard)
@Roles('customer')
export class CustomerController {
  constructor(private readonly customer: CustomerService) {}

  @Get('thread')
  thread(@CurrentTenantId() tenantId: string, @CurrentUser() user: User) {
    return this.customer.thread(tenantId, user);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit(60, 60_000)
  @Post('messages')
  send(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body() body: { content?: string },
  ) {
    return this.customer.sendMessage(tenantId, user, body.content ?? '');
  }
}
