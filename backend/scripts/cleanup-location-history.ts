import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../src/utils/db';
import { redis } from '../src/utils/redis';

// Runs on a schedule (VPS crontab, not in-process) -- location_history had
// no expires_at and no cleanup job until migration 035, despite a comment
// in the old schema.sql reference file implying 30-day auto-delete
// existed. It didn't. This is the actual cleanup job.

async function main() {
  const { rowCount } = await pool.query(`DELETE FROM location_history WHERE expires_at < NOW()`);
  console.log(`cleanup-location-history: deleted ${rowCount} expired row(s)`);
  await pool.end();
  // ioredis keeps a persistent auto-reconnecting connection open -- without
  // this the process never exits (same fix already applied in
  // resolve-sub-areas.ts, after hung hourly-cron processes were found on
  // the VPS).
  redis.disconnect();
}

main().catch((err) => {
  console.error('cleanup-location-history failed:', err);
  process.exit(1);
});
