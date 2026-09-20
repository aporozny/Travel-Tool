import { redis } from "../utils/redis";

// Currency conversion for DISPLAY and SORTING. Providers quote in whatever
// currency their account is set to and none of them can be told otherwise
// (confirmed live for TripGic, 2026-09-20: flight search and the hotel
// search_currency field both ignore any currency request and return the
// account base currency, USD). Duffel quotes AUD, Travelport USD. So a
// merged result list mixes currencies, and Drift has to convert itself.
//
// Rates are the European Central Bank's daily reference rates, via
// frankfurter.dev (free, no key, no SLA). They are indicative mid-market
// rates, updated once per working day. That is fine for showing an
// approximate price and for ordering results; it is NOT what a card is
// charged in. What the traveller is actually charged is decided by the
// provider's currency (Duffel: the offer currency) until Drift has its own
// card processing, so anything converted here is labelled approximate in
// the UI.
//
// Failure handling: fresh rates are cached 12 hours. If the source is down
// the last rates we ever fetched are used (marked with their date). If there
// has never been a successful fetch, no conversion is offered and every
// price stays in its provider currency -- never a guessed rate.

export const SUPPORTED_CURRENCIES = [
	{ code: "AUD", name: "Australian dollar" },
	{ code: "USD", name: "US dollar" },
	{ code: "EUR", name: "Euro" },
	{ code: "GBP", name: "British pound" },
	{ code: "NZD", name: "New Zealand dollar" },
	{ code: "SGD", name: "Singapore dollar" },
	{ code: "CAD", name: "Canadian dollar" },
	{ code: "IDR", name: "Indonesian rupiah" },
	{ code: "JPY", name: "Japanese yen" },
	{ code: "INR", name: "Indian rupee" },
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: SupportedCurrency = "AUD";

export interface RateTable {
	date: string; // the ECB reference date
	rates: Record<string, number>; // per 1 EUR, so rates.EUR === 1
}

export interface DisplayPrice {
	amount: number;
	currency: string;
	approximate: boolean; // false only when no conversion was needed
	rateDate: string | null;
}

const FRESH_KEY = "fx:rates";
const LAST_KEY = "fx:rates:last";
const FRESH_TTL_SECONDS = 12 * 60 * 60;
const MEMO_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const SOURCE_URL = "https://api.frankfurter.dev/v1/latest";

// Zero-decimal currencies: showing cents on rupiah or yen would be noise.
const ZERO_DECIMAL = new Set(["IDR", "JPY", "KRW", "VND"]);

let memo: { table: RateTable; at: number } | null = null;

export function isSupportedCurrency(value: unknown): value is SupportedCurrency {
	return typeof value === "string" && SUPPORTED_CURRENCIES.some((c) => c.code === value);
}

export function parseCurrency(value: unknown): SupportedCurrency | null {
	const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
	return isSupportedCurrency(upper) ? upper : null;
}

// Rate to convert one unit of `from` into `to`, via EUR. Pure, so the maths
// can be tested without any network.
export function crossRate(table: RateTable, from: string, to: string): number | null {
	if (from === to) return 1;
	const f = table.rates[from];
	const t = table.rates[to];
	if (!f || !t || !Number.isFinite(f) || !Number.isFinite(t)) return null;
	return t / f;
}

export function roundFor(amount: number, currency: string): number {
	const decimals = ZERO_DECIMAL.has(currency) ? 0 : 2;
	const factor = 10 ** decimals;
	return Math.round(amount * factor) / factor;
}

export function convert(table: RateTable | null, amount: number, from: string, to: string): number | null {
	if (!Number.isFinite(amount)) return null;
	if (from === to) return roundFor(amount, to);
	if (!table) return null;
	const rate = crossRate(table, from, to);
	return rate == null ? null : roundFor(amount * rate, to);
}

export function toDisplay(table: RateTable | null, amount: number, from: string, to: string): DisplayPrice | null {
	const converted = convert(table, amount, from, to);
	if (converted == null) return null;
	return { amount: converted, currency: to, approximate: from !== to, rateDate: from === to ? null : table?.date ?? null };
}

async function fetchFromSource(): Promise<RateTable> {
	const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`FX source responded ${res.status}`);
	const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
	if (!body.date || !body.rates || typeof body.rates !== "object") throw new Error("FX source returned an unexpected shape");
	const rates: Record<string, number> = { EUR: 1 };
	for (const [code, value] of Object.entries(body.rates)) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) rates[code] = value;
	}
	// Refuse a table that is missing the currencies the app offers: better to
	// fall back to the previous good table than to half-convert.
	for (const c of SUPPORTED_CURRENCIES) {
		if (!rates[c.code]) throw new Error(`FX source is missing ${c.code}`);
	}
	return { date: body.date, rates };
}

async function readCached(key: string): Promise<RateTable | null> {
	try {
		const raw = await redis.get(key);
		return raw ? (JSON.parse(raw) as RateTable) : null;
	} catch {
		return null;
	}
}

export async function getRateTable(): Promise<RateTable | null> {
	if (memo && Date.now() - memo.at < MEMO_MS) return memo.table;

	let table = await readCached(FRESH_KEY);
	if (!table) {
		try {
			table = await fetchFromSource();
			try {
				const json = JSON.stringify(table);
				await redis.set(FRESH_KEY, json, "EX", FRESH_TTL_SECONDS);
				await redis.set(LAST_KEY, json); // no expiry: the fallback of last resort
			} catch (err) {
				console.error("FX rates fetched but could not be cached:", err);
			}
		} catch (err) {
			console.error("FX rate fetch failed, using last known rates if any:", err);
			table = await readCached(LAST_KEY);
		}
	}
	if (table) memo = { table, at: Date.now() };
	return table;
}

// Test hook: forget the in-process copy.
export function resetRateMemo(): void {
	memo = null;
}
