import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles, RolesGuard } from '../auth/roles.js';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard.js';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import type { ContactPolicy, ConversationStatus, User } from '../store/types.js';
import { ConversationsService } from './conversations.service.js';

@Controller('api/v1/conversations')
@UseGuards(RolesGuard)
@Roles('admin', 'agent')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get('contacts')
  listContacts(
    @CurrentTenantId() tenantId: string,
    @Query('q') q?: string,
    @Query('policy') policy?: ContactPolicy,
  ) {
    return this.conversations.listExternalContacts(tenantId, q, policy);
  }

  @Get('contacts/default-policy')
  defaultContactPolicy(@CurrentTenantId() tenantId: string) {
    return this.conversations.defaultContactPolicy(tenantId);
  }

  @Post('contacts/default-policy')
  setDefaultContactPolicy(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body() body: { policy?: ContactPolicy },
  ) {
    return this.conversations.setDefaultContactPolicy(tenantId, body.policy as ContactPolicy, user.id);
  }

  @Post('contacts/bulk-policy')
  setContactPolicies(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body() body: { ids?: string[]; policy?: ContactPolicy; reason?: string },
  ) {
    return this.conversations.setExternalContactPolicies(tenantId, body.ids ?? [], body.policy as ContactPolicy, body.reason, user.id);
  }

  @Post('contacts/:id/policy')
  setContactPolicy(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { policy?: ContactPolicy; reason?: string },
  ) {
    return this.conversations.setExternalContactPolicy(tenantId, id, body.policy as ContactPolicy, body.reason, user.id);
  }

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('status') status?: ConversationStatus,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.conversations.list(tenantId, status, q, {
      limit: limit != null ? Number(limit) : undefined,
      offset: offset != null ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.conversations.get(tenantId, id);
  }

  @Get(':id/messages')
  messages(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.conversations.messages(tenantId, id);
  }

  @Get(':id/ai-draft')
  async draft(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return { draft: await this.conversations.draft(tenantId, id) };
  }

  @Post(':id/assign')
  assign(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { userId?: string; assignee?: string },
  ) {
    return this.conversations.assign(tenantId, id, {
      userId: body.userId ?? user.id,
      displayName: body.assignee ?? user.displayName,
    });
  }

  @Post(':id/handling-mode')
  setHandlingMode(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { mode: 'ai' | 'human' },
  ) {
    const mode = body.mode === 'human' ? 'human' : 'ai';
    return this.conversations.setHandlingMode(
      tenantId,
      id,
      mode,
      mode === 'human'
        ? { userId: user.id, displayName: user.displayName }
        : undefined,
      user.id,
    );
  }

  @Post(':id/escalate')
  escalate(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.conversations.escalate(
      tenantId,
      id,
      body.reason,
      user.id,
    );
  }

  @Post(':id/read')
  markRead(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.conversations.markRead(tenantId, id);
  }

  @Post(':id/replies')
  reply(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.conversations.sendReply(
      tenantId,
      id,
      body.content,
      user.id,
    );
  }

  @UseGuards(RateLimitGuard)
  @RateLimit(30, 60_000)
  @Post(':id/ai-drafts')
  createDraft(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body?: { profileId?: string },
  ) {
    return this.conversations.createAiDraft(tenantId, id, user.id, {
      profileId: body?.profileId?.trim() || undefined,
    });
  }
}
