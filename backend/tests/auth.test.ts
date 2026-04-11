import request from 'supertest';
import app from '../src/index';
import { pool } from '../src/utils/db';
import { redis } from '../src/utils/redis';

const testEmail = `test_${Date.now()}@example.com`;
const testPassword = 'testpassword123';

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['test_%@example.com']);
  await pool.end();
  await redis.quit();
});

describe('POST /api/v1/auth/register', () => {
  it('registers a new traveler', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail, password: testPassword, role: 'traveler' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.role).toBe('traveler');
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: testEmail, password: testPassword, role: 'traveler' });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Email already registered');
  });

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: testPassword, role: 'traveler' });

    expect(res.status).toBe(400);
  });

  it('rejects short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.com', password: 'short', role: 'traveler' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid role', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new2@example.com', password: testPassword, role: 'admin' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('rejects unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: testPassword });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('issues new tokens with valid refresh token', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('rejects invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' });

    expect(res.status).toBe(401);
  });
});
