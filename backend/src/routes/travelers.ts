import { Router } from 'express';

export const travelersRouter = Router();

// GET /api/v1/travelers/me
travelersRouter.get('/me', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// PATCH /api/v1/travelers/me
travelersRouter.patch('/me', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// GET /api/v1/travelers/me/preferences
travelersRouter.get('/me/preferences', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// PUT /api/v1/travelers/me/preferences
travelersRouter.put('/me/preferences', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});
