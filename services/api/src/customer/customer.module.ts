import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import { WecomModule } from '../wecom/wecom.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';

@Module({
  imports: [WecomModule],
  controllers: [CustomerController],
  providers: [CustomerService, RateLimitGuard],
})
export class CustomerModule {}
