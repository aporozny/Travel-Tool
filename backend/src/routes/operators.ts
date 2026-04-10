import { Router } from 'express';

export const operatorsRouter = Router();

// GET /api/v1/operators
operatorsRouter.get('/', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// GET /api/v1/operators/:id
operatorsRouter.get('/:id', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// POST /api/v1/operators
operatorsRouter.post('/', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});

// PATCH /api/v1/operators/:id
operatorsRouter.patch('/:id', (req, res) => {
  res.status(501).json({ message: 'Not implemented yet' });
});
