import { toTripDate, isTripDate } from '../src/utils/tripDates';
import { reviewerOverdueMessage, contactOverdueMessage, contactAllClearMessage, type OverdueContext } from '../src/services/safetyAlerts';
import { isTestAccount } from '../src/services/safetyMonitor';
import { pool } from '../src/utils/db';

afterAll(async () => {
  await pool.end();
});

describe('trip dates', () => {
  it('accepts a plain date, which is what the Safety form sends', () => {
    expect(toTripDate('2026-11-01')).toBe('2026-11-01');
    expect(isTripDate('2026-11-01')).toBe(true);
  });

  it('accepts full ISO datetimes and keeps the calendar date as written (no UTC shift)', () => {
    expect(toTripDate('2026-11-01T00:00:00+10:00')).toBe('2026-11-01');
    expect(toTripDate('2026-11-01T23:30:00Z')).toBe('2026-11-01');
    expect(toTripDate('2026-11-01T09:00:00')).toBe('2026-11-01');
  });

  it('rejects impossible and malformed dates', () => {
    for (const bad of ['2026-02-31', '2026-13-01', '2026-11-1', '01/11/2026', 'tomorrow', '', '2026-11-01; DROP TABLE x']) {
      expect(toTripDate(bad)).toBeNull();
    }
  });
});

describe('missed check-in wording', () => {
  const ctx = (over: Partial<OverdueContext> = {}): OverdueContext => ({
    travellerName: 'Emma Jones', destination: 'Nusa Penida', dueAt: new Date('2026-09-21T02:00:00Z'), overdueMinutes: 75,
    lastCheckinAt: new Date('2026-09-20T02:05:00Z'), lastLocation: { lat: -8.727, lng: 115.544, at: new Date('2026-09-20T02:05:00Z') }, ...over,
  });

  it('tells the reviewer everything needed to decide, including that contacts are not auto-messaged when that is off', () => {
    const m = reviewerOverdueMessage(ctx(), 2, false);
    expect(m.subject).toContain('missed check-in');
    expect(m.subject).toContain('Emma Jones');
    expect(m.body).toContain('Nusa Penida');
    expect(m.body).toContain('75 minutes ago');
    expect(m.body).toContain('maps.google.com/?q=-8.727,115.544');
    expect(m.body).toContain('NOT messaged automatically');
    expect(m.body).toContain('flat battery');
  });

  it('says so plainly when the traveller has no contacts, or no location', () => {
    const m = reviewerOverdueMessage(ctx({ lastLocation: null, lastCheckinAt: null }), 0, true);
    expect(m.body).toContain('none set');
    expect(m.body).toContain('none shared');
    expect(m.body).toContain('none yet on this trip');
  });

  it('gives a contact a calm, actionable message and does not claim the traveller is in danger', () => {
    const m = contactOverdueMessage(ctx());
    expect(m.text).toContain('may only mean a flat battery');
    expect(m.text).toContain('local emergency services');
    expect(m.text).not.toMatch(/in danger|kidnap|emergency has occurred/i);
    expect(m.sms.length).toBeLessThanOrEqual(320);
    expect(m.sms).toContain('Nusa Penida');
  });

  it('only includes a location when one is provided (the traveller allows it per contact)', () => {
    expect(contactOverdueMessage(ctx({ lastLocation: null })).text).not.toContain('maps.google.com');
    expect(contactOverdueMessage(ctx()).text).toContain('maps.google.com');
  });

  it('stands the contacts down when the traveller checks in', () => {
    const m = contactAllClearMessage('Emma Jones', 'Nusa Penida');
    expect(m.text).toContain('No further action is needed');
    expect(m.subject).toContain('has checked in');
  });

  it('describes a long delay in hours', () => {
    expect(reviewerOverdueMessage(ctx({ overdueMinutes: 300 }), 1, true).body).toContain('5 hours ago');
  });
});

describe('test accounts never alert anyone real', () => {
  it('recognises the seeded test domain only', () => {
    expect(isTestAccount('emma.jones@drifttest.com')).toBe(true);
    expect(isTestAccount('  SARAH@DRIFTTEST.COM ')).toBe(true);
    expect(isTestAccount('traveller@gmail.com')).toBe(false);
    expect(isTestAccount('x@notdrifttest.com')).toBe(false);
  });
});
