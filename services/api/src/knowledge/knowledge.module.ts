import { Module } from '@nestjs/common';
import { EmbedClient } from './embed-client.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  controllers: [KnowledgeController],
  providers: [EmbedClient, KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
