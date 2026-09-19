// Shared by tripgicFlights.ts (and any future TripGic hotel/activity
// service). Same fail-closed default as duffelClient.ts and
// travelportClient.ts -- throws a clear "not configured" error until all
// three TRIPGIC_* credentials are set, so an unset env never turns into a
// confusing upstream 401.
//
// Auth is two static request headers, no token exchange: `apikey` and
// `secretecode` (that spelling is literal -- it's what TripGic's OpenAPI
// securitySchemes declare, not a typo here). Confirmed live against their
// sandbox, 2026-09-18.
//
// Every request is bounded by a timeout: TripGic search is called inside a
// Promise.allSettled alongside Duffel and Travelport, so an upstream that
// hangs would otherwise hold the whole flight search response open.

const REQUEST_TIMEOUT_MS = 20000;

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} not configured -- TripGic search is inactive`);
	}
	return value;
}

export async function tripgicPost<T>(path: string, body: unknown): Promise<T> {
	const base = requireEnv("TRIPGIC_API_ENDPOINT").replace(/\/+$/, "");
	const apiKey = requireEnv("TRIPGIC_API_KEY");
	const secretCode = requireEnv("TRIPGIC_SECRET_CODE");

	const res = await fetch(`${base}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			apikey: apiKey,
			secretecode: secretCode,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	let data: unknown;
	try {
		data = await res.json();
	} catch {
		throw new Error(`TripGic API error: non-JSON response (${res.status})`);
	}
	if (!res.ok) {
		throw new Error(`TripGic API error: request failed (${res.status})`);
	}
	return data as T;
}
