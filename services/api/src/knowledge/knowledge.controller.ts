import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Roles, RolesGuard } from '../auth/roles.js';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import type { User } from '../store/types.js';
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES } from './document-import.js';
import { KnowledgeService } from './knowledge.service.js';

@Controller('api/v1/knowledge')
@UseGuards(RolesGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('documents')
  @Roles('admin', 'agent')
  list(
    @CurrentTenantId() tenantId: string,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('knowledgeBaseId') knowledgeBaseId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.knowledge.list(tenantId, q, categoryId, knowledgeBaseId, {
      status,
      limit: limit != null ? Number(limit) : undefined,
      offset: offset != null ? Number(offset) : undefined,
    });
  }

  @Get('retrieve')
  @Roles('admin', 'agent')
  retrieve(
    @CurrentTenantId() tenantId: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.knowledge.probeRetrieve(
      tenantId,
      q ?? '',
      limit != null ? Number(limit) : 5,
    );
  }

  @Get('index-health')
  @Roles('admin')
  indexHealth(@CurrentTenantId() tenantId: string) {
    return this.knowledge.getIndexHealth(tenantId);
  }

  @Post('reindex-missing')
  @Roles('admin')
  reindexMissing(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
  ) {
    return this.knowledge.reindexMissing(tenantId, user.id);
  }

  @Get('bases')
  @Roles('admin', 'agent')
  bases(@CurrentTenantId() tenantId: string) { return this.knowledge.listBases(tenantId); }

  @Post('bases')
  @Roles('admin')
  createBase(@CurrentTenantId() tenantId: string, @Body() body: { name?: string }) { return this.knowledge.createBase(tenantId, body?.name ?? ''); }

  @Patch('bases/:id')
  @Roles('admin')
  updateBase(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Body() body: { name?: string }) { return this.knowledge.updateBase(tenantId, id, body?.name ?? ''); }

  @Delete('bases/:id')
  @Roles('admin')
  deleteBase(@CurrentTenantId() tenantId: string, @Param('id') id: string) { return this.knowledge.deleteBase(tenantId, id); }

  @Get('categories')
  @Roles('admin', 'agent')
  categories(@CurrentTenantId() tenantId: string, @Query('knowledgeBaseId') knowledgeBaseId?: string) { return this.knowledge.listCategories(tenantId, knowledgeBaseId); }

  @Get('gaps')
  @Roles('admin', 'agent')
  gaps(@CurrentTenantId() tenantId: string) { return this.knowledge.listGaps(tenantId); }

  @Patch('gaps/:id')
  @Roles('admin', 'agent')
  updateGap(@CurrentTenantId() tenantId: string, @Param('id') id: string, @Body() body: { status?: 'open' | 'in_progress' | 'resolved' | 'ignored' }) { return this.knowledge.updateGap(tenantId, id, body.status ?? 'open'); }

  @Post('gaps/:id/faq')
  @Roles('admin', 'agent')
  convertGap(@CurrentTenantId() tenantId: string, @CurrentUser() user: User, @Param('id') id: string) { return this.knowledge.convertGapToFaq(tenantId, id, user.id); }

  @Get('index-settings')
  @Roles('admin')
  getIndexSettings(@CurrentTenantId() tenantId: string) {
    return this.knowledge.getIndexSettings(tenantId);
  }

  @Patch('index-settings')
  @Roles('admin')
  updateIndexSettings(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body()
    body: {
      chunkSize?: number;
      chunkOverlap?: number;
      maxChunksPerDoc?: number;
    },
  ) {
    return this.knowledge.updateIndexSettings(tenantId, body, user.id);
  }

  @Get('documents/:id')
  @Roles('admin', 'agent')
  get(@CurrentTenantId() tenantId: string, @Param('id') id: string) {
    return this.knowledge.get(tenantId, id);
  }

  @Post('documents')
  @Roles('admin', 'agent')
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body()
    body: {
      title: string;
      sourceType?: 'faq' | 'markdown';
      body?: string;
      content?: string;
      categoryId?: string | null;
      knowledgeBaseId?: string;
    },
  ) {
    return this.knowledge.create(
      tenantId,
      {
        title: body.title,
        sourceType: body.sourceType ?? 'faq',
        body: body.body ?? body.content ?? '',
        categoryId: body.categoryId,
        knowledgeBaseId: body.knowledgeBaseId,
      },
      { id: user.id, role: user.role },
    );
  }

  @Post('questions')
  @Roles('admin', 'agent')
  submitQuestion(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Body() body: { question?: string },
  ) {
    return this.knowledge.submitQuestion(tenantId, body?.question ?? '', user.id);
  }

  @Post('documents/upload')
  @Roles('admin', 'agent')
  @UseInterceptors(
    FilesInterceptor('files', MAX_IMPORT_FILES, {
      limits: { fileSize: MAX_IMPORT_BYTES, files: MAX_IMPORT_FILES },
    }),
  )
  upload(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @UploadedFiles()
    files:
      | { originalname: string; buffer: Buffer; size: number }[]
      | undefined,
    @Body() body: { categoryId?: string | null; knowledgeBaseId?: string },
  ) {
    if (!files?.length) throw new BadRequestException('请选择文件');
    return this.knowledge.importUploads(tenantId, files, {
      id: user.id,
      role: user.role,
    }, body?.categoryId, body?.knowledgeBaseId);
  }

  @Post('documents/:id/publish')
  @Roles('admin')
  publish(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.knowledge.publish(tenantId, id, user.id);
  }

  @Post('documents/:id/reject')
  @Roles('admin')
  reject(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { reviewNote?: string },
  ) {
    return this.knowledge.reject(tenantId, id, body?.reviewNote, user.id);
  }

  @Patch('documents/:id')
  @Roles('admin', 'agent')
  update(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body()
    body: {
      title: string;
      sourceType?: 'faq' | 'markdown';
      body?: string;
      content?: string;
      categoryId?: string | null;
      knowledgeBaseId?: string;
    },
  ) {
    return this.knowledge.update(
      tenantId,
      id,
      {
        title: body.title,
        sourceType: body.sourceType ?? 'faq',
        body: body.body ?? body.content ?? '',
        categoryId: body.categoryId,
        knowledgeBaseId: body.knowledgeBaseId,
      },
      { id: user.id, role: user.role },
    );
  }

  @Post('documents/:id/archive')
  @Roles('admin')
  archive(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.knowledge.archive(tenantId, id, user.id);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @Roles('admin', 'agent')
  async remove(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    await this.knowledge.remove(tenantId, id, {
      id: user.id,
      role: user.role,
    });
  }
}
