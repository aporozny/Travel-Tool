import { Router } from 'express';

export const bookingsRouter = Router();

// POST /api/v1/bookings
bookingsRouter.post('/', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// GET /api/v1/bookings/:id
bookingsRouter.get('/:id', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// PATCH /api/v1/bookings/:id/status
bookingsRouter.patch('/:id/status', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});
