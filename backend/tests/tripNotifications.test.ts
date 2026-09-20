import { pool } from '../src/utils/db';
import { segmentsFromTripgicOrder, segmentsFromDuffelOrder } from '../src/services/tripNotifications';
import { isSuppressedRecipient } from '../src/services/tripNotificationWorker';
import { signUnsubscribeToken, verifyUnsubscribeToken } from '../src/services/notificationTokens';
import { renderMessage, type SegmentRow, type RenderInput } from '../src/services/tripContent';
import { presentRequirement } from '../src/services/tripSchedule';

afterAll(async () => {
  await pool.end();
});

// A real return Sydney to Bali booking from the TripGic sandbox (names changed).
const tripgicFlightOrder = {
  id: '33922e82-e9c6-44f7-a585-7ce6a83184a1',
  user_id: '11111111-1111-4111-8111-111111111111',
  product_type: 'flight',
  status: 'held',
  payment_status: 'not_collected_sandbox',
  tripgic_booking_id: 'FL2620SE2JAAHJ',
  supplier_reference: 'RIIBSU',
  details: {
    slices: [
      {
        originAirport: 'SYD', originCity: 'Sydney', destinationAirport: 'DPS', destinationCity: 'Denpasar-Bali Island',
        departingAt: '2026-09-23T20:50:00', arrivingAt: '2026-09-24T21:45:00', stops: 1,
        segments: [{ marketingCarrier: 'AirAsia X', flightNumber: 'D7221' }, { marketingCarrier: 'Air Asia', flightNumber: 'AK374' }],
      },
      {
        originAirport: 'DPS', originCity: 'Denpasar-Bali Island', destinationAirport: 'SYD', destinationCity: 'Sydney',
        departingAt: '2026-10-20T14:05:00', arrivingAt: '2026-10-21T20:20:00', stops: 1,
        segments: [{ marketingCarrier: 'Scoot', flightNumber: 'TR289' }, { marketingCarrier: 'Scoot', flightNumber: 'TR014' }],
      },
    ],
  },
};

describe('trip legs from a TripGic flight booking', () => {
  const legs = segmentsFromTripgicOrder(tripgicFlightOrder);

  it('makes one leg per direction, in order, with the right flights and destination country', () => {
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => `${l.originIata}>${l.destIata}`)).toEqual(['SYD>DPS', 'DPS>SYD']);
    expect(legs[0].flightNumbers).toEqual(['D7221', 'AK374']);
    expect(legs[0].destCountry).toBe('ID');
    expect(legs[1].destCountry).toBe('AU');
    expect(legs[0].reference).toBe('FL2620SE2JAAHJ');
    expect(legs[0].supplierReference).toBe('RIIBSU');
    expect(legs[0].isTest).toBe(true);
  });

  it('turns local times into exact moments using each airport\'s own timezone', () => {
    expect(legs[0].depUtc?.toISOString()).toBe('2026-09-23T10:50:00.000Z'); // Sydney, AEST (+10)
    expect(legs[0].arrUtc?.toISOString()).toBe('2026-09-24T13:45:00.000Z'); // Bali, UTC+8
    expect(legs[1].depUtc?.toISOString()).toBe('2026-10-20T06:05:00.000Z'); // Bali, UTC+8
    expect(legs[1].arrUtc?.toISOString()).toBe('2026-10-21T09:20:00.000Z'); // Sydney, AEDT (+11) after the October clock change
  });

  it('leaves the exact time empty, rather than guessing, when an airport is unknown', () => {
    const odd = segmentsFromTripgicOrder({
      ...tripgicFlightOrder,
      details: { slices: [{ ...tripgicFlightOrder.details.slices[0], originAirport: 'ZZZ' }] },
    });
    expect(odd[0].depUtc).toBeNull();
    expect(odd[0].depTz).toBeNull();
  });
});

describe('trip legs from a TripGic hotel booking', () => {
  const hotel = {
    id: 'aaaa1111-1111-4111-8111-111111111111', user_id: '11111111-1111-4111-8111-111111111111', product_type: 'hotel', status: 'confirmed',
    payment_status: 'not_collected_sandbox', tripgic_booking_id: 'HT2620XYZ', supplier_reference: 'CONF123',
    details: { hotelName: 'Kusuma Resort', address: 'Jl. Arjuna Gg. No. 6, Seminyak, Bali, ID', longitude: 115.168452, checkInDate: '2026-11-15', checkOutDate: '2026-11-18' },
  };

  it('uses Bali time for a Bali stay, with check-in at noon', () => {
    const [stay] = segmentsFromTripgicOrder(hotel);
    expect(stay.kind).toBe('hotel');
    expect(stay.destCountry).toBe('ID');
    expect(stay.depUtc?.toISOString()).toBe('2026-11-15T04:00:00.000Z');
    expect(stay.placeName).toBe('Kusuma Resort');
  });

  it('has no exact time for a country we cannot place, so no reminder can be scheduled', () => {
    const [stay] = segmentsFromTripgicOrder({ ...hotel, details: { ...hotel.details, address: 'Somewhere, TH', longitude: 100.5 } });
    expect(stay.depUtc).toBeNull();
  });
});

describe('trip legs from a Duffel booking', () => {
  const duffel = {
    id: 'bbbb1111-1111-4111-8111-111111111111', user_id: '11111111-1111-4111-8111-111111111111', booking_reference: 'LXNM2D', status: 'confirmed',
    slices: [{
      origin: { iata_code: 'SYD', city_name: 'Sydney', time_zone: 'Australia/Sydney' },
      destination: { iata_code: 'DPS', city_name: 'Denpasar', time_zone: 'Asia/Makassar', iata_country_code: 'ID' },
      segments: [{ departing_at: '2026-11-15T07:55:00', arriving_at: '2026-11-15T11:25:00', marketing_carrier: { name: 'Jetstar', iata_code: 'JQ' }, marketing_carrier_flight_number: '35' }],
    }],
  };

  it('prefers the zone Duffel supplies, builds the flight number with its carrier code, and reports confirmed as ticketed', () => {
    const [leg] = segmentsFromDuffelOrder(duffel);
    expect(leg.flightNumbers).toEqual(['JQ35']);
    expect(leg.depUtc?.toISOString()).toBe('2026-11-14T20:55:00.000Z');
    expect(leg.orderStatus).toBe('ticketed');
    expect(leg.destCountry).toBe('ID');
  });
});

describe('who is never emailed', () => {
  it('blocks reserved test domains, the test-account domain and the sandbox contact', () => {
    for (const e of ['a@example.com', 'a@example.org', 'x@drifttest.com', 'sarah.chen@drifttest.com', 'a@foo.invalid', 'sandbox-test@drifttravel.app']) {
      expect(isSuppressedRecipient(e)).toBe(true);
    }
  });

  it('lets real addresses through', () => {
    for (const e of ['traveller@gmail.com', 'me@drifttravel.app', 'someone@examples.com.au']) {
      expect(isSuppressedRecipient(e)).toBe(false);
    }
  });
});

describe('unsubscribe links', () => {
  const userId = '0b1d289a-84a4-4fbd-9000-a68f1b6b6170';
  beforeAll(() => { process.env.UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret'; });

  it('round-trips for the right user', () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(userId))).toBe(userId);
  });

  it('cannot be forged for another user, nor altered', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const forged = `${signUnsubscribeToken(other).split('.')[0]}.${signUnsubscribeToken(userId).split('.')[1]}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
    expect(verifyUnsubscribeToken(signUnsubscribeToken(userId) + 'x')).toBeNull();
  });

  it('rejects garbage without throwing', () => {
    for (const bad of [undefined, null, '', 'abc', 'a.b', 12345, 'x'.repeat(500), '..', 'bm90LWEtdXVpZA.zzzz']) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });
});

describe('message wording', () => {
  const seg = (over: Partial<SegmentRow> = {}): SegmentRow => ({
    id: 's1', order_id: 'o1', source: 'tripgic', kind: 'flight', leg_index: 0, carrier: 'AirAsia X', flight_numbers: ['D7221', 'AK374'],
    origin_iata: 'SYD', dest_iata: 'DPS', origin_city: 'Sydney', dest_city: 'Denpasar-Bali Island', dest_country: 'ID',
    dep_local: '2026-09-23T20:50:00', arr_local: '2026-09-24T21:45:00', place_name: null, address: null, reference: 'FL2620SE2JAAHJ', is_test: false, ...over,
  });
  const base = (over: Partial<RenderInput> = {}): RenderInput => ({
    type: 'confirmation', segment: seg(), legs: [seg()], orderStatus: 'ticketed', supplierReference: 'RIIBSU', requirements: [],
    manageUrl: 'https://drifttravel.app/', unsubscribeUrl: 'https://drifttravel.app/api/v1/notifications/unsubscribe?token=abc', supportEmail: 'help@drifttravel.app', ...over,
  });

  it('shows the local clock time at the airport and the next-day arrival, unshifted', () => {
    const m = renderMessage(base());
    expect(m.text).toContain('Wed 23 Sep, 20:50');
    expect(m.text).toContain('Thu 24 Sep, 21:45');
    expect(m.text).toContain('D7221, AK374');
    expect(m.text).toContain('FL2620SE2JAAHJ');
    expect(m.text).toContain('RIIBSU');
  });

  it('says a held booking is only reserved, and promises to email again', () => {
    const m = renderMessage(base({ orderStatus: 'held' }));
    expect(m.inApp.title).toBe('Your seats are reserved');
    expect(m.text).toContain('ticket has not been issued yet');
    expect(m.text).toContain("We'll email you again");
  });

  it('labels every part of a sandbox booking as a test', () => {
    const m = renderMessage(base({ segment: seg({ is_test: true }), legs: [seg({ is_test: true })] }));
    expect(m.subject.startsWith('[TEST] ')).toBe(true);
    expect(m.inApp.title.startsWith('[TEST] ')).toBe(true);
    expect(m.text).toContain('TEST booking');
  });

  it('always carries an unsubscribe link and never invents a gate or terminal', () => {
    for (const type of ['confirmation', 'ticketed', 'pre_7d', 'pre_72h', 'pre_24h', 'pre_3h'] as const) {
      const m = renderMessage(base({ type }));
      expect(m.text).toContain('unsubscribe?token=abc');
      expect(m.html).toContain('unsubscribe?token=abc');
      expect(m.text).not.toMatch(/gate\s+[A-Z]?\d+/i);
      expect(m.text).not.toMatch(/terminal\s+\d/i);
      expect(m.text).not.toMatch(/passport (number|no)/i);
    }
  });

  it('points to the official source when there are no entry rules to state', () => {
    const m = renderMessage(base({ type: 'pre_7d' }));
    expect(m.text).toContain('smartraveller.gov.au');
  });

  it('states a checked rule with its source, and only points to the source for an unchecked one', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    const checked = presentRequirement({ rule_key: 'a', title: 'Visa', body: 'Costs IDR 500,000.', source_url: 'https://gov.example/visa', verified_at: '2026-09-20' }, now);
    const unchecked = presentRequirement({ rule_key: 'b', title: 'Arrival card', body: 'Some claim.', source_url: 'https://gov.example/card', verified_at: null }, now);
    const m = renderMessage(base({ type: 'pre_7d', requirements: [checked, unchecked] }));
    expect(m.text).toContain('Costs IDR 500,000.');
    expect(m.text).toContain('https://gov.example/visa');
    expect(m.text).not.toContain('Some claim.');
    expect(m.text).toContain('https://gov.example/card');
  });

  it('names the checklist items in the in-app version of an entry checklist', () => {
    const now = new Date('2026-09-25T00:00:00Z');
    const reqs = [
      presentRequirement({ rule_key: 'a', title: 'Passport validity', body: 'x', source_url: 'https://gov.example/a', verified_at: '2026-09-20' }, now),
      presentRequirement({ rule_key: 'b', title: 'Bali tourist levy', body: 'y', source_url: 'https://gov.example/b', verified_at: '2026-09-20' }, now),
    ];
    const m = renderMessage(base({ type: 'pre_7d', requirements: reqs }));
    expect(m.inApp.body).toBe('Check before you fly: passport validity, bali tourist levy. Confirm each on the official site.');
  });

  it('escapes anything that came from a supplier before it goes into HTML', () => {
    const hotel = seg({ kind: 'hotel', place_name: '<script>alert(1)</script> Villa', address: 'A & B "Street"', origin_iata: null, dest_iata: null, flight_numbers: null, dep_local: '2026-11-15T12:00:00', arr_local: '2026-11-18T11:00:00' });
    const m = renderMessage(base({ type: 'hotel_checkin', segment: hotel, legs: [hotel] }));
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('A &amp; B &quot;Street&quot;');
  });

  it('gives a two-leg trip Outbound and Return labels', () => {
    const back = seg({ leg_index: 1, origin_iata: 'DPS', dest_iata: 'SYD', dep_local: '2026-10-20T14:05:00', arr_local: '2026-10-21T20:20:00', carrier: 'Scoot', flight_numbers: ['TR289', 'TR014'] });
    const m = renderMessage(base({ legs: [seg(), back] }));
    expect(m.text).toContain('Outbound: Wed 23 Sep');
    expect(m.text).toContain('Return: Tue 20 Oct');
    expect(m.subject).toContain('SYD ⇄ DPS');
  });
});
