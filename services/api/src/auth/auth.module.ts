import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { RolesGuard } from './roles.js';

@Global()
@Module({
  controllers: [AuthController, MembersController],
  providers: [
    AuthService,
    MembersService,
    AuthGuard,
    RolesGuard,
    RateLimitGuard,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, AuthGuard, RolesGuard, RateLimitGuard],
})
export class AuthModule {}
