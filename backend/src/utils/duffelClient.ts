import { Duffel } from "@duffel/api";

// Shared across flights.ts and stays.ts -- one Duffel client/API key for
// the whole account. Ships inactive: throws a clear "not configured"
// error until DUFFEL_API_KEY is set, same fail-closed default as every
// other credential-gated feature in this codebase (Viator, the voice
// agent).
let client: Duffel | null = null;

export function getDuffelClient(): Duffel {
	if (!process.env.DUFFEL_API_KEY) {
		throw new Error("DUFFEL_API_KEY not configured -- Duffel booking features are inactive");
	}
	if (!client) {
		client = new Duffel({ token: process.env.DUFFEL_API_KEY });
	}
	return client;
}
