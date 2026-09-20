import { redis } from '../src/utils/redis';
import {
  crossRate,
  roundFor,
  convert,
  toDisplay,
  parseCurrency,
  getRateTable,
  resetRateMemo,
  SUPPORTED_CURRENCIES,
  type RateTable,
} from '../src/services/fx';

const table: RateTable = {
  date: '2026-09-18',
  rates: { EUR: 1, AUD: 1.6, USD: 1.14, IDR: 20300, JPY: 180 },
};

// A source response that has every offered currency, as the real one does.
function sourceBody(date = '2026-09-18') {
  const rates: Record<string, number> = {};
  SUPPORTED_CURRENCIES.forEach((c, i) => {
    rates[c.code] = c.code === 'EUR' ? 1 : 1 + i / 10;
  });
  delete rates.EUR; // the real source omits the base currency
  return { date, rates };
}

const realFetch = global.fetch;

beforeEach(async () => {
  resetRateMemo();
  await redis.del('fx:rates', 'fx:rates:last');
});

afterEach(() => {
  global.fetch = realFetch;
});

afterAll(async () => {
  await redis.del('fx:rates', 'fx:rates:last');
  await redis.quit();
});

describe('cross rates', () => {
  it('converts between two non-EUR currencies through EUR', () => {
    expect(crossRate(table, 'AUD', 'USD')).toBeCloseTo(1.14 / 1.6, 10);
    expect(crossRate(table, 'USD', 'AUD')).toBeCloseTo(1.6 / 1.14, 10);
  });

  it('is 1 for the same currency, and null when a currency is unknown', () => {
    expect(crossRate(table, 'AUD', 'AUD')).toBe(1);
    expect(crossRate(table, 'AUD', 'BDT')).toBeNull();
    expect(crossRate(table, 'XXX', 'USD')).toBeNull();
  });

  it('round-trips within rounding', () => {
    const there = convert(table, 100, 'AUD', 'USD') as number;
    const back = convert(table, there, 'USD', 'AUD') as number;
    expect(Math.abs(back - 100)).toBeLessThan(0.02);
  });
});

describe('rounding', () => {
  it('uses no decimals for rupiah and yen, two for everything else', () => {
    expect(roundFor(1234567.891, 'IDR')).toBe(1234568);
    expect(roundFor(1234.5, 'JPY')).toBe(1235);
    expect(roundFor(12.3456, 'USD')).toBe(12.35);
  });
});

describe('display price', () => {
  it('is exact, not approximate, when no conversion is needed', () => {
    expect(toDisplay(table, 161, 'USD', 'USD')).toEqual({ amount: 161, currency: 'USD', approximate: false, rateDate: null });
  });

  it('is marked approximate and carries the rate date when converted', () => {
    const d = toDisplay(table, 198.47, 'USD', 'AUD');
    expect(d).toMatchObject({ currency: 'AUD', approximate: true, rateDate: '2026-09-18' });
    expect(d!.amount).toBeCloseTo(198.47 * (1.6 / 1.14), 1);
  });

  it('offers nothing rather than a guess when there is no rate table', () => {
    expect(toDisplay(null, 100, 'USD', 'AUD')).toBeNull();
    expect(toDisplay(null, 100, 'USD', 'USD')).not.toBeNull();
  });

  it('orders mixed-currency fares by real cost, not by the raw number', () => {
    // TripGic USD 198.47 vs Duffel AUD 215.11: 198.47 < 215.11 as numbers,
    // but USD 198.47 is about AUD 279, so the Duffel fare is the cheaper one.
    const inEur = (amount: number, cur: string) => convert(table, amount, cur, 'EUR') as number;
    expect(inEur(198.47, 'USD')).toBeGreaterThan(inEur(215.11, 'AUD'));
  });
});

describe('currency input', () => {
  it('accepts only offered currencies, case-insensitively', () => {
    expect(parseCurrency('aud')).toBe('AUD');
    expect(parseCurrency(' idr ')).toBe('IDR');
    expect(parseCurrency('XXX')).toBeNull();
    expect(parseCurrency(undefined)).toBeNull();
    expect(parseCurrency('AUD; DROP TABLE')).toBeNull();
  });
});

describe('rate table loading', () => {
  it('fetches, adds EUR itself, and reuses the cache instead of refetching', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => sourceBody() });
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await getRateTable();
    expect(first?.date).toBe('2026-09-18');
    expect(first?.rates.EUR).toBe(1);
    expect(first?.rates.AUD).toBeGreaterThan(0);

    resetRateMemo(); // force the Redis path, not the in-process copy
    const second = await getRateTable();
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last known rates when the source is down', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => sourceBody('2026-09-10') }) as unknown as typeof fetch;
    await getRateTable();

    resetRateMemo();
    await redis.del('fx:rates'); // the fresh copy expires, the last-known copy stays
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const table2 = await getRateTable();
    expect(table2?.date).toBe('2026-09-10');
  });

  it('returns null, never a made-up table, when there is no source and no history', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    expect(await getRateTable()).toBeNull();
  });

  it('rejects a source response that is missing an offered currency', async () => {
    const bad = sourceBody();
    delete (bad.rates as Record<string, number>).IDR;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => bad }) as unknown as typeof fetch;
    expect(await getRateTable()).toBeNull();
  });

  it('rejects a non-200 from the source', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as unknown as typeof fetch;
    expect(await getRateTable()).toBeNull();
  });
});
