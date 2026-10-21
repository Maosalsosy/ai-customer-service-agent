import {
  Controller,
  Get,
  Query,
  Sse,
  UnauthorizedException,
  type MessageEvent,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { signStreamTicket, verifyStreamTicket } from '../auth/token.js';
import { Public } from '../auth/public.decorator.js';
import { CurrentTenantId, CurrentUser } from '../common/tenant.decorator.js';
import type { User } from '../store/types.js';
import { RealtimeService } from './realtime.service.js';

@Controller('api/v1/events')
export class EventsController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get('ticket')
  ticket(@CurrentUser() user: User, @CurrentTenantId() tenantId: string) {
    return {
      ticket: signStreamTicket({
        sub: user.id,
        tenantId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      }),
      expiresIn: 60,
    };
  }

  @Public()
  @Sse('stream')
  stream(@Query('ticket') ticket?: string): Observable<MessageEvent> {
    const payload = ticket ? verifyStreamTicket(ticket) : null;
    if (!payload) {
      throw new UnauthorizedException('实时连接票据无效或已过期');
    }
    return this.realtime.subscribe(payload.tenantId);
  }
}
