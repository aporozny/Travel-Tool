import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../utils/db';
import { redis } from '../utils/redis';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['traveler', 'operator']),
});

const loginSchema = z.object({
  email: z.string().email(),
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
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);

    // Check if email already exists
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [body.email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const userId = uuidv4();

    // Create user
    await pool.query(
      'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)',
      [userId, body.email, passwordHash, body.role]
    );

    // Create profile record
    if (body.role === 'traveler') {
      await pool.query(
        'INSERT INTO travelers (id, user_id) VALUES ($1, $2)',
        [uuidv4(), userId]
      );
    }

    const { accessToken, refreshToken } = generateTokens(userId, body.email, body.role);

    // Store refresh token in Redis (7 days)
    await redis.setex(`refresh:${userId}`, 60 * 60 * 24 * 7, refreshToken);

    return res.status(201).json({
      user: { id: userId, email: body.email, role: body.role },
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

// POST /api/v1/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);

    const result = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1 AND is_active = true',
      [body.email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(body.password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

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

// POST /api/v1/auth/logout
authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const decoded = jwt.decode(refreshToken) as { id: string } | null;
      if (decoded?.id) {
        await redis.del(`refresh:${decoded.id}`);
      }
    }
    return res.status(204).send();
  } catch {
    return res.status(204).send();
  }
});
