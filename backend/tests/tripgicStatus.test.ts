import { interpretBooking, isStillUpcoming } from '../src/services/tripgicStatus';

// What TripGic's sandbox really returned for held test bookings on 2026-09-21.
const observedHeld = { booking_status: 'hold', ticket_status: 'inQues', payment_status: 'pending', auto_cancel_timestamp: '1790049599', auto_cancel: '2026-09-21 23:59:59' };

describe('reading a TripGic booking', () => {
  it('reads the wording actually seen for a held booking', () => {
    const r = interpretBooking(observedHeld);
    expect(r.status).toBeNull(); // still waiting: nothing has changed
    expect(r.supplierStatus).toBe('hold/inQues');
    expect(r.recognised).toBe(true);
    expect(r.deadline?.toISOString()).toBe('2026-09-22T03:59:59.000Z');
  });

  it('follows a deadline that TripGic has moved', () => {
    // A real booking whose stored deadline was 03:59 but which TripGic now has at 13:45 UTC.
    expect(interpretBooking({ ...observedHeld, auto_cancel_timestamp: '1789911900' }).deadline?.toISOString()).toBe('2026-09-20T13:45:00.000Z');
  });

  it('recognises a ticketed or confirmed booking, however the wording is cased', () => {
    for (const b of [
      { booking_status: 'ticketed', ticket_status: 'ticketed' },
      { booking_status: 'Ticketed', ticket_status: '' },
      { booking_status: 'hold', ticket_status: 'Issued' },
      { booking_status: 'Confirmed', ticket_status: '' },
      { booking_status: 'Voucher Generated', ticket_status: '' },
    ]) {
      const r = interpretBooking(b);
      expect(r.status).toBe('ticketed');
      expect(r.recognised).toBe(true);
    }
  });

  it('recognises a cancelled or voided booking, and cancelled wins over an old ticket status', () => {
    for (const b of [{ booking_status: 'Cancelled' }, { booking_status: 'voided' }, { booking_status: 'Cancel Requested' }, { booking_status: 'Cancelled', ticket_status: 'ticketed' }]) {
      expect(interpretBooking(b).status).toBe('cancelled');
    }
  });

  it('flags wording it has not seen, without guessing a change', () => {
    const r = interpretBooking({ booking_status: 'on-fire', ticket_status: '???' });
    expect(r.status).toBeNull();
    expect(r.recognised).toBe(false);
    expect(r.supplierStatus).toBe('on-fire/???');
  });

  it('copes with a missing or empty answer', () => {
    for (const b of [undefined, null, {}, 'text', 42]) {
      const r = interpretBooking(b as any);
      expect(r.status).toBeNull();
      expect(r.deadline).toBeNull();
    }
    expect(interpretBooking({}).supplierStatus).toBe('/');
  });

  it('never trusts a deadline that is not a plausible date', () => {
    for (const ts of ['0', '', 'abc', '100', null, undefined, 'NaN', '-5']) {
      expect(interpretBooking({ ...observedHeld, auto_cancel_timestamp: ts }).deadline).toBeNull();
    }
    expect(interpretBooking({ ...observedHeld, auto_cancel_timestamp: 1790049599 }).deadline?.getUTCFullYear()).toBe(2026); // a number works too
  });
});

describe('is a booking still worth watching', () => {
  const now = new Date('2026-11-16T00:00:00Z');

  it('watches a flight until a day after it departs', () => {
    expect(isStillUpcoming({ slices: [{ departingAt: '2026-11-20T08:00:00' }] }, 'flight', now)).toBe(true);
    expect(isStillUpcoming({ slices: [{ departingAt: '2026-11-15T12:00:00' }] }, 'flight', now)).toBe(true); // yesterday midday: not yet a full day, in any time zone
    expect(isStillUpcoming({ slices: [{ departingAt: '2026-11-10T07:55:00' }] }, 'flight', now)).toBe(false);
  });

  it('watches a stay until a day after check-out', () => {
    expect(isStillUpcoming({ checkOutDate: '2026-11-18' }, 'hotel', now)).toBe(true);
    expect(isStillUpcoming({ checkInDate: '2026-11-01' }, 'hotel', now)).toBe(false);
  });

  it('keeps watching when there is no usable date', () => {
    expect(isStillUpcoming({}, 'flight', now)).toBe(true);
    expect(isStillUpcoming(null, 'hotel', now)).toBe(true);
    expect(isStillUpcoming({ slices: [{ departingAt: 'not a date' }] }, 'flight', now)).toBe(true);
  });
});
