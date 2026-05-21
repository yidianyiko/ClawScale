import { describe, expect, it } from 'vitest';
import {
  buildRuleFingerprint,
  capQueryRange,
  generateWindowInstances,
  isValidIanaTimezone,
  renderWindowForViewer,
  validateBookableWindowRule,
} from './time.js';

describe('scheduling time rules', () => {
  it('validates first-version weekly rules without RRULE conversion', () => {
    const rule = validateBookableWindowRule({
      type: 'weekly',
      days_of_week: [2, 4],
      time_start: '19:00',
      time_end: '21:00',
      timezone: 'Asia/Shanghai',
      effective_from: '2026-06-01',
      effective_until: null,
    });

    expect(rule.type).toBe('weekly');
    expect(rule.days_of_week).toEqual([2, 4]);
    expect(JSON.stringify(rule)).not.toContain('RRULE');
    expect(buildRuleFingerprint(rule)).toBe(buildRuleFingerprint(rule));
  });

  it('rejects short, overlapping, and invalid timezone windows', () => {
    expect(() =>
      validateBookableWindowRule({
        type: 'weekly',
        days_of_week: [2],
        time_start: '19:00',
        time_end: '19:05',
        timezone: 'Asia/Shanghai',
        effective_from: '2026-06-01',
        effective_until: null,
      }),
    ).toThrow('window_too_short');

    expect(() =>
      validateBookableWindowRule({
        type: 'weekly',
        days_of_week: [2],
        time_start: '19:00',
        time_end: '21:00',
        timezone: 'Mars/Base',
        effective_from: '2026-06-01',
        effective_until: null,
      }),
    ).toThrow('invalid_timezone');
  });

  it('rejects non-canonical timezone aliases while allowing UTC', () => {
    expect(isValidIanaTimezone('UTC')).toBe(true);
    expect(isValidIanaTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidIanaTimezone('America/Los_Angeles')).toBe(true);
    expect(isValidIanaTimezone('PST')).toBe(false);
    expect(isValidIanaTimezone('US/Pacific')).toBe(false);
    expect(isValidIanaTimezone('Etc/GMT+8')).toBe(false);

    for (const timezone of ['PST', 'US/Pacific', 'Etc/GMT+8']) {
      expect(() =>
        validateBookableWindowRule({
          type: 'weekly',
          days_of_week: [2],
          time_start: '19:00',
          time_end: '21:00',
          timezone,
          effective_from: '2026-06-01',
          effective_until: null,
        }),
      ).toThrow('invalid_timezone');
    }
  });

  it('caps availability query lookahead to 90 days', () => {
    const range = capQueryRange('2026-06-01', '2027-06-01');
    expect(range.dateFrom).toBe('2026-06-01');
    expect(range.dateTo).toBe('2026-08-30');
  });

  it('generates specific weekly instances and renders viewer timezone labels', () => {
    const rule = validateBookableWindowRule({
      type: 'weekly',
      days_of_week: [2],
      time_start: '19:00',
      time_end: '21:00',
      timezone: 'Asia/Shanghai',
      effective_from: '2026-06-01',
      effective_until: null,
    });

    const instances = generateWindowInstances({
      bookableWindowId: 'bw_1',
      rule,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-14',
      excluded: [],
      occupied: [],
    });

    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({
      bookableWindowId: 'bw_1',
      instanceStart: '2026-06-02T11:00:00.000Z',
      instanceEnd: '2026-06-02T13:00:00.000Z',
    });

    const rendered = renderWindowForViewer(instances[0]!, 'America/Los_Angeles');
    expect(rendered.timezoneLabel).toMatch(/Pacific|GMT-7|GMT-8/);
    expect(rendered.localDate).toBe('2026-06-02');
  });

  it('does not emit DST-shortened instances below the minimum real duration', () => {
    const rule = validateBookableWindowRule({
      type: 'once',
      date: '2026-03-08',
      time_start: '01:50',
      time_end: '03:00',
      timezone: 'America/Los_Angeles',
    });

    const instances = generateWindowInstances({
      bookableWindowId: 'bw_dst',
      rule,
      dateFrom: '2026-03-08',
      dateTo: '2026-03-08',
      excluded: [],
      occupied: [],
    });

    expect(instances).toEqual([]);
  });

  it('generates once instances and skips exact excluded or occupied pairs', () => {
    const rule = validateBookableWindowRule({
      type: 'once',
      date: '2026-06-02',
      time_start: '19:00',
      time_end: '21:00',
      timezone: 'Asia/Shanghai',
    });

    const [instance] = generateWindowInstances({
      bookableWindowId: 'bw_once',
      rule,
      dateFrom: '2026-06-01',
      dateTo: '2026-06-14',
      excluded: [],
      occupied: [],
    });

    expect(instance).toMatchObject({
      bookableWindowId: 'bw_once',
      instanceStart: '2026-06-02T11:00:00.000Z',
      instanceEnd: '2026-06-02T13:00:00.000Z',
    });

    expect(
      generateWindowInstances({
        bookableWindowId: 'bw_once',
        rule,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-14',
        excluded: [{ instanceStart: instance!.instanceStart, instanceEnd: instance!.instanceEnd }],
        occupied: [],
      }),
    ).toEqual([]);

    expect(
      generateWindowInstances({
        bookableWindowId: 'bw_once',
        rule,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-14',
        excluded: [],
        occupied: [{ instanceStart: instance!.instanceStart, instanceEnd: instance!.instanceEnd }],
      }),
    ).toEqual([]);
  });
});
