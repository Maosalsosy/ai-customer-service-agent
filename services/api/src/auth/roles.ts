import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import './auth.types.js';

export type AppRole = 'admin' | 'agent' | 'customer';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

/** 将成员 role 字符串归一成应用角色。 */
export function normalizeRole(role: string | undefined | null): AppRole {
  const raw = (role ?? '').trim();
  const lower = raw.toLowerCase();
  if (
    lower === 'admin' ||
    lower === 'owner' ||
    raw === '管理员' ||
    raw === '租户管理员'
  ) {
    return 'admin';
  }
  if (
    lower === 'customer' ||
    lower === 'user' ||
    raw === '客户' ||
    raw === '用户'
  ) {
    return 'customer';
  }
  return 'agent';
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const current = normalizeRole(req.auth?.user?.role);
    if (!required.includes(current)) {
      throw new ForbiddenException('当前角色无权执行此操作');
    }
    return true;
  }
}
