import { describe, expect, it } from 'vitest';
import {
  currentHhMm,
  isWithinAutoSendWindow,
  parseHhMm,
  tenantAllowsAutoSendNow,
} from './auto-send-window.js';

describe('auto-send-window', () => {
  it('parses HH:mm', () => {
    expect(parseHhMm('09:00')).toBe('09:00');
    expect(parseHhMm(' 23:59 ')).toBe('23:59');
    expect(parseHhMm('9:00')).toBeNull();
    expect(parseHhMm('24:00')).toBeNull();
    expect(parseHhMm('')).toBeNull();
  });

  it('allows all day when window incomplete', () => {
    expect(isWithinAutoSendWindow(null, null)).toBe(true);
    expect(isWithinAutoSendWindow('09:00', null)).toBe(true);
    expect(isWithinAutoSendWindow(null, '18:00')).toBe(true);
  });

  it('handles same-day window', () => {
    // 2026-10-23 10:30 Asia/Shanghai = 02:30 UTC
    const morning = new Date('2026-10-23T02:30:00.000Z');
    expect(currentHhMm(morning)).toBe('10:30');
    expect(isWithinAutoSendWindow('09:00', '18:00', morning)).toBe(true);
    expect(isWithinAutoSendWindow('09:00', '10:00', morning)).toBe(false);
  });

  it('handles overnight window', () => {
    const night = new Date('2026-10-23T15:30:00.000Z'); // 23:30 CST
    const dawn = new Date('2026-10-22T20:30:00.000Z'); // 04:30 CST
    const noon = new Date('2026-10-23T04:00:00.000Z'); // 12:00 CST
    expect(isWithinAutoSendWindow('22:00', '06:00', night)).toBe(true);
    expect(isWithinAutoSendWindow('22:00', '06:00', dawn)).toBe(true);
    expect(isWithinAutoSendWindow('22:00', '06:00', noon)).toBe(false);
  });

  it('tenantAllowsAutoSendNow respects enabled and window', () => {
    const morning = new Date('2026-10-23T02:30:00.000Z');
    expect(
      tenantAllowsAutoSendNow(
        {
          autoSendEnabled: true,
          autoSendWindowStart: '09:00',
          autoSendWindowEnd: '18:00',
        },
        morning,
      ),
    ).toBe(true);
    expect(
      tenantAllowsAutoSendNow(
        {
          autoSendEnabled: false,
          autoSendWindowStart: '09:00',
          autoSendWindowEnd: '18:00',
        },
        morning,
      ),
    ).toBe(false);
    expect(
      tenantAllowsAutoSendNow(
        {
          autoSendEnabled: true,
          autoSendWindowStart: '12:00',
          autoSendWindowEnd: '18:00',
        },
        morning,
      ),
    ).toBe(false);
  });
});
