import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Roles, RolesGuard } from '../auth/roles.js';
import { CurrentTenantId } from '../common/tenant.decorator.js';
import { AiClientService } from './ai-client.service.js';
import { AiEvaluationService } from './ai-evaluation.service.js';
import { AiSettingsService } from './ai-settings.service.js';

type ProfileBody = {
  id?: string;
  name?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

@Controller('api/v1/ai')
@UseGuards(RolesGuard)
export class AiSettingsController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly ai: AiClientService,
    private readonly evaluation: AiEvaluationService,
  ) {}

  /** 工作台可选模型列表（不含密钥） */
  @Get('profiles')
  @Roles('admin', 'agent')
  listChoices(@CurrentTenantId() tenantId: string) {
    return this.settings.listChoices(tenantId);
  }

  @Get('settings')
  @Roles('admin')
  list(@CurrentTenantId() tenantId: string) {
    return this.settings.list(tenantId);
  }

  @Get('settings/auto-send')
  @Roles('admin', 'agent')
  autoSend(@CurrentTenantId() tenantId: string) {
    return this.settings.getAutoSendSetting(tenantId);
  }

  @Put('settings/auto-send')
  @Roles('admin')
  setAutoSend(
    @CurrentTenantId() tenantId: string,
    @Body()
    body: {
      enabled?: boolean;
      windowStart?: string | null;
      windowEnd?: string | null;
      timezone?: string | null;
    },
  ) {
    return this.settings.setAutoSendSetting(tenantId, body ?? {});
  }

  @Get('settings/reply-style')
  @Roles('admin', 'agent')
  replyStyle(@CurrentTenantId() tenantId: string) {
    return this.settings.getReplyStyle(tenantId);
  }

  @Put('settings/reply-style')
  @Roles('admin')
  setReplyStyle(
    @CurrentTenantId() tenantId: string,
    @Body()
    body: {
      tone?: string;
      persona?: string;
      systemPrompt?: string;
      maxLength?: number;
    },
  ) {
    return this.settings.setReplyStyle(tenantId, body ?? {});
  }

  @Post('settings')
  @Roles('admin')
  create(@CurrentTenantId() tenantId: string, @Body() body: ProfileBody) {
    return this.settings.create(tenantId, body ?? {});
  }

  @Post('settings/test')
  @Roles('admin')
  async test(@CurrentTenantId() tenantId: string, @Body() body: ProfileBody) {
    const resolved = await this.settings.resolveTestKey(tenantId, body ?? {});
    if (!resolved) return { ok: false, message: '尚未填写 API Key' };
    return this.ai.testProvider(resolved);
  }

  @Post('settings/evaluate')
  @Roles('admin')
  evaluate(
    @CurrentTenantId() tenantId: string,
    @Body() body: { profileId?: string },
  ) {
    return this.evaluation.run(tenantId, body?.profileId);
  }

  @Put('settings/:id')
  @Roles('admin')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: ProfileBody,
  ) {
    return this.settings.update(tenantId, id, body ?? {});
  }

  @Post('settings/:id/activate')
  @Roles('admin')
  activate(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.settings.activate(tenantId, id);
  }

  @Delete('settings/:id')
  @Roles('admin')
  remove(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.settings.remove(tenantId, id);
  }
}
