import { Injectable } from '@nestjs/common';
import { MockWeComAdapter } from './mock.adapter.js';
import { RealWeComAdapter } from './real.adapter.js';
import { WeChatKfAdapter } from './wechat-kf.adapter.js';
import type { ConnectionSnapshot, WeComAdapter } from './types.js';

@Injectable()
export class WeComAdapterFactory {
  constructor(
    private readonly mock: MockWeComAdapter,
    private readonly real: RealWeComAdapter,
    private readonly wechatKf: WeChatKfAdapter,
  ) {}

  forConnection(connection: ConnectionSnapshot): WeComAdapter {
    if (connection.channelType === 'wecom_mock') return this.mock;
    if (connection.channelType === 'wechat_kf') return this.wechatKf;
    return this.real;
  }
}
