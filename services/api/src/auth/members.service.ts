import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import { hashPassword } from './password.js';
import type { AppRole } from './roles.js';

@Injectable()
export class MembersService {
  constructor(
    @Inject(APP_STORE) private readonly store: AppStore,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.store.listTenantMembers(tenantId);
  }

  async invite(
    tenantId: string,
    actorId: string,
    input: {
      email?: string;
      displayName?: string;
      role?: string;
      password?: string;
    },
  ) {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('请填写有效邮箱');
    }
    const role = this.requireRole(input.role);
    const password = (input.password ?? '').trim();
    if (password.length < 8) {
      throw new BadRequestException('初始密码至少 8 位');
    }
    const member = await this.store.inviteTenantMember(tenantId, {
      email,
      displayName: (input.displayName ?? '').trim() || email.split('@')[0],
      role,
      passwordHash: hashPassword(password),
    });
    this.audit.record({
      tenantId,
      actorId,
      action: 'member.invite',
      targetType: 'user',
      targetId: member.userId,
      detail: {
        email: member.email,
        displayName: member.displayName,
        role: member.role,
      },
    });
    return member;
  }

  async updateRole(
    tenantId: string,
    actorId: string,
    userId: string,
    roleRaw?: string,
  ) {
    const role = this.requireRole(roleRaw);
    const members = await this.store.listTenantMembers(tenantId);
    const previous = members.find((item) => item.userId === userId);
    const member = await this.store.updateTenantMemberRole(
      tenantId,
      userId,
      role,
    );
    this.audit.record({
      tenantId,
      actorId,
      action: 'member.update_role',
      targetType: 'user',
      targetId: userId,
      detail: {
        email: member.email,
        displayName: member.displayName,
        previousRole: previous?.role,
        role,
      },
    });
    return member;
  }

  private requireRole(roleRaw?: string): AppRole {
    const raw = (roleRaw ?? '').trim().toLowerCase();
    if (raw === 'admin' || raw === 'owner') return 'admin';
    if (raw === 'agent') return 'agent';
    if (raw === 'customer' || raw === 'user') return 'customer';
    throw new BadRequestException('角色仅支持 admin、agent 或 customer');
  }
}
