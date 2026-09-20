import request from 'supertest';
import app from '../src/index';
import { pool } from '../src/utils/db';
import { redis } from '../src/utils/redis';

// Kept in its own file on purpose: /register is limited to 5 attempts per
// hour per app instance, and auth.test.ts already uses all 5.
afterAll(async () => {
  await pool.end();
  await redis.quit();
});

describe('POST /api/v1/auth/register terms consent', () => {
  it('refuses to create an account unless the terms are accepted', async () => {
    const email = `terms_${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'TestPass2026!', role: 'traveler' });

    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    expect(rows).toHaveLength(0);
  });

  it('refuses acceptedTerms values that are not literally true', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: `terms2_${Date.now()}@example.com`, password: 'TestPass2026!', role: 'traveler', acceptedTerms: 'yes' });

    expect(res.status).toBe(400);
  });
});
