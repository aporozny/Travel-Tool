import request from 'supertest';
import app from '../src/index';
import { pool } from '../src/utils/db';
import { redis } from '../src/utils/redis';

afterAll(async () => {
  await pool.end();
  await redis.quit();
});

// Malformed percent-encoding used to throw inside the async handler, which crashed
// the whole server. Every one of these must be a clean 400 and the process must survive.
describe('GET /api/v1/photos with a malformed reference', () => {
  it.each(['%25', '%', '%E0%A4%A', 'abc%zz'])('answers 400 for ref=%s and keeps serving', async (ref) => {
    const res = await request(app).get(`/api/v1/photos?ref=${ref}`);
    expect(res.status).toBe(400);
    const after = await request(app).get('/health');
    expect(after.status).toBe(200);
  });

  it('still refuses a missing reference and characters outside the allowed set', async () => {
    expect((await request(app).get('/api/v1/photos')).status).toBe(400);
    expect((await request(app).get('/api/v1/photos?ref=a b<script>')).status).toBe(400);
  });
});
