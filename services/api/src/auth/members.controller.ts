import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import type { User } from '../store/types.js';
import { MembersService } from './members.service.js';
import { Roles, RolesGuard } from './roles.js';

@Controller('api/v1/members')
@UseGuards(RolesGuard)
@Roles('admin')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  async list(@CurrentTenantId() tenantId: string) {
    const items = await this.members.list(tenantId);
    return { items };
  }

  @Post()
  invite(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body()
    body: {
      email?: string;
      displayName?: string;
      role?: string;
      password?: string;
    },
  ) {
    return this.members.invite(tenantId, user.id, body);
  }

  @Patch(':userId/role')
  updateRole(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('userId') userId: string,
    @Body() body: { role?: string },
  ) {
    return this.members.updateRole(tenantId, user.id, userId, body.role);
  }
}
