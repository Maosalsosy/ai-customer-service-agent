import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../store/types.js';

/** 从鉴权上下文读取当前工作区；未登录则由 AuthGuard 拦截。 */
export const CurrentTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const tenantId = req.auth?.tenantId;
    if (!tenantId) {
      throw new UnauthorizedException('缺少工作区上下文');
    }
    return tenantId;
  },
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.auth?.user;
    if (!user) {
      throw new UnauthorizedException('缺少用户上下文');
    }
    return user;
  },
);
