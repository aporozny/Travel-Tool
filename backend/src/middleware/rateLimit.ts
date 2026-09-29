import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

// Per signed-in member rather than per IP, so one busy network (a hostel,
// a campus) does not share a budget and one account cannot spread abuse
// across IPs. Put it AFTER authenticate; falls back to the IP if no user.
export function perUserRateLimit(opts: { windowMs: number; max: number; message: string }) {
  return rateLimit({
    windowMs: opts.windowMs,
    max: opts.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: opts.message },
    keyGenerator: (req: Request) => {
      const id = (req as Request & { user?: { id: string } }).user?.id;
      return id ? `user:${id}` : ipKeyGenerator(req.ip ?? '');
    },
  });
}

const HOUR = 60 * 60 * 1000;
export const postCreateRateLimit = perUserRateLimit({ windowMs: HOUR, max: 10, message: 'You are posting very quickly. Try again in a while.' });
export const commentCreateRateLimit = perUserRateLimit({ windowMs: HOUR, max: 30, message: 'You are commenting very quickly. Try again in a while.' });
export const uploadRateLimit = perUserRateLimit({ windowMs: HOUR, max: 20, message: 'Too many photo uploads. Try again in a while.' });
export const reportRateLimit = perUserRateLimit({ windowMs: HOUR, max: 20, message: 'Too many reports. Try again in a while.' });

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
