import rateLimit from 'express-rate-limit';

// Auth endpoints - strict: 10 attempts per 15 min per IP
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true, // only count failures
});

// Search - generous but bounded: 60 per minute per IP
export const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many search requests. Slow down.' },
});

// General API - 300 per minute per IP
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests.' },
});
