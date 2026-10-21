import { Global, Module } from '@nestjs/common';
import { AiClientService } from './ai-client.service.js';
import { AiSettingsController } from './ai-settings.controller.js';
import { AiSettingsService } from './ai-settings.service.js';
import { AiEvaluationService } from './ai-evaluation.service.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';

@Global()
@Module({
  imports: [KnowledgeModule],
  controllers: [AiSettingsController],
  providers: [AiClientService, AiSettingsService, AiEvaluationService],
  exports: [AiClientService, AiSettingsService],
})
export class AiModule {}
