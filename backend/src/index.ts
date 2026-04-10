import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { travelersRouter } from './routes/travelers';
import { operatorsRouter } from './routes/operators';
import { bookingsRouter } from './routes/bookings';
import { safetyRouter } from './routes/safety';
import { reviewsRouter } from './routes/reviews';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';

const app = express();
const PORT = process.env.PORT || 5000;

// Security & parsing
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/travelers', travelersRouter);
app.use('/api/v1/operators', operatorsRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/safety', safetyRouter);
app.use('/api/v1/reviews', reviewsRouter);

// Error handling
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
