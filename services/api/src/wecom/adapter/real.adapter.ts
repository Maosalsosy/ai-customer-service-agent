import { Injectable } from '@nestjs/common';
import type {
  CallbackInput,
  ConnectionSnapshot,
  NormalizedIncomingMessage,
  SendReplyInput,
  SendReplyResult,
  UrlVerifyResult,
  WeComAdapter,
} from './types.js';

const NOT_IMPLEMENTED =
  '该连接是已停用的员工私聊历史通道；当前真实收发请使用微信客服账号连接。';

@Injectable()
export class RealWeComAdapter implements WeComAdapter {
  async verifyUrl(
    _input: CallbackInput,
    _connection: ConnectionSnapshot,
  ): Promise<UrlVerifyResult> {
    return { ok: false, message: NOT_IMPLEMENTED };
  }

  async verifyCallback(
    _input: CallbackInput,
    _connection: ConnectionSnapshot,
  ): Promise<boolean> {
    return false;
  }

  async normalizeEvent(
    _input: CallbackInput,
    _connection: ConnectionSnapshot,
  ): Promise<{ messages: NormalizedIncomingMessage[] }> {
    return { messages: [] };
  }

  async sendReply(
    _input: SendReplyInput,
    _connection: ConnectionSnapshot,
  ): Promise<SendReplyResult> {
    return {
      status: 'failed',
      simulated: false,
      errorMessage: NOT_IMPLEMENTED,
    };
  }

}
