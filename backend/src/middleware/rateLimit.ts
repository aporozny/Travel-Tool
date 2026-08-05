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

// Registration specifically: authRateLimit above only counts *failed*
// attempts (right for login -- don't punish typos), but for registration
// the abuse pattern is repeated *successful* signups (mass fake accounts),
// which skipSuccessfulRequests would let straight through. Separate,
// stricter limiter that counts every attempt. Now that signup is open
// (no more invite gate), this gap actually matters.
export const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many accounts created from this network. Try again later.' },
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
