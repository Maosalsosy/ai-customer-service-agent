import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { Roles, RolesGuard } from '../auth/roles.js';
import { CurrentTenantId } from '../common/tenant.decorator.js';
import type { WecomCapability } from '../store/types.js';
import { WecomService } from './wecom.service.js';

@Controller('api/v1/wecom')
@UseGuards(RolesGuard)
export class WecomController {
  constructor(private readonly wecom: WecomService) {}

  @Get('connections')
  @Roles('admin', 'agent')
  list(@CurrentTenantId() tenantId: string) {
    return this.wecom.list(tenantId);
  }

  @Post('connections')
  @Roles('admin')
  create(
    @CurrentTenantId() tenantId: string,
    @Body()
    body: {
      channelType?: 'wecom' | 'wecom_mock' | 'wechat_kf';
      displayName?: string;
      capability?: WecomCapability;
      corpId?: string;
      agentId?: string;
      knowledgeBaseId?: string;
      knowledgeBaseIds?: string[];
      config?: Record<string, unknown>;
      externalAccountId?: string;
      appSecret?: string;
      callbackToken?: string;
      encodingAesKey?: string;
    },
  ) {
    if (body.channelType === 'wecom_mock' || !body.channelType) {
      return this.wecom.createMock(tenantId, body.displayName, body.knowledgeBaseIds ?? (body.knowledgeBaseId ? [body.knowledgeBaseId] : undefined));
    }
    if (body.channelType === 'wechat_kf') {
      return this.wecom.createWechatKf(tenantId, {
        displayName: body.displayName,
        corpId: body.corpId ?? '',
        appSecret: body.appSecret ?? '',
        callbackToken: body.callbackToken ?? '',
        encodingAesKey: body.encodingAesKey ?? '',
        externalAccountId: body.externalAccountId ?? '',
        knowledgeBaseId: body.knowledgeBaseId,
        knowledgeBaseIds: body.knowledgeBaseIds,
      });
    }
    return this.wecom.createPending(tenantId, {
      displayName: body.displayName ?? '企业微信连接',
      capability: body.capability,
      corpId: body.corpId,
      agentId: body.agentId,
      knowledgeBaseId: body.knowledgeBaseId,
      config: body.config,
    });
  }

  @Post('wechat-kf/accounts')
  @Roles('admin')
  listWechatKfAccounts(
    @Body() body: { corpId?: string; appSecret?: string },
  ) {
    return this.wecom.listWechatKfAccounts({
      corpId: body.corpId ?? '',
      appSecret: body.appSecret ?? '',
    });
  }

  @Patch('connections/:id')
  @Roles('admin')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @Body()
    body: {
      displayName?: string;
      capability?: WecomCapability;
      corpId?: string;
      agentId?: string;
      knowledgeBaseId?: string | null;
      knowledgeBaseIds?: string[];
      config?: Record<string, unknown>;
    },
  ) {
    return this.wecom.update(tenantId, id, body ?? {});
  }

  @Post('connections/:id/disable')
  @Roles('admin')
  disable(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.wecom.disable(tenantId, id);
  }

  @Delete('connections/:id')
  @Roles('admin')
  @HttpCode(204)
  async remove(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    await this.wecom.remove(tenantId, id);
  }

  @Post('mock/inject')
  @Roles('admin', 'agent')
  inject(
    @CurrentTenantId() tenantId: string,
    @Body()
    body: {
      connectionId?: string;
      contactName: string;
      content: string;
      externalMessageId?: string;
      conversationId?: string;
      externalConversationId?: string;
    },
  ) {
    return this.wecom.injectMockMessage(tenantId, body);
  }

  @Public()
  @Get('callback/:connectionId')
  async callbackVerify(
    @Param('connectionId') connectionId: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const result = await this.wecom.handleCallbackGet(connectionId, query);
    if (result.ok && result.echo) {
      res.type('text/plain').send(result.echo);
      return;
    }
    res.status(400).json({
      error: {
        code: 'WECOM_CALLBACK_VERIFY_FAILED',
        message: result.message ?? 'URL 验证失败',
      },
    });
  }

  @Public()
  @Post('callback/:connectionId')
  async callbackEvent(
    @Param('connectionId') connectionId: string,
    @Query() query: Record<string, string | undefined>,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | undefined>,
    @Req() request: RawBodyRequest<Request>,
    @Res() res: Response,
  ) {
    const rawBody =
      request.rawBody?.toString('utf8') ??
      (typeof body === 'string' ? body : JSON.stringify(body ?? {}));
    const result = await this.wecom.handleCallbackPost(
      connectionId,
      query,
      rawBody,
      headers,
    );
    if (!result.ok) {
      res.status(403).type('text/plain').send(result.message ?? 'fail');
      return;
    }
    res.type('text/plain').send('success');
  }
}
