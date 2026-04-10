import { Router } from 'express';

export const authRouter = Router();

// POST /api/v1/auth/register
authRouter.post('/register', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /api/v1/auth/login
authRouter.post('/login', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /api/v1/auth/refresh
authRouter.post('/refresh', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /api/v1/auth/logout
authRouter.post('/logout', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});
