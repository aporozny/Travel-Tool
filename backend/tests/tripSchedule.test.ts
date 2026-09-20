import { getAirport, localToUtc, formatLocal, hotelZone, planReminders, presentRequirement } from '../src/services/tripSchedule';

const at = (iso: string) => new Date(iso);
const H = 3600 * 1000;

describe('airport lookup', () => {
  it('finds the timezone for the launch airports', () => {
    expect(getAirport('SYD')?.tz).toBe('Australia/Sydney');
    expect(getAirport('dps')?.tz).toBe('Asia/Makassar'); // Bali, case-insensitive
    expect(getAirport('DPS')?.cc).toBe('ID');
  });

  it('returns null for an unknown or empty code rather than guessing', () => {
    expect(getAirport('ZZZ')).toBeNull();
    expect(getAirport('')).toBeNull();
    expect(getAirport(null)).toBeNull();
  });
});

describe('local time to exact moment', () => {
  it('converts a Sydney departure using the offset in force that day (DST)', () => {
    // 23 Sep 2026 is Sydney daylight saving? Sydney DST starts first Sunday in October,
    // so on 23 Sep it is AEST (+10); on 15 Nov it is AEDT (+11).
    expect(localToUtc('2026-09-23T20:50:00', 'Australia/Sydney')?.toISOString()).toBe('2026-09-23T10:50:00.000Z');
    expect(localToUtc('2026-11-15T07:55:00', 'Australia/Sydney')?.toISOString()).toBe('2026-11-14T20:55:00.000Z');
  });

  it('uses Bali time (UTC+8), not Jakarta time (UTC+7)', () => {
    expect(localToUtc('2026-09-24T21:45:00', 'Asia/Makassar')?.toISOString()).toBe('2026-09-24T13:45:00.000Z');
    expect(localToUtc('2026-09-24T21:45:00', 'Asia/Jakarta')?.toISOString()).toBe('2026-09-24T14:45:00.000Z');
  });

  it('is null when the time or the zone is missing or invalid', () => {
    expect(localToUtc('not a time', 'Australia/Sydney')).toBeNull();
    expect(localToUtc('2026-09-23T20:50:00', 'Mars/Olympus')).toBeNull();
    expect(localToUtc('2026-09-23T20:50:00', null)).toBeNull();
    expect(localToUtc(null, 'Australia/Sydney')).toBeNull();
  });

  it('formats a stored local time without shifting it', () => {
    expect(formatLocal('2026-09-23T20:50:00', 'HH:mm')).toBe('20:50');
    expect(formatLocal('2026-09-23T20:50:00', 'd LLL')).toBe('23 Sep');
  });
});

describe('hotel timezone', () => {
  it('splits Indonesia into its three zones by longitude', () => {
    expect(hotelZone('ID', 115.17)).toBe('Asia/Makassar'); // Seminyak, Bali
    expect(hotelZone('ID', 106.8)).toBe('Asia/Jakarta');
    expect(hotelZone('ID', 140.7)).toBe('Asia/Jayapura');
  });

  it('does not guess outside Indonesia or without coordinates', () => {
    expect(hotelZone('TH', 100.5)).toBeNull();
    expect(hotelZone('ID', null)).toBeNull();
  });
});

describe('reminder planning (flights)', () => {
  const dep = at('2026-10-01T10:00:00Z');

  it('schedules all four reminders for a trip booked well ahead, in order', () => {
    const plan = planReminders('flight', dep, at('2026-09-01T00:00:00Z'));
    expect(plan.map((p) => p.type)).toEqual(['pre_7d', 'pre_72h', 'pre_24h', 'pre_3h']);
    expect(plan[0].sendAt.toISOString()).toBe('2026-09-24T10:00:00.000Z');
    expect(plan[3].sendAt.toISOString()).toBe('2026-10-01T07:00:00.000Z');
  });

  it('booked 2 hours before departure: only the "time to leave" message, sent now', () => {
    const now = at('2026-10-01T08:00:00Z');
    const plan = planReminders('flight', dep, now);
    expect(plan.map((p) => p.type)).toEqual(['pre_3h']);
    expect(plan[0].sendAt.getTime()).toBe(now.getTime());
  });

  it('drops a reminder whose window has closed instead of sending it late', () => {
    // 60 hours out: the 7-day and 72-hour reminders are long past their windows.
    const plan = planReminders('flight', dep, at('2026-09-28T22:00:00Z'));
    expect(plan.map((p) => p.type)).toEqual(['pre_24h', 'pre_3h']);
  });

  it('sends a reminder right away when it is late but its window is still open', () => {
    // 71 hours out: the 72h reminder was due an hour ago, its window is 12h.
    const now = at('2026-09-28T11:00:00Z');
    const plan = planReminders('flight', dep, now);
    const p72 = plan.find((p) => p.type === 'pre_72h')!;
    expect(p72.sendAt.getTime()).toBe(now.getTime());
  });

  it('sends nothing for a flight that is about to leave, has left, or has no exact time', () => {
    expect(planReminders('flight', dep, at('2026-10-01T09:50:00Z'))).toEqual([]);
    expect(planReminders('flight', dep, at('2026-10-02T00:00:00Z'))).toEqual([]);
    expect(planReminders('flight', null, at('2026-09-01T00:00:00Z'))).toEqual([]);
  });

  it('never lets a reminder expire after the flight', () => {
    for (const p of planReminders('flight', dep, at('2026-09-01T00:00:00Z'))) {
      expect(p.expiresAt.getTime()).toBeLessThanOrEqual(dep.getTime());
      expect(p.expiresAt.getTime()).toBeGreaterThan(p.sendAt.getTime());
    }
  });
});

describe('reminder planning (hotels)', () => {
  it('sends one check-in-day reminder, and none once check-in has long passed', () => {
    const checkIn = at('2026-11-15T04:00:00Z'); // noon at UTC+8
    const plan = planReminders('hotel', checkIn, at('2026-11-01T00:00:00Z'));
    expect(plan.map((p) => p.type)).toEqual(['hotel_checkin']);
    expect(plan[0].sendAt.getTime()).toBe(checkIn.getTime() - 4 * H);
    expect(planReminders('hotel', checkIn, at('2026-11-20T00:00:00Z'))).toEqual([]);
  });
});

describe('entry requirements', () => {
  const row = { rule_key: 'id_evoa', title: 'Visa on arrival (e-VOA)', body: 'It costs IDR 500,000.', source_url: 'https://example.gov/evoa' };

  it('states the rule while a person has checked it recently', () => {
    const p = presentRequirement({ ...row, verified_at: '2026-09-20' }, at('2026-10-01T00:00:00Z'));
    expect(p.verified).toBe(true);
    expect(p.text).toBe('It costs IDR 500,000.');
  });

  it('falls back to "check the official source" once the check is older than 90 days', () => {
    const p = presentRequirement({ ...row, verified_at: '2026-01-01' }, at('2026-10-01T00:00:00Z'));
    expect(p.verified).toBe(false);
    expect(p.text).not.toContain('500,000');
    expect(p.sourceUrl).toBe('https://example.gov/evoa');
  });

  it('never states a rule that has never been checked', () => {
    const p = presentRequirement({ ...row, verified_at: null }, at('2026-10-01T00:00:00Z'));
    expect(p.verified).toBe(false);
    expect(p.text).not.toContain('500,000');
  });
});
