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
import { photosRouter } from './routes/photos';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { authRateLimit, searchRateLimit, apiRateLimit } from './middleware/rateLimit';

const app = express();
const PORT = process.env.PORT || 5000;

// Security
app.use(helmet());
app.set('trust proxy', 1); // required for rate limiting behind nginx
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10kb' })); // prevent large payload attacks
app.use(morgan(process.env.NODE_ENV === 'test' ? 'silent' : 'dev'));

// Rate limiting
app.use('/api/', apiRateLimit);

// Routes
app.use('/health', healthRouter);
app.use('/api/v1/auth', authRateLimit, authRouter);
app.use('/api/v1/travelers', travelersRouter);
app.use('/api/v1/operators', operatorsRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/safety', safetyRouter);
app.use('/api/v1/reviews', reviewsRouter);
app.use('/api/v1/search', searchRateLimit, searchRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/photos', photosRouter);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
