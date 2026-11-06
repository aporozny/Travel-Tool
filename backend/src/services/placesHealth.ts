import axios from "axios";
import { sendReviewerAlert } from "./notifications";

// Proves the Google Places key still works. The key once broke because an IP
// restriction stopped matching this server, and nothing noticed: photos just
// quietly failed. This checks on startup and every 6 hours, keeps the result
// for GET /health/places, and emails the reviewer when the key starts failing.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REALERT_MS = 24 * 60 * 60 * 1000;
// A stable, well-known place, used only to prove the key is accepted.
const PROBE_PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

export interface PlacesHealth {
	ok: boolean;
	checkedAt: string | null;
	status: number | null;
	reason: string | null;
}

let last: PlacesHealth = { ok: true, checkedAt: null, status: null, reason: null };
let lastAlertAt = 0;

export function getPlacesHealth(): PlacesHealth {
	return last;
}

async function notifyOnChange(wasOk: boolean, now: PlacesHealth): Promise<void> {
	if (!now.ok) {
		// A network error (no HTTP status) is not proof the key is bad. Only a
		// Google answer, or a missing key, is worth waking someone for.
		if (now.status === null && process.env.GOOGLE_PLACES_API_KEY) return;
		const t = Date.now();
		if (wasOk || t - lastAlertAt > REALERT_MS) {
			lastAlertAt = t;
			await sendReviewerAlert({
				subject: "Drift: Google Places key is failing",
				body:
					"Photos and place search will not load. Google returned " +
					(now.status ?? "no status") +
					": " +
					now.reason +
					". Check the key restrictions and billing in Google Cloud.",
				urgent: false,
			}).catch(() => {});
		}
	} else if (!wasOk) {
		lastAlertAt = 0;
		await sendReviewerAlert({
			subject: "Drift: Google Places key recovered",
			body: "The Google Places key is working again.",
			urgent: false,
		}).catch(() => {});
	}
}

export async function checkPlacesKey(): Promise<PlacesHealth> {
	const key = process.env.GOOGLE_PLACES_API_KEY;
	const checkedAt = new Date().toISOString();
	let result: PlacesHealth;
	if (!key) {
		result = { ok: false, checkedAt, status: null, reason: "GOOGLE_PLACES_API_KEY is not set" };
	} else {
		try {
			await axios.get("https://places.googleapis.com/v1/places/" + PROBE_PLACE_ID, {
				headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id" },
				timeout: 10000,
			});
			result = { ok: true, checkedAt, status: 200, reason: null };
		} catch (err: any) {
			const status = err?.response?.status ?? null;
			const g = err?.response?.data?.error;
			const reason = g?.details?.[0]?.reason || g?.message || err?.message || "unknown error";
			result = { ok: false, checkedAt, status, reason: String(reason).slice(0, 300) };
		}
	}
	const wasOk = last.ok;
	last = result;
	await notifyOnChange(wasOk, result);
	return result;
}

export function startPlacesHealthCheck(): void {
	checkPlacesKey().catch(() => {});
	const timer = setInterval(() => {
		checkPlacesKey().catch(() => {});
	}, CHECK_INTERVAL_MS);
	timer.unref();
}
