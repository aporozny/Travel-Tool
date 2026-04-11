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
import { searchRouter } from './routes/search';
import { dashboardRouter } from './routes/dashboard';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'test' ? 'silent' : 'dev'));

app.use('/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/travelers', travelersRouter);
app.use('/api/v1/operators', operatorsRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/safety', safetyRouter);
app.use('/api/v1/reviews', reviewsRouter);
app.use('/api/v1/search', searchRouter);
app.use('/api/v1/dashboard', dashboardRouter);

app.use(notFound);
app.use(errorHandler);

export default app;

// Only start listening when run directly, not when imported by tests
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
