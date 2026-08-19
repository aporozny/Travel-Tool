import request from 'supertest';
import app from '../src/index';
import { pool } from '../src/utils/db';
import { redis } from '../src/utils/redis';
import bcrypt from 'bcryptjs';

const testEmail = `test_${Date.now()}@example.com`;
const testPassword = 'TestPass2026!';

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

// Reads the reset token straight out of Redis rather than intercepting the
// email -- forgot-password's response is deliberately generic (no
// enumeration leak), so the token itself is the only way to drive
// reset-password in a real integration test without mocking sendEmail,
// which would depart from this file's real-app/real-db/real-redis style.
async function getResetTokenFor(userId: string): Promise<string> {
  const keys = await redis.keys('password-reset:*');
  for (const key of keys) {
    const value = await redis.get(key);
    if (value === userId) return key.replace('password-reset:', '');
  }
  throw new Error(`no reset token found for user ${userId}`);
}

describe('POST /api/v1/auth/forgot-password', () => {
  it('responds the same way for a registered and an unregistered email -- no enumeration leak', async () => {
    const registered = await request(app).post('/api/v1/auth/forgot-password').send({ email: testEmail });
    const unregistered = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody-at-all@example.com' });

    expect(registered.status).toBe(200);
    expect(unregistered.status).toBe(200);
    expect(registered.body.message).toBe(unregistered.body.message);
  });

  it('actually creates a reset token for a registered email', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: testEmail, password: testPassword });
    const userId = JSON.parse(Buffer.from(loginRes.body.accessToken.split('.')[1], 'base64').toString()).id;

    await request(app).post('/api/v1/auth/forgot-password').send({ email: testEmail });
    const token = await getResetTokenFor(userId);
    expect(token).toBeTruthy();
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  it('rejects an invalid token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'BrandNewPass2026!' });

    expect(res.status).toBe(400);
  });

  it('rejects a common password even with a valid token', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: testEmail, password: testPassword });
    const userId = JSON.parse(Buffer.from(loginRes.body.accessToken.split('.')[1], 'base64').toString()).id;

    await request(app).post('/api/v1/auth/forgot-password').send({ email: testEmail });
    const token = await getResetTokenFor(userId);

    const res = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('resets the password, invalidates the token, and revokes the existing session', async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: testEmail, password: testPassword });
    const oldRefreshToken = loginRes.body.refreshToken;
    const userId = JSON.parse(Buffer.from(loginRes.body.accessToken.split('.')[1], 'base64').toString()).id;

    await request(app).post('/api/v1/auth/forgot-password').send({ email: testEmail });
    const token = await getResetTokenFor(userId);
    const newPassword = 'BrandNewPass2026!';

    const resetRes = await request(app).post('/api/v1/auth/reset-password').send({ token, password: newPassword });
    expect(resetRes.status).toBe(200);

    // Checked directly against the DB/Redis rather than through more HTTP
    // calls to the auth router: this same file's negative-path tests
    // already spend most of authRateLimit's 15-minute budget (it only
    // counts non-2xx responses, but there are several by this point), and
    // these facts are just as conclusively verified at the data layer.
    const dbResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    expect(await bcrypt.compare(testPassword, dbResult.rows[0].password_hash)).toBe(false);
    expect(await bcrypt.compare(newPassword, dbResult.rows[0].password_hash)).toBe(true);

    // Reset revoked the session -- the pre-reset refresh token's Redis
    // entry is gone (or no longer matches).
    const storedRefresh = await redis.get(`refresh:${userId}`);
    expect(storedRefresh).not.toBe(oldRefreshToken);

    // The reset token was consumed -- single-use.
    expect(await redis.get(`password-reset:${token}`)).toBeNull();

    // One real end-to-end proof through the actual login route: the new
    // password genuinely works.
    const newLoginRes = await request(app).post('/api/v1/auth/login').send({ email: testEmail, password: newPassword });
    expect(newLoginRes.status).toBe(200);
  });
});
