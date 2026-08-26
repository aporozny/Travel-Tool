import { pool } from "../utils/db";

// consent_records is an append-only GDPR-style audit log -- never update a
// row in place, always insert a new one and read the latest. This is the
// first real caller of this table (it existed in schema.sql since the
// start but had zero backend references until Trip Mode).

export async function getLatestConsent(
	userId: string,
	type: string,
): Promise<{ granted: boolean; createdAt: Date } | null> {
	const { rows } = await pool.query(
		`SELECT granted, created_at FROM consent_records
		 WHERE user_id = $1 AND type = $2
		 ORDER BY created_at DESC LIMIT 1`,
		[userId, type],
	);
	if (!rows.length) return null;
	return { granted: rows[0].granted, createdAt: rows[0].created_at };
}

export async function recordConsent(
	userId: string,
	type: string,
	granted: boolean,
): Promise<void> {
	await pool.query(
		`INSERT INTO consent_records (id, user_id, type, granted)
		 VALUES (gen_random_uuid(), $1, $2, $3)`,
		[userId, type, granted],
	);
}
