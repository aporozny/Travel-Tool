// Trip dates. member_trips.start_date and end_date are DATE columns, but the
// safety trip form sends "2026-11-01" while the API demanded a full ISO
// datetime, so planning a trip failed every time. Accept either and store the
// calendar date exactly as written: converting "2026-11-01T00:00:00+10:00" to
// UTC first would move it to the previous day for anyone in Australia.

export function isTripDate(value: string): boolean {
	return toTripDate(value) !== null;
}

export function toTripDate(value: string): string | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
	if (!m) return null;
	const y = +m[1], mo = +m[2], d = +m[3];
	const check = new Date(Date.UTC(y, mo - 1, d));
	// Reject 2026-02-31 and similar: the Date constructor would roll it over.
	if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
	return `${m[1]}-${m[2]}-${m[3]}`;
}
