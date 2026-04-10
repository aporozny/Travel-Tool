import { Router } from 'express';

export const safetyRouter = Router();

// POST /api/v1/safety/location
safetyRouter.post('/location', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// GET /api/v1/safety/location/history
safetyRouter.get('/location/history', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /api/v1/safety/contacts
safetyRouter.post('/contacts', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// GET /api/v1/safety/contacts
safetyRouter.get('/contacts', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /api/v1/safety/sos
safetyRouter.post('/sos', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});
