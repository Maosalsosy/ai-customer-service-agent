import { Inject, Injectable } from '@nestjs/common';
import { APP_STORE, type AppStore } from '../store/app-store.js';
import {
  parseAnalyticsPeriod,
  type AnalyticsPeriod,
} from './analytics-range.js';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(APP_STORE) private readonly store: AppStore) {}

  support(tenantId: string, periodRaw?: string) {
    const period: AnalyticsPeriod = parseAnalyticsPeriod(periodRaw);
    return this.store.supportAnalytics(tenantId, period);
  }
}
