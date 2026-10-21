import {
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStore } from '../store/app-store.js';
import { AuthGuard } from './auth.guard.js';
import { signAuthToken } from './token.js';

const memberships = [
  { tenant: { id: 'tenant-a' }, role: 'agent' },
  { tenant: { id: 'tenant-b' }, role: 'admin' },
] as Awaited<ReturnType<AppStore['listMemberships']>>;

describe('AuthGuard tenant boundary', () => {
  const listMemberships = vi.fn();
  let guard: AuthGuard;

  beforeEach(() => {
    listMemberships.mockReset();
    listMemberships.mockResolvedValue(memberships);
    guard = new AuthGuard(
      { getAllAndOverride: () => false } as unknown as Reflector,
      { listMemberships } as unknown as AppStore,
    );
  });

  function context(token: string, tenantHeader = 'tenant-b') {
    const request = {
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenantHeader,
      },
    };
    const executionContext = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { executionContext, request };
  }

  function token(tenantId: string) {
    return signAuthToken({
      sub: 'user-1',
      tenantId,
      email: 'user@example.test',
      displayName: 'Test user',
      role: 'agent',
    });
  }

  it('uses the signed tenant claim and ignores a conflicting tenant header', async () => {
    const { executionContext, request } = context(token('tenant-a'));

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(request.auth?.tenantId).toBe('tenant-a');
    expect(request.auth?.user.role).toBe('agent');
  });

  it('rejects a signed tenant claim without an active membership', async () => {
    listMemberships.mockResolvedValue([memberships[0]]);
    const { executionContext } = context(token('tenant-b'), 'tenant-a');

    await expect(guard.canActivate(executionContext)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('loads the role from the selected tenant membership', async () => {
    const { executionContext, request } = context(token('tenant-b'), 'tenant-a');

    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
    expect(request.auth?.tenantId).toBe('tenant-b');
    expect(request.auth?.user.role).toBe('admin');
  });
});
