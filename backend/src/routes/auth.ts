import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { pool } from '../utils/db';
import { redis } from '../utils/redis';
import { registerRateLimit } from '../middleware/rateLimit';
import { sendEmail } from '../services/notifications';
import { recordConsent } from '../services/consent';

export const authRouter = Router();

// Bump whenever the published Terms/Privacy draft materially changes --
// existing acceptances stay valid for their own version; this is an
// append-only log (consent.ts), never a value that gets overwritten.
const TERMS_VERSION = 'terms_of_service_v0.2';

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789',
  'qwerty123', 'iloveyou', 'admin123', 'letmein1', 'welcome1',
]);

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(100),
  role: z.enum(['traveler', 'operator']),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms of Service and Privacy Policy to create an account.' }),
  }),
}).superRefine((data, ctx) => {
  const lower = data.password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'Password is too common. Choose something more unique.' });
  }
  if (lower.includes(data.email.toLowerCase())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'Password cannot contain your email address.' });
  }
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string(),
});

function generateTokens(userId: string, email: string, role: string) {
  const accessToken = jwt.sign(
    { id: userId, email, role },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' }
  );
  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET as string,
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

// POST /api/v1/auth/register
authRouter.post('/register', registerRateLimit, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const body = registerSchema.parse(req.body);

    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1',
      [body.email]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const userId = uuidv4();

    await client.query(
      'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [userId, body.email, passwordHash, body.role]
    );

    if (body.role === 'traveler') {
      await client.query(
        'INSERT INTO travelers (id, user_id) VALUES ($1, $2)',
        [uuidv4(), userId]
      );
    }

    await client.query('COMMIT');

    // Best-effort, outside the registration transaction -- the user row is
    // already committed, and consent_records is an append-only audit log
    // (see consent.ts), not something registration should roll back over.
    recordConsent(userId, TERMS_VERSION, true).catch((err) =>
      console.error('Failed to record terms acceptance for', userId, err)
    );

    const { accessToken, refreshToken } = generateTokens(userId, body.email, body.role);
    await redis.setex(`refresh:${userId}`, 60 * 60 * 24 * 7, refreshToken);

    return res.status(201).json({
      user: { id: userId, email: body.email, role: body.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/v1/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);

    const result = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1 AND is_active = true',
      [body.email]
    );

    // Always run bcrypt even if user not found to prevent timing attacks
    const dummyHash = '$2a$12$dummy.hash.to.prevent.timing.attacks.padding.here';
    const hash = result.rows[0]?.password_hash || dummyHash;
    const valid = await bcrypt.compare(body.password, hash);

    if (result.rows.length === 0 || !valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.id, user.email, user.role);
    await redis.setex(`refresh:${user.id}`, 60 * 60 * 24 * 7, refreshToken);

    return res.json({
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Refresh token required' });
    }

    // Verify signature before trusting payload
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET as string
    ) as { id: string };

    const stored = await redis.get(`refresh:${decoded.id}`);
    if (!stored || stored !== refreshToken) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const userResult = await pool.query(
      'SELECT id, email, role FROM users WHERE id = $1 AND is_active = true',
      [decoded.id]
    );
    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.email, user.role);
    await redis.setex(`refresh:${user.id}`, 60 * 60 * 24 * 7, newRefreshToken);

    return res.json({ accessToken, refreshToken: newRefreshToken });
  } catch {
    return res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
});

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
});

// POST /api/v1/auth/forgot-password
// Always responds the same way whether or not the email is registered --
// confirming/denying account existence here is a user-enumeration leak.
// The reset token lives in Redis with a TTL instead of a DB table: it's
// exactly the "short-lived, self-expiring, single-use" shape Redis is
// already used for elsewhere in this codebase (location cache, refresh
// sessions), and needs no migration.
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const body = forgotPasswordSchema.parse(req.body);

    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND is_active = true',
      [body.email]
    );

    if (result.rows.length > 0) {
      const userId = result.rows[0].id;
      const token = crypto.randomBytes(32).toString('hex');
      await redis.setex(`password-reset:${token}`, 60 * 60, userId); // 1 hour

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
      sendEmail(
        body.email,
        'Reset your Drift password',
        `Someone (hopefully you) requested a password reset for your Drift account.\n\n` +
          `Reset it here: ${resetUrl}\n\n` +
          `This link expires in 1 hour and can only be used once. If you didn't request this, you can ignore this email -- your password hasn't been changed.`
      ).catch((err) => console.error('forgot-password email failed:', err));
    }

    return res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(100),
}).superRefine((data, ctx) => {
  const lower = data.password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: 'Password is too common. Choose something more unique.' });
  }
});

// POST /api/v1/auth/reset-password
// Deletes the reset token on use (single-use) and the user's stored
// refresh session (`refresh:${userId}`) on success -- a password reset
// should end any session an attacker might already hold, the same reason
// changing your password logs you out everywhere on most real services.
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const body = resetPasswordSchema.parse(req.body);

    const userId = await redis.get(`password-reset:${body.token}`);
    if (!userId) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

    await redis.del(`password-reset:${body.token}`);
    await redis.del(`refresh:${userId}`);

    return res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: err.errors });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/auth/logout
authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      // Use verify not decode to prevent crafted payloads
      try {
        const decoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET as string
        ) as { id: string };
        await redis.del(`refresh:${decoded.id}`);
      } catch {
        // Token invalid - that's fine, just ignore
      }
    }
    return res.status(204).send();
  } catch {
    return res.status(204).send();
  }
});
