// Cross-source dedup (Risk R5): the same venue fetched from Google and
// Foursquare must appear once. Grouping key: normalized name + geo proximity.
// Viator rows are bookable products, not POIs — never collapsed.

const PROXIMITY_METERS = 150;

// Source priority when the same venue appears in several sources.
const SOURCE_RANK: Record<string, number> = {
	google_places_v2: 4, // curated
	google: 3,
	foursquare: 2,
	viator: 1,
};

export function normalizeName(name: string): string {
	return (name || "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // strip diacritics
		.replace(/\b(the|a|an|restaurant|cafe|hotel|warung|bar)\b/g, "")
		.replace(/[^a-z0-9]/g, "")
		.trim();
}

export function metersApart(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number,
): number {
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLng = ((lng2 - lng1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLng / 2) ** 2;
	return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sameVenue(a: any, b: any): boolean {
	if (normalizeName(a.name) !== normalizeName(b.name)) return false;
	if (a.latitude == null || b.latitude == null) return true; // name-only match
	return (
		metersApart(
			parseFloat(a.latitude),
			parseFloat(a.longitude),
			parseFloat(b.latitude),
			parseFloat(b.longitude),
		) <= PROXIMITY_METERS
	);
}

// Fill gaps in the winning row from duplicate rows (e.g. Google row wins but
// Foursquare had the phone number).
function mergeInto(winner: any, loser: any): any {
	const merged = { ...winner };
	for (const field of ["phone", "website", "description", "price_level"]) {
		if (merged[field] == null && loser[field] != null) {
			merged[field] = loser[field];
		}
	}
	if (
		(!merged.photos || merged.photos.length === 0) &&
		loser.photos?.length > 0
	) {
		merged.photos = loser.photos;
	}
	return merged;
}

export function dedupPlaces(rows: any[]): any[] {
	const out: any[] = [];
	for (const row of rows) {
		if (row.source === "viator") {
			out.push(row); // bookable products always kept as-is
			continue;
		}
		const dupIndex = out.findIndex(
			(r) => r.source !== "viator" && sameVenue(r, row),
		);
		if (dupIndex === -1) {
			out.push(row);
			continue;
		}
		const existing = out[dupIndex];
		const existingRank =
			(existing.is_claimed ? 10 : 0) + (SOURCE_RANK[existing.source] || 0);
		const rowRank = (row.is_claimed ? 10 : 0) + (SOURCE_RANK[row.source] || 0);
		out[dupIndex] =
			rowRank > existingRank
				? mergeInto(row, existing)
				: mergeInto(existing, row);
	}
	return out;
}
