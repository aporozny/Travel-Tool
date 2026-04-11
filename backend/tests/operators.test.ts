import request from 'supertest';
import app from '../src/index';
import { pool } from '../src/utils/db';
import { redis } from '../src/utils/redis';

let operatorToken: string;
let travelerToken: string;
const opEmail = `op_${Date.now()}@example.com`;
const tvEmail = `tv_${Date.now()}@example.com`;

beforeAll(async () => {
  const opRes = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: opEmail, password: 'password123', role: 'operator' });
  operatorToken = opRes.body.accessToken;

  const tvRes = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: tvEmail, password: 'password123', role: 'traveler' });
  travelerToken = tvRes.body.accessToken;
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['op_%@example.com']);
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['tv_%@example.com']);
  await pool.end();
  await redis.quit();
});

describe('GET /api/v1/operators', () => {
  it('returns operator list publicly', async () => {
    const res = await request(app).get('/api/v1/operators');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('filters by region', async () => {
    const res = await request(app).get('/api/v1/operators?region=Nusa+Penida');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/v1/operators', () => {
  it('creates operator listing when authenticated as operator', async () => {
    const res = await request(app)
      .post('/api/v1/operators')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        business_name: 'Test Dive Shop',
        category: 'activity',
        region: 'Nusa Penida',
        description: 'Best diving on the island.',
      });

    expect(res.status).toBe(201);
    expect(res.body.business_name).toBe('Test Dive Shop');
    expect(res.body.tier).toBe('free');
  });

  it('rejects creation when authenticated as traveler', async () => {
    const res = await request(app)
      .post('/api/v1/operators')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ business_name: 'Bad', category: 'food' });

    expect(res.status).toBe(403);
  });

  it('rejects creation without auth', async () => {
    const res = await request(app)
      .post('/api/v1/operators')
      .send({ business_name: 'Bad', category: 'food' });

    expect(res.status).toBe(401);
  });
});
