import {
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import { DEMO_PASSWORD_HASH, DEMO_USER } from '../store/seed.js';
import { normalizeRole } from './roles.js';
import type { User } from '../store/types.js';
import { verifyPassword } from './password.js';
import { signAuthToken } from './token.js';
import { isDemoSeedEnabled } from '../common/runtime-mode.js';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit() {
    if (!isDemoSeedEnabled()) return;
    await this.store.ensureUserPasswordHash(DEMO_USER.id, DEMO_PASSWORD_HASH);
    await this.store.ensureDemoCustomer(DEMO_PASSWORD_HASH);
  }

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !password) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const account = await this.store.findAccountByEmail(normalized);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    return this.issueSession(account.user, account.memberships, account.tenant.id, {
      audit: 'auth.login',
      email: account.user.email,
    });
  }

  async me(user: User, tenantId: string) {
    const memberships = await this.store.listMemberships(user.id);
    const current = memberships.find((item) => item.tenant.id === tenantId);
    if (!current) {
      throw new UnauthorizedException('当前工作区成员关系已失效');
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: normalizeRole(current.role),
      },
      tenants: memberships.map((item) => item.tenant),
      currentTenantId: current.tenant.id,
    };
  }

  async switchTenant(user: User, tenantId: string) {
    const memberships = await this.store.listMemberships(user.id);
    const current = memberships.find((item) => item.tenant.id === tenantId);
    if (!current) {
      throw new ForbiddenException('无权切换到该工作区');
    }
    return this.issueSession(
      { ...user, tenantId: current.tenant.id, role: current.role },
      memberships,
      current.tenant.id,
      { audit: 'auth.switch_tenant' },
    );
  }

  private issueSession(
    user: User,
    memberships: { tenant: { id: string; name: string; slug: string }; role: string }[],
    tenantId: string,
    meta: { audit: string; email?: string },
  ) {
    const current = memberships.find((item) => item.tenant.id === tenantId);
    if (!current) {
      throw new UnauthorizedException('当前工作区成员关系已失效');
    }
    const role = normalizeRole(current.role);
    const token = signAuthToken({
      sub: user.id,
      tenantId: current.tenant.id,
      email: user.email,
      displayName: user.displayName,
      role,
    });
    this.audit.record({
      tenantId: current.tenant.id,
      actorId: user.id,
      action: meta.audit,
      targetType: 'user',
      targetId: user.id,
      detail: { email: meta.email ?? user.email, tenantId: current.tenant.id },
    });
    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: 60 * 60 * 24 * 7,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
      },
      tenants: memberships.map((item) => item.tenant),
      currentTenantId: current.tenant.id,
    };
  }
}
