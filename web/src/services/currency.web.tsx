import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// Currency choice for prices. The providers quote in their own currency
// (Duffel AUD, TripGic and Travelport USD) and cannot be asked for another,
// so Drift converts for display using the ECB's daily rates from
// GET /currencies. What the traveller picks is remembered on this device.
//
// A converted price is always labelled approximate and shows the provider's
// own price beside it, because that is what the booking is actually priced
// in until Drift can charge cards in the traveller's currency. If rates are
// unavailable nothing is converted: every price stays in its own currency.

interface CurrencyInfo { code: string; name: string }
interface Table { currencies: CurrencyInfo[]; default: string; available: boolean; rateDate: string | null; rates: Record<string, number> }

const STORAGE_KEY = 'drift.currency';
const ZERO_DECIMAL = new Set(['IDR', 'JPY', 'KRW', 'VND']);

let table: Table | null = null;
let loading: Promise<void> | null = null;
let chosen: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readStored(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function load(): Promise<void> {
  if (!loading) {
    loading = api.get('/currencies', { timeout: 8000 })
      .then((res) => { table = res.data as Table; })
      .catch(() => { table = null; loading = null; /* try again next mount */ })
      .then(notify);
  }
  return loading;
}

export function convertAmount(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  if (!table?.available) return null;
  const f = table.rates[from];
  const t = table.rates[to];
  if (!f || !t) return null;
  return amount * (t / f);
}

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      minimumFractionDigits: ZERO_DECIMAL.has(currency) ? 0 : 2,
      maximumFractionDigits: ZERO_DECIMAL.has(currency) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export interface PriceParts { main: string; sub: string | null; converted: boolean }

// How to show a price that the provider quoted in `from`.
export function priceParts(amount: number, from: string, to: string | null): PriceParts {
  const own = money(amount, from);
  if (!to || to === from) return { main: own, sub: null, converted: false };
  const value = convertAmount(amount, from, to);
  if (value == null) return { main: own, sub: null, converted: false };
  return { main: `≈ ${money(value, to)}`, sub: `Priced in ${own}`, converted: true };
}

export function useCurrency() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!table) load();
    return () => { listeners.delete(l); };
  }, []);

  if (chosen == null) chosen = readStored();
  const list = table?.currencies ?? [];
  const valid = chosen && list.some((c) => c.code === chosen) ? chosen : null;
  // Until the currency list arrives, or when no rates exist, behave as "own currency".
  const currency = table?.available ? valid ?? table.default : null;

  return {
    currency,
    list,
    ready: !!table?.available,
    rateDate: table?.rateDate ?? null,
    setCurrency: (code: string) => {
      chosen = code;
      try { localStorage.setItem(STORAGE_KEY, code); } catch { /* private mode: fine */ }
      notify();
    },
    parts: (amount: number, from: string) => priceParts(amount, from, currency),
  };
}

// A price, in the traveller's chosen currency where possible.
export function Price({ amount, currency, style, subStyle, align = 'flex-end' }: { amount: number; currency: string; style?: React.CSSProperties; subStyle?: React.CSSProperties; align?: 'flex-start' | 'flex-end' }) {
  const { parts } = useCurrency();
  const p = parts(amount, currency);
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: align, lineHeight: 1.25 }}>
      <span style={style}>{p.main}</span>
      {p.sub && <span style={{ fontSize: 11, color: '#9B9590', fontWeight: 400, ...subStyle }}>{p.sub}</span>}
    </span>
  );
}

// One line, for buttons and sentences: "≈ $279.10 (USD 198.47)".
export function usePriceText() {
  const { parts } = useCurrency();
  return (amount: number, from: string) => {
    const p = parts(amount, from);
    return p.converted ? `${p.main} (${money(amount, from)})` : p.main;
  };
}

// Total of several prices that may be in different currencies, shown in the
// chosen currency where every one can be converted. Null if it cannot be done
// honestly (the caller then lists the prices separately).
export function sumPrices(items: { amount: number; currency: string }[], to: string | null): string | null {
  if (items.length === 0) return null;
  const cur = items[0].currency;
  if (items.every((i) => i.currency === cur)) {
    const total = items.reduce((a, i) => a + i.amount, 0);
    const p = priceParts(total, cur, to);
    return p.converted ? `${p.main} (${money(total, cur)})` : p.main;
  }
  if (!to) return null;
  let sum = 0;
  for (const i of items) {
    const v = convertAmount(i.amount, i.currency, to);
    if (v == null) return null;
    sum += v;
  }
  return `≈ ${money(sum, to)}`;
}

export function CurrencySelect({ style }: { style?: React.CSSProperties }) {
  const { currency, list, ready, setCurrency, rateDate } = useCurrency();
  if (!ready || !currency) return null;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9B9590' }} title={rateDate ? `Indicative rates from ${rateDate}` : undefined}>
      Show prices in
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value)}
        aria-label="Currency"
        style={{ padding: '7px 10px', border: '1.5px solid #F0EDE8', borderRadius: 8, fontSize: 13, background: '#f8f7f4', color: '#1A1A1A', ...style }}
      >
        {list.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
      </select>
    </label>
  );
}
