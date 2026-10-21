import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard.js';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import type { User } from '../store/types.js';
import { AuthService } from './auth.service.js';
import { Public } from './public.decorator.js';

@Controller('api/v1')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  @Post('auth/login')
  login(@Body() body: { email?: string; password?: string }) {
    return this.auth.login(body.email ?? '', body.password ?? '');
  }

  @Get('me')
  me(@CurrentUser() user: User, @CurrentTenantId() tenantId: string) {
    return this.auth.me(user, tenantId);
  }

  @Get('tenants')
  async tenants(
    @CurrentUser() user: User,
    @CurrentTenantId() tenantId: string,
  ) {
    const profile = await this.auth.me(user, tenantId);
    return profile.tenants;
  }

  @Post('auth/switch-tenant')
  switchTenant(
    @CurrentUser() user: User,
    @Body() body: { tenantId?: string },
  ) {
    return this.auth.switchTenant(user, body.tenantId ?? '');
  }
}
