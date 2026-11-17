import { pool } from "../utils/db";

// Deletes Trip Mode location history once it has expired.
//
// Migration 035 gave location_history an expires_at column (default: 7 days
// after the row is written, set by the database, not by the client), but
// nothing ever deleted the expired rows, so the table kept growing. This job
// does the deleting: once at startup and then every hour.
//
// Deletes run in small batches so one run never holds a long lock on a table
// that Trip Mode writes to every few minutes.
const RUN_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_SIZE = 5000;
// Safety stop: 100 batches is 500,000 rows in one run. Anything left is picked
// up by the next run.
const MAX_BATCHES_PER_RUN = 100;
// Postgres error code for "column does not exist".
const UNDEFINED_COLUMN = "42703";

let running = false;

export async function purgeExpiredLocationHistory(): Promise<number> {
	// Two runs at once would just fight over the same rows.
	if (running) return 0;
	running = true;
	let total = 0;
	try {
		for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
			const res = await pool.query(
				`DELETE FROM location_history
				 WHERE id IN (
				   SELECT id FROM location_history
				   WHERE expires_at < NOW()
				   LIMIT $1
				 )`,
				[BATCH_SIZE],
			);
			const n = res.rowCount ?? 0;
			total += n;
			if (n < BATCH_SIZE) break;
		}
		if (total > 0) {
			console.log("Location retention: deleted " + total + " expired location_history rows");
		}
	} catch (err: any) {
		if (err?.code === UNDEFINED_COLUMN) {
			console.warn(
				"Location retention skipped: location_history.expires_at does not exist. " +
					"Apply backend/src/utils/migrations/035_location_history_retention.sql.",
			);
		} else {
			console.error("Location retention failed:", err?.message ?? err);
		}
	} finally {
		running = false;
	}
	return total;
}

export function startLocationRetention(): void {
	purgeExpiredLocationHistory().catch(() => {});
	const timer = setInterval(() => {
		purgeExpiredLocationHistory().catch(() => {});
	}, RUN_INTERVAL_MS);
	timer.unref();
}
