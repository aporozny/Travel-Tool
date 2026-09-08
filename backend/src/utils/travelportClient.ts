// Shared across travelportFlights.ts and travelportStays.ts. Same
// fail-closed default as duffelClient.ts -- throws a clear "not
// configured" error until all four TRAVELPORT_* credentials are set.
//
// Auth is OAuth2 password grant against a sandbox host that differs from
// the API host (auth.pp.travelport.com vs api.pp.travelport.net) --
// confirmed by testing both after Travelport's own docs turned out to be
// inconsistent about which TLD to use. The access token is valid 24h;
// this caches it in memory rather than fetching one per search, same
// discipline Travelport's own docs warn is required.
//
// TVP-PCC-Core (not XAUTH_TRAVELPORT_ACCESSGROUP, despite that being the
// header every Travelport doc and devkit points to) is what actually
// authorizes a request -- confirmed live, 2026-09-08. TRAVELPORT_PCC_CORE
// is currently a shared trial sandbox value (599B_1G), not a dedicated
// production PCC.

const AUTH_URL = "https://auth.pp.travelport.com/oauth/token";
const API_BASE = "https://api.pp.travelport.net";

interface CachedToken {
	accessToken: string;
	expiresAt: number; // ms epoch
}

let cachedToken: CachedToken | null = null;

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} not configured -- Travelport search is inactive`);
	}
	return value;
}

async function fetchNewToken(): Promise<CachedToken> {
	const clientId = requireEnv("TRAVELPORT_CLIENT_ID");
	const clientSecret = requireEnv("TRAVELPORT_CLIENT_SECRET");
	const username = requireEnv("TRAVELPORT_USERNAME");
	const password = requireEnv("TRAVELPORT_PASSWORD");

	const res = await fetch(AUTH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			username,
			password,
			grant_type: "password",
		}),
	});
	if (!res.ok) {
		throw new Error(`Travelport auth failed (${res.status})`);
	}
	const data = (await res.json()) as { access_token: string; expires_in: number };
	return {
		accessToken: data.access_token,
		// Shave 60s off the real expiry so a request in flight can't start
		// against a token that expires mid-request.
		expiresAt: Date.now() + (data.expires_in - 60) * 1000,
	};
}

async function getToken(): Promise<string> {
	if (cachedToken && cachedToken.expiresAt > Date.now()) {
		return cachedToken.accessToken;
	}
	cachedToken = await fetchNewToken();
	return cachedToken.accessToken;
}

// Travelport's error envelope, confirmed live:
// {"ErrorResponse":{"Result":{"Error":[{"Message": "..."}]}}}
interface TravelportErrorBody {
	ErrorResponse?: { Result?: { Error?: { Message?: string }[] } };
}

export async function travelportPost<T>(path: string, body: unknown): Promise<T> {
	const token = await getToken();
	const pccCore = requireEnv("TRAVELPORT_PCC_CORE");

	const res = await fetch(`${API_BASE}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
			"Accept-Encoding": "gzip, deflate",
			"TVP-PCC-Core": pccCore,
		},
		body: JSON.stringify(body),
	});

	const data = (await res.json()) as T & TravelportErrorBody;
	if (!res.ok) {
		const message = data?.ErrorResponse?.Result?.Error?.[0]?.Message ?? `Travelport request failed (${res.status})`;
		throw new Error(`Travelport API error: ${message}`);
	}
	return data;
}
