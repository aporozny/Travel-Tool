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
import { recommendationsRouter } from './routes/recommendations';
import { waitlistRouter, adminRouter } from './routes/waitlist';
import { membersRouter } from './routes/members';
import { messagesRouter } from './routes/messages';
import { photosRouter } from './routes/photos';
import { communityRouter } from './routes/community';
import { discoverRouter } from './routes/discover';
import { offersRouter } from './routes/offers';
import { profileRouter } from './routes/profile';
import { tripsRouter } from './routes/trips';
import { flightsRouter } from './routes/flights';
import { staysRouter } from './routes/stays';
import { tripgicRouter } from './routes/tripgic';
import { currenciesRouter } from './routes/currencies';
import { notificationsRouter } from './routes/notifications';
import { startNotificationWorker } from './services/tripNotificationWorker';
import { startSafetyMonitor } from './services/safetyMonitor';
import { voiceAgentRouter } from './routes/voiceAgent';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { authRateLimit, searchRateLimit, apiRateLimit } from './middleware/rateLimit';
import { authenticate, AuthenticatedRequest } from './middleware/authenticate';

const app = express();
const PORT = process.env.PORT || 5000;

// Security
app.use(helmet());
app.set('trust proxy', 1); // required for rate limiting behind nginx
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
// Photo upload sends the image as base64 in JSON (10 MB image is about 13.4 MB of
// text). Parse that one route with a bigger limit first; body-parser skips a
// request it has already parsed, so every other route keeps the small limit.
app.use('/api/v1/community/upload', express.json({ limit: '14mb' }));
app.use(express.json({ limit: '10kb' })); // prevent large payload attacks
app.use(morgan(process.env.NODE_ENV === 'test' ? 'silent' : 'dev'));

// Rate limiting
app.use('/api/', apiRateLimit);

// Routes
app.use('/health', healthRouter);
// Who is signed in. Only the token survives a page reload, so the web app asks this on
// every load to get the user's role back (operators and admins lost their menus without
// it). Mounted before the auth router so it is not counted by authRateLimit's 10-failures rule.
app.get('/api/v1/auth/me', authenticate, (req: AuthenticatedRequest, res) => {
  res.json({ id: req.user!.id, email: req.user!.email, role: req.user!.role });
});
app.use('/api/v1/auth', authRateLimit, authRouter);
app.use('/api/v1/travelers', travelersRouter);
app.use('/api/v1/operators', operatorsRouter);
app.use('/api/v1/bookings', bookingsRouter);
app.use('/api/v1/safety', safetyRouter);
app.use('/api/v1/reviews', reviewsRouter);
app.use('/api/v1/search', searchRateLimit, searchRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/recommendations', recommendationsRouter);
app.use('/api/v1/waitlist', waitlistRouter);
app.use('/api/v1/admin/waitlist', adminRouter);
app.use('/api/v1/members', membersRouter);
app.use('/api/v1/messages', messagesRouter);
app.use('/api/v1/photos', photosRouter);
app.use('/api/v1/community', communityRouter);
app.use('/api/v1/discover', discoverRouter);
app.use('/api/v1/voice', voiceAgentRouter);
app.use('/api/v1/offers', offersRouter);
app.use('/api/v1/profile', profileRouter);
app.use('/api/v1/trips', tripsRouter);
app.use('/api/v1/flights', flightsRouter);
app.use('/api/v1/stays', staysRouter);
app.use('/api/v1/tripgic', tripgicRouter);
app.use('/api/v1/currencies', currenciesRouter);
app.use('/api/v1/notifications', notificationsRouter);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startNotificationWorker();
    startSafetyMonitor();
  });
}
