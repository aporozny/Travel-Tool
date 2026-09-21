import { DuffelError } from '@duffel/api';
import {
  MAX_ORDER_ATTEMPTS, normalizePhone, passengerInputSchema, validatePassengersForOffer, paymentCoversPrice,
  OrderPlacementError, classifyOrderError, describeError, canRetryAfter, needsRefund, travellerMessage, type OrderFailureCode,
} from '../src/services/flightPaymentRules';

const duffelError = (status: number, code: string, message = 'x', type = 'invalid_request_error') =>
  new DuffelError({
    meta: { status, request_id: 'req_1' } as any,
    errors: [{ code, type, message, title: message, documentation_url: '' } as any],
    headers: new Headers() as any,
  });

describe('phone numbers', () => {
  it('accepts international numbers and strips spacing', () => {
    expect(normalizePhone('+61 412 345 678')).toBe('+61412345678');
    expect(normalizePhone('+61-412-345-678')).toBe('+61412345678');
    expect(normalizePhone('+1 (415) 555-0100')).toBe('+14155550100');
  });

  it('refuses anything that is not international, before the card is charged', () => {
    for (const bad of ['12345', '0412345678', '61412345678', '+61', '+abc123456', '', '+1234567890123456']) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });
});

describe('passenger input', () => {
  const good = { id: 'pas_1', title: 'mr', gender: 'm', givenName: ' Sam ', familyName: 'Lee', bornOn: '1990-02-03', email: 'sam@example.com', phoneNumber: '+61 412 345 678' };

  it('cleans up a good passenger', () => {
    const p = passengerInputSchema.parse(good);
    expect(p.phoneNumber).toBe('+61412345678');
    expect(p.givenName).toBe('Sam');
  });

  it('gives a clear message for a bad phone number', () => {
    const r = passengerInputSchema.safeParse({ ...good, phoneNumber: '12345' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.errors[0].message).toMatch(/international/);
  });

  it('rejects a bad email, date and empty names', () => {
    for (const bad of [{ email: 'nope' }, { bornOn: '03/02/1990' }, { givenName: '   ' }, { familyName: '' }, { title: 'dr' }]) {
      expect(passengerInputSchema.safeParse({ ...good, ...bad }).success).toBe(false);
    }
  });
});

describe('passengers must match the fare', () => {
  it('accepts exactly the passengers the fare was priced for', () => {
    expect(validatePassengersForOffer([{ id: 'a' }, { id: 'b' }], ['b', 'a'])).toBeNull();
  });

  it('refuses a missing, extra, unknown or repeated passenger', () => {
    expect(validatePassengersForOffer([{ id: 'a' }], ['a', 'b'])).toMatch(/2 passengers/);
    expect(validatePassengersForOffer([{ id: 'a' }, { id: 'b' }], ['a'])).toMatch(/1 passenger/);
    expect(validatePassengersForOffer([{ id: 'a' }, { id: 'zzz' }], ['a', 'b'])).toMatch(/does not belong/);
    expect(validatePassengersForOffer([{ id: 'a' }, { id: 'a' }], ['a', 'b'])).toMatch(/twice/);
  });
});

describe('does the payment cover the price', () => {
  it('compares in whole cents', () => {
    expect(paymentCoversPrice(250, 250)).toBe(true);
    expect(paymentCoversPrice(250.01, 250)).toBe(true);
    expect(paymentCoversPrice(249.99, 250)).toBe(false);
    expect(paymentCoversPrice(0.1 + 0.2, 0.3)).toBe(true); // floating point noise must not refuse a fair booking
    expect(paymentCoversPrice(100, 100.004)).toBe(true); // under half a cent rounds away
  });
});

describe('why an order failed', () => {
  it('passes our own failure codes straight through', () => {
    expect(classifyOrderError(new OrderPlacementError('price_changed'))).toBe('price_changed');
    expect(classifyOrderError(new OrderPlacementError('unrecorded_order', 'db down', 'ord_1'))).toBe('unrecorded_order');
  });

  it('reads Duffel errors', () => {
    expect(classifyOrderError(duffelError(422, 'offer_no_longer_available'))).toBe('fare_expired');
    expect(classifyOrderError(duffelError(422, 'offer_expired'))).toBe('fare_expired');
    expect(classifyOrderError(duffelError(422, 'x', 'This offer has already been booked'))).toBe('fare_expired');
    expect(classifyOrderError(duffelError(422, 'insufficient_balance', 'Not enough balance'))).toBe('supplier_balance');
    expect(classifyOrderError(duffelError(422, 'invalid_phone_number', 'phone'))).toBe('passenger_details');
    expect(classifyOrderError(duffelError(400, 'validation_error'))).toBe('passenger_details');
    expect(classifyOrderError(duffelError(500, 'internal'))).toBe('temporary');
    expect(classifyOrderError(duffelError(503, 'unavailable_service'))).toBe('temporary'); // a 5xx is not the fare being gone
    expect(classifyOrderError(duffelError(404, 'not_found', 'Resource not found'))).toBe('fare_expired'); // the fare lookup found nothing
    expect(classifyOrderError(duffelError(401, 'authentication_error'))).toBe('temporary'); // our own login problem, not the passenger's
    expect(classifyOrderError(duffelError(403, 'forbidden'))).toBe('temporary');
    expect(classifyOrderError(duffelError(429, 'rate_limit_error'))).toBe('temporary');
  });

  it('treats anything unknown as a temporary hiccup', () => {
    expect(classifyOrderError(new Error('socket hang up'))).toBe('temporary');
    expect(classifyOrderError('weird')).toBe('temporary');
    expect(classifyOrderError(undefined)).toBe('temporary');
  });
});

describe('the reason kept for the owner', () => {
  it('reads Duffel errors, whose own message is empty', () => {
    expect(describeError(duffelError(422, 'offer_no_longer_available', 'Gone'))).toBe('HTTP 422: offer_no_longer_available: Gone');
    expect(describeError(new Error('socket hang up'))).toBe('socket hang up');
    expect(describeError('plain text')).toBe('plain text');
  });
});

describe('retry and refund decisions', () => {
  it('lets the traveller retry only what a retry can fix, and only a few times', () => {
    expect(canRetryAfter('temporary', 1)).toBe(true);
    expect(canRetryAfter('passenger_details', 2)).toBe(true);
    expect(canRetryAfter('temporary', MAX_ORDER_ATTEMPTS)).toBe(false);
    for (const code of ['fare_expired', 'price_changed', 'unrecorded_order', 'stuck'] as OrderFailureCode[]) {
      expect(canRetryAfter(code, 1)).toBe(false);
    }
  });

  it('says a refund is needed when a retry can never work, or when tries run out', () => {
    expect(needsRefund('fare_expired', 1)).toBe(true);
    expect(needsRefund('price_changed', 1)).toBe(true);
    expect(needsRefund('temporary', 1)).toBe(false);
    expect(needsRefund('temporary', MAX_ORDER_ATTEMPTS)).toBe(true);
    expect(needsRefund('unrecorded_order', 1)).toBe(false); // the booking exists: finish it, do not refund
  });
});

describe('what the traveller is told', () => {
  const codes: OrderFailureCode[] = ['fare_expired', 'price_changed', 'passenger_details', 'supplier_balance', 'temporary', 'unrecorded_order', 'stuck'];

  it('always says the money is safe (or that the booking exists), in plain words', () => {
    for (const code of codes) {
      for (const attempts of [1, MAX_ORDER_ATTEMPTS]) {
        const m = travellerMessage(code, attempts);
        expect(m).toMatch(/payment is safe|booking was placed/i);
        expect(m).not.toMatch(/undefined|null|error code|ECONN|stack/i);
      }
    }
  });

  it('promises a refund exactly when one is needed', () => {
    expect(travellerMessage('fare_expired', 1)).toMatch(/refund it in full/);
    expect(travellerMessage('price_changed', 1)).toMatch(/refund it in full/);
    expect(travellerMessage('temporary', 1)).not.toMatch(/refund/);
    expect(travellerMessage('temporary', MAX_ORDER_ATTEMPTS)).toMatch(/refund you in full/);
  });

  it('tells the traveller not to pay again when the booking exists', () => {
    expect(travellerMessage('unrecorded_order', 1)).toMatch(/do not pay again/i);
  });
});
