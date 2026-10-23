import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import './auth.types.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { verifyAuthToken } from './token.js';
import type { AuthContext } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_STORE) private readonly store: AppStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : '';
    if (!token) {
      throw new UnauthorizedException('未登录或令牌缺失');
    }
    const payload = verifyAuthToken(token);
    if (!payload) {
      throw new UnauthorizedException('令牌无效或已过期');
    }

    const memberships = await this.store.listMemberships(payload.sub);
    const current = memberships.find((item) => item.tenant.id === payload.tenantId);
    if (!current) {
      throw new UnauthorizedException('当前工作区成员关系已失效');
    }

    const auth: AuthContext = {
      tenantId: current.tenant.id,
      user: {
        id: payload.sub,
        email: payload.email,
        displayName: payload.displayName,
        role: current.role,
        tenantId: current.tenant.id,
      },
    };
    req.auth = auth;
    return true;
  }
}
