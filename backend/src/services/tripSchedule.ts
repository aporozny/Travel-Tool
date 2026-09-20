import { DateTime } from "luxon";
import airportData from "../data/airports.json";

// Pure helpers for trip reminders: airport lookup, local-time to exact-moment
// conversion, and deciding which reminders to schedule and when. No database
// and no clock reads here (callers pass `now`), so all of it is unit tested.

export interface Airport {
	tz: string; // IANA zone, e.g. "Asia/Makassar" (Bali is UTC+8, not Jakarta's UTC+7)
	cc: string; // ISO-2 country
	city: string;
	name: string;
}

// Airport data: mwgg/Airports (MIT), reduced to IATA-keyed rows by
// scripts/build-airports.py. TripGic bookings carry IATA codes but no
// timezone, so this is where the timezone comes from.
const airports = airportData as unknown as Record<string, Airport>;

export function getAirport(iata: string | null | undefined): Airport | null {
	if (!iata) return null;
	return airports[iata.trim().toUpperCase()] ?? null;
}

// "2026-09-23T20:50:00" in "Australia/Sydney" -> the exact instant.
// Null when the zone or the time is not valid: the caller then schedules
// nothing rather than guessing.
export function localToUtc(local: string | null | undefined, zone: string | null | undefined): Date | null {
	if (!local || !zone) return null;
	const dt = DateTime.fromISO(local.trim().replace(" ", "T"), { zone });
	return dt.isValid ? dt.toUTC().toJSDate() : null;
}

// Format a stored local time for a message, without any timezone shifting:
// the stored value already is the time on the clock at that airport.
export function formatLocal(local: string | null | undefined, pattern: string): string {
	if (!local) return "";
	const dt = DateTime.fromISO(local.trim().replace(" ", "T"));
	return dt.isValid ? dt.toFormat(pattern, { locale: "en" }) : local;
}

// Timezone for a hotel, which is stored with coordinates and a country but no
// zone. Only Indonesia is handled (the launch market); anywhere else returns
// null and no reminder is scheduled, which is safer than a wrong time.
// Indonesia's three zones by longitude: WIB (UTC+7) west of about 114.4E,
// WITA (UTC+8, includes Bali) to about 127E, WIT (UTC+9) beyond.
export function hotelZone(countryCode: string | null | undefined, longitude: number | null | undefined): string | null {
	if (countryCode !== "ID" || longitude == null || !Number.isFinite(longitude)) return null;
	if (longitude < 114.4) return "Asia/Jakarta";
	if (longitude < 127) return "Asia/Makassar";
	return "Asia/Jayapura";
}

// ---- which reminders, and when ------------------------------------------

export type ReminderType = "pre_7d" | "pre_72h" | "pre_24h" | "pre_3h" | "hotel_checkin";

interface Rule {
	type: ReminderType;
	leadMs: number; // how long before the reference time it is due
	windowMs: number; // how long after that it is still worth sending
}

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;

const FLIGHT_RULES: Rule[] = [
	{ type: "pre_7d", leadMs: 7 * 24 * HOUR, windowMs: 24 * HOUR },
	{ type: "pre_72h", leadMs: 72 * HOUR, windowMs: 12 * HOUR },
	{ type: "pre_24h", leadMs: 24 * HOUR, windowMs: 6 * HOUR },
	{ type: "pre_3h", leadMs: 3 * HOUR, windowMs: 90 * MINUTE },
];

const HOTEL_RULES: Rule[] = [{ type: "hotel_checkin", leadMs: 4 * HOUR, windowMs: 6 * HOUR }];

export interface PlannedReminder {
	type: ReminderType;
	sendAt: Date;
	expiresAt: Date;
}

// A reminder whose moment has passed but whose window is still open is sent
// right away (booking two hours before departure still gets the "time to
// leave" message). One whose window has closed is dropped, never sent late.
// Nothing is sent for a flight that is about to leave or has left.
export function planReminders(kind: "flight" | "hotel", refUtc: Date | null, now: Date): PlannedReminder[] {
	if (!refUtc) return [];
	const rules = kind === "flight" ? FLIGHT_RULES : HOTEL_RULES;
	const cutoff = kind === "flight" ? refUtc.getTime() - 15 * MINUTE : refUtc.getTime() + 6 * HOUR;
	const planned: PlannedReminder[] = [];
	for (const rule of rules) {
		const due = refUtc.getTime() - rule.leadMs;
		const expires = Math.min(due + rule.windowMs, cutoff);
		if (expires <= now.getTime()) continue;
		planned.push({ type: rule.type, sendAt: new Date(Math.max(due, now.getTime())), expiresAt: new Date(expires) });
	}
	return planned;
}

// ---- entry requirements ------------------------------------------------------

export interface RequirementRow {
	rule_key: string;
	title: string;
	body: string;
	source_url: string;
	verified_at: string | Date | null;
}

export interface PresentedRequirement {
	title: string;
	text: string;
	sourceUrl: string;
	verified: boolean;
}

const STALE_AFTER_DAYS = 90;

// A rule is only stated as fact while a person has checked it within 90 days.
// Otherwise the traveller is told to check the official source; an old or
// never-checked claim is never presented as current.
export function presentRequirement(row: RequirementRow, now: Date): PresentedRequirement {
	const verified = row.verified_at ? new Date(row.verified_at) : null;
	const fresh = !!verified && now.getTime() - verified.getTime() <= STALE_AFTER_DAYS * 24 * HOUR;
	return {
		title: row.title,
		text: fresh ? row.body : `Please check the current official requirements: ${row.title.toLowerCase()}.`,
		sourceUrl: row.source_url,
		verified: fresh,
	};
}
