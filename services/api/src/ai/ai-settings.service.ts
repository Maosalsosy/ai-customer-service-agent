import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '../common/secret-box.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import { AI_PROVIDER_PRESETS, findPreset } from './ai-providers.js';

export type AiProfileView = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  baseUrl: string;
  model: string;
  active: boolean;
  keyHint: string;
};

/** 坐席可选模型：不含密钥与接口地址 */
export type AiProfileChoice = {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  model: string;
  active: boolean;
};

type Stored = AiProfileView & { apiKey: string };

type ProfileInput = {
  name?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

@Injectable()
export class AiSettingsService {
  constructor(@Inject(APP_STORE) private readonly store: AppStore) {}

  presets() {
    return AI_PROVIDER_PRESETS;
  }

  async getAutoSendSetting(tenantId: string) {
    const tenant = await this.store.getTenant(tenantId);
    if (!tenant) throw new NotFoundException('租户不存在');
    return tenant;
  }

  async setAutoSendSetting(tenantId: string, enabled?: boolean) {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled 必须为布尔值');
    }
    const tenant = await this.store.setTenantAutoSendEnabled(tenantId, enabled);
    return { enabled: tenant.autoSendEnabled };
  }

  async list(tenantId: string) {
    const items = await this.readAll(tenantId);
    return {
      presets: AI_PROVIDER_PRESETS,
      items: items.map(stripKey),
      activeId: items.find((item) => item.active)?.id ?? null,
    };
  }

  /** 管理员与客服均可读取，用于工作台选择模型 */
  async listChoices(tenantId: string) {
    const items = await this.readAll(tenantId);
    return {
      items: items.map(
        (item): AiProfileChoice => ({
          id: item.id,
          name: item.name,
          provider: item.provider,
          providerLabel: item.providerLabel,
          model: item.model,
          active: item.active,
        }),
      ),
      activeId: items.find((item) => item.active)?.id ?? null,
    };
  }

  async create(tenantId: string, input: ProfileInput) {
    const items = await this.readAll(tenantId);
    if (items.length >= 12) {
      throw new BadRequestException('最多保存 12 套模型配置');
    }
    const next = this.build(input, null);
    next.active = items.length === 0;
    next.id = randomUUID();
    await this.persist(tenantId, next);
    return this.list(tenantId);
  }

  async update(tenantId: string, id: string, input: ProfileInput) {
    const current = await this.require(tenantId, id);
    const next = this.build(input, current);
    next.id = current.id;
    next.active = current.active;
    await this.persist(tenantId, next);
    return this.list(tenantId);
  }

  async activate(tenantId: string, id: string) {
    await this.require(tenantId, id);
    await this.store.activateAiProvider(tenantId, id);
    return this.list(tenantId);
  }

  async remove(tenantId: string, id: string) {
    await this.require(tenantId, id);
    await this.store.deleteAiProvider(tenantId, id);
    return this.list(tenantId);
  }

  async credentials(
    tenantId: string,
    profileId?: string | null,
  ): Promise<{
    apiKey: string;
    baseUrl: string;
    model: string;
    name: string;
  } | null> {
    const items = await this.readAll(tenantId);
    const selected = profileId
      ? items.find((item) => item.id === profileId)
      : undefined;
    if (profileId && !selected) {
      throw new NotFoundException('模型配置不存在');
    }
    const target = selected ?? items.find((item) => item.active);
    if (!target) return null;
    return {
      apiKey: target.apiKey,
      baseUrl: target.baseUrl,
      model: target.model,
      name: target.name || target.providerLabel,
    };
  }

  async resolveTestKey(tenantId: string, input: ProfileInput & { id?: string }) {
    const typed = input.apiKey?.trim();
    if (typed) {
      const built = this.build(input, null);
      return { apiKey: built.apiKey, baseUrl: built.baseUrl, model: built.model };
    }
    if (input.id) {
      const saved = await this.require(tenantId, input.id);
      const built = this.build({ ...input, apiKey: saved.apiKey }, saved);
      return { apiKey: built.apiKey, baseUrl: built.baseUrl, model: built.model };
    }
    const active = await this.credentials(tenantId);
    if (!active) return null;
    return active;
  }

  private build(input: ProfileInput, current: Stored | null): Stored {
    const apiKey = input.apiKey?.trim() || current?.apiKey;
    if (!apiKey || apiKey.length < 8) {
      throw new BadRequestException('请填写 API Key');
    }
    const typedBase = input.baseUrl?.trim();
    const baseUrl = this.normalizeBase(typedBase || current?.baseUrl || '');
    const model = (input.model ?? current?.model ?? '').trim();
    if (!model) {
      throw new BadRequestException('请填写模型名称');
    }
    const name = (input.name ?? current?.name ?? '').trim();
    if (!name) {
      throw new BadRequestException('请填写配置名称');
    }
    const known = findPreset((input.provider ?? '').trim());
    return {
      id: current?.id ?? '',
      name: name.slice(0, 80),
      provider: known?.id ?? 'custom',
      providerLabel: name.slice(0, 80),
      baseUrl,
      model: model.slice(0, 80),
      active: current?.active ?? false,
      keyHint: maskKey(apiKey),
      apiKey,
    };
  }

  private async require(tenantId: string, id: string) {
    const found = (await this.readAll(tenantId)).find((item) => item.id === id);
    if (!found) throw new NotFoundException('模型配置不存在');
    return found;
  }

  private async readAll(tenantId: string): Promise<Stored[]> {
    const rows = await this.store.listAiProviders(tenantId);
    const items: Stored[] = [];
    for (const row of rows) {
      const apiKey = decryptSecret(row.apiKey);
      if (!isEncryptedSecret(row.apiKey)) {
        try {
          await this.store.upsertAiProvider(tenantId, {
            ...row,
            apiKey: encryptSecret(apiKey),
          });
        } catch {
          /* ignore re-encrypt failures */
        }
      }
      items.push({
        id: row.id,
        name: row.name,
        provider: row.provider,
        providerLabel: findPreset(row.provider)?.label ?? row.provider,
        baseUrl: row.baseUrl,
        model: row.model,
        active: row.active,
        keyHint: maskKey(apiKey),
        apiKey,
      });
    }
    return items;
  }

  private async persist(tenantId: string, row: Stored) {
    await this.store.upsertAiProvider(tenantId, {
      id: row.id,
      name: row.name,
      provider: row.provider,
      baseUrl: row.baseUrl,
      model: row.model,
      apiKey: encryptSecret(row.apiKey),
      active: row.active,
    });
  }

  private normalizeBase(value?: string) {
    const base = (value ?? '').trim().replace(/\/$/, '');
    if (!base) throw new BadRequestException('请填写接口地址');
    let url: URL;
    try {
      url = new URL(base);
    } catch {
      throw new BadRequestException('接口地址无效');
    }
    const host = url.hostname.toLowerCase();
    const privateHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local') ||
      /^10\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('接口地址需使用 HTTP 或 HTTPS');
    }
    if (url.protocol === 'http:' && !privateHost) {
      throw new BadRequestException('公网接口地址需使用 HTTPS');
    }
    return base;
  }
}

function stripKey(row: Stored): AiProfileView {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    providerLabel: row.providerLabel,
    baseUrl: row.baseUrl,
    model: row.model,
    active: row.active,
    keyHint: row.keyHint,
  };
}

function maskKey(key: string) {
  return `****${key.slice(-4)}`;
}
