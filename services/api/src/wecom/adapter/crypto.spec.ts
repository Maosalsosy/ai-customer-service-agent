import { describe, expect, it } from 'vitest';
import {
  decryptWecomMessage,
  encryptWecomMessage,
  extractEncryptPayload,
  parseXmlTag,
  verifyWecomSignature,
  wecomSignature,
} from './crypto.js';

/** 43 字符 EncodingAESKey（解码后 32 字节）。 */
const AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
const TOKEN = 'testToken';
const CORP_ID = 'wwcorp123';

describe('wecom crypto', () => {
  it('round-trips encrypt/decrypt', () => {
    const plain = '<xml><Content><![CDATA[你好]]></Content></xml>';
    const encrypt = encryptWecomMessage(plain, AES_KEY, CORP_ID);
    expect(decryptWecomMessage(encrypt, AES_KEY, CORP_ID)).toBe(plain);
  });

  it('verifies callback signature', () => {
    const encrypt = encryptWecomMessage('echo', AES_KEY, CORP_ID);
    const timestamp = '1710000000';
    const nonce = 'nonce1';
    const signature = wecomSignature(TOKEN, timestamp, nonce, encrypt);
    expect(
      verifyWecomSignature({
        token: TOKEN,
        timestamp,
        nonce,
        encrypt,
        msgSignature: signature,
      }),
    ).toBe(true);
    expect(
      verifyWecomSignature({
        token: TOKEN,
        timestamp,
        nonce,
        encrypt,
        msgSignature: 'deadbeef',
      }),
    ).toBe(false);
  });

  it('extracts Encrypt from xml/json', () => {
    expect(
      extractEncryptPayload(
        '<xml><Encrypt><![CDATA[ABC123]]></Encrypt></xml>',
      ),
    ).toBe('ABC123');
    expect(extractEncryptPayload('{"Encrypt":"XYZ"}')).toBe('XYZ');
  });

  it('parses xml tags', () => {
    const xml =
      '<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[退货]]></Content></xml>';
    expect(parseXmlTag(xml, 'MsgType')).toBe('text');
    expect(parseXmlTag(xml, 'Content')).toBe('退货');
  });
});
