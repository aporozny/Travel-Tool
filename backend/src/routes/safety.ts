import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { redis } from '../utils/redis';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';
import { sendSOSAlert } from '../services/notifications';
import { getLatestConsent, recordConsent } from '../services/consent';
import { upsertPresence, removePresence } from '../utils/geoPresence';

export const safetyRouter = Router();

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  timestamp: z.number().optional(),
});

const tripModeSchema = z.object({
  enabled: z.boolean(),
});

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  relationship: z.string().max(50).optional(),
  can_see_location: z.boolean().default(true),
  receives_sos: z.boolean().default(true),
  notify_on_overdue: z.boolean().default(true),
  notify_on_sos: z.boolean().default(true),
});

const sosSchema = z.object({
  message: z.string().max(500).optional(),
});

safetyRouter.post('/location', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'traveler') {
      return res.status(403).json({ message: 'Only travelers can submit location updates' });
    }

    const consent = await getLatestConsent(req.user!.id, 'location_tracking');
    if (!consent?.granted) {
      return res.status(403).json({ message: 'Location consent required. Enable Trip Mode to grant consent.' });
    }

    const body = locationSchema.parse(req.body);
    const recordedAt = body.timestamp
      ? new Date(body.timestamp * 1000).toISOString()
      : new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO location_history (id, user_id, lat, lng, accuracy_m, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
       RETURNING id, created_at AS recorded_at`,
      [req.user!.id, body.latitude, body.longitude, body.accuracy ?? null, recordedAt]
    );

    await upsertPresence(req.user!.id, body.latitude, body.longitude, recordedAt);

    return res.status(201).json({ id: result.rows[0].id, recorded_at: result.rows[0].recorded_at });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

safetyRouter.get('/location/history', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { from, to, limit = '50' } = req.query;
    let query = `
      SELECT id, lng AS longitude, lat AS latitude, accuracy_m AS accuracy, created_at AS recorded_at
      FROM location_history
      WHERE user_id = $1
    `;
    const params: any[] = [req.user!.id];
    let pc = 2;
    if (from) { query += ` AND created_at >= $${pc}`; params.push(from); pc++; }
    if (to) { query += ` AND created_at <= $${pc}`; params.push(to); pc++; }
    query += ` ORDER BY created_at DESC LIMIT $${pc}`;
    params.push(Math.min(parseInt(limit as string), 200));

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/safety/location/trip-mode — the actual on/off toggle.
// Turning it on just records consent (POST /location does the real
// gating on every ping); turning it off records the revocation AND
// immediately purges the Redis presence entry, so opt-out doesn't wait
// on the 24h cache TTL.
safetyRouter.post('/location/trip-mode', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { enabled } = tripModeSchema.parse(req.body);
    await recordConsent(req.user!.id, 'location_tracking', enabled);
    if (!enabled) {
      await removePresence(req.user!.id);
    }
    return res.json({ enabled });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

safetyRouter.post('/contacts', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'traveler') return res.status(403).json({ message: 'Only travelers can add safety contacts' });
    const body = contactSchema.parse(req.body);
    if (!body.email && !body.phone) return res.status(400).json({ message: 'Contact must have an email or phone number' });

    const result = await pool.query(
      `INSERT INTO safety_contacts (id, user_id, name, email, phone, relationship, can_see_location, receives_sos, notify_on_overdue, notify_on_sos)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, email, phone, relationship, can_see_location, receives_sos, notify_on_overdue, notify_on_sos, created_at`,
      [req.user!.id, body.name, body.email ?? null, body.phone ?? null, body.relationship ?? null,
       body.can_see_location, body.receives_sos, body.notify_on_overdue, body.notify_on_sos]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

safetyRouter.get('/contacts', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, relationship,
              can_see_location, receives_sos, notify_on_overdue, notify_on_sos, created_at
       FROM safety_contacts
       WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user!.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

safetyRouter.delete('/contacts/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `DELETE FROM safety_contacts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user!.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Contact not found' });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

safetyRouter.post('/sos', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'traveler') return res.status(403).json({ message: 'Only travelers can trigger SOS' });
    const body = sosSchema.parse(req.body);

    const cachedLocation = await redis.get(`location:${req.user!.id}`);
    let locationData: { latitude: number; longitude: number; recorded_at: string } | null = null;
    if (cachedLocation) locationData = JSON.parse(cachedLocation);

    const contactsResult = await pool.query(
      `SELECT id, name, email, phone
       FROM safety_contacts
       WHERE user_id = $1 AND receives_sos = true`,
      [req.user!.id]
    );
    const contacts = contactsResult.rows;

    // Get traveler name for notification
    const travelerResult = await pool.query(
      `SELECT t.first_name, t.last_name, u.email
       FROM travelers t JOIN users u ON u.id = t.user_id
       WHERE t.user_id = $1`,
      [req.user!.id]
    );
    const traveler = travelerResult.rows[0];
    const travelerName = [traveler?.first_name, traveler?.last_name].filter(Boolean).join(' ') || traveler?.email;

    const sosResult = await pool.query(
      `INSERT INTO sos_events (id, user_id, trigger_type, last_known_lat, last_known_lng, last_location_at, member_message, contacts_notified)
       VALUES (gen_random_uuid(), $1, 'button', $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        req.user!.id,
        locationData?.latitude ?? null,
        locationData?.longitude ?? null,
        locationData ? new Date().toISOString() : null,
        body.message ?? null,
        contacts.length,
      ]
    );

    // Send notifications
    if (contacts.length > 0) {
      sendSOSAlert({
        sosId: sosResult.rows[0].id,
        travelerName,
        travelerEmail: traveler?.email,
        latitude: locationData?.latitude ?? null,
        longitude: locationData?.longitude ?? null,
        message: body.message ?? null,
        contacts,
      }).catch(err => console.error('SOS notification failed:', err));
    }

    return res.status(201).json({
      id: sosResult.rows[0].id,
      created_at: sosResult.rows[0].created_at,
      contacts_notified: contacts.length,
      location: locationData ?? null,
      contacts: contacts.map(c => ({ name: c.name, email: c.email, phone: c.phone })),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
// =============================================================================
// SAFETY ROUTE EXTENSIONS
// Append this to the bottom of /app/src/routes/safety.ts
// Adds: identity verification, trip check-in, community reporting, operator trust
// =============================================================================

import { EventEmitter } from 'events';
export const safetyEmitter = new EventEmitter();
safetyEmitter.setMaxListeners(500);

// ─── PILLAR 1: IDENTITY VERIFICATION ─────────────────────────────────────────

// POST /api/v1/safety/verification/initiate
safetyRouter.post('/verification/initiate', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Check for existing active session
    const existing = await pool.query(
      `SELECT iv.id, iv.provider_session_id
       FROM identity_verifications iv
       JOIN travelers t ON t.id = iv.traveler_id
       WHERE t.user_id = $1 AND iv.status IN ('pending','submitted','processing','requires_input')`,
      [req.user!.id]
    );
    if (existing.rows.length > 0) {
      return res.json({ verificationId: existing.rows[0].id, status: 'already_pending' });
    }

    // Create verification record (Stripe wiring added when keys are configured)
    const result = await pool.query(
      `INSERT INTO identity_verifications (traveler_id, status, expires_at)
       SELECT t.id, 'pending', NOW() + INTERVAL '48 hours'
       FROM travelers t WHERE t.user_id = $1
       RETURNING id`,
      [req.user!.id]
    );

    return res.status(201).json({
      verificationId: result.rows[0].id,
      status: 'pending',
      message: 'Verification initiated. Stripe Identity integration pending API key configuration.',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/safety/verification/status
safetyRouter.get('/verification/status', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT iv.id, iv.status, iv.id_type, iv.id_country,
              iv.face_match_score, iv.failure_reason, iv.verified_at, iv.expires_at
       FROM identity_verifications iv
       JOIN travelers t ON t.id = iv.traveler_id
       WHERE t.user_id = $1
       ORDER BY iv.created_at DESC LIMIT 1`,
      [req.user!.id]
    );
    return res.json(result.rows[0] ?? { status: 'none' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/safety/verification/stream — SSE for real-time status updates
safetyRouter.get('/verification/stream', authenticate, (req: AuthenticatedRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.user!.id;
  const handler = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  safetyEmitter.on(`verification:${userId}`, handler);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 30000);
  req.on('close', () => { safetyEmitter.off(`verification:${userId}`, handler); clearInterval(heartbeat); });
});

// ─── PILLAR 2: TRIP CHECK-IN ──────────────────────────────────────────────────

const tripSchema = z.object({
  destination: z.string().min(1),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  checkinIntervalHours: z.number().int().min(1).max(168).default(24),
  notes: z.string().max(500).optional(),
});

const checkinSchema = z.object({
  tripId: z.string().uuid(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  batteryPct: z.number().int().min(0).max(100).optional(),
  note: z.string().max(200).optional(),
});

// POST /api/v1/safety/trips
safetyRouter.post('/trips', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'traveler') return res.status(403).json({ message: 'Travelers only' });
    const body = tripSchema.parse(req.body);

    const result = await pool.query(
      `INSERT INTO member_trips
         (user_id, destination, start_date, end_date,
          checkin_interval_hours, notes, safety_status)
       VALUES ($6, $1, $2, $3, $4, $5, 'planned')
       RETURNING id, destination, start_date, end_date, safety_status`,
      [body.destination, body.start_date, body.end_date,
       body.checkinIntervalHours, body.notes ?? null, req.user!.id]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/safety/trips
safetyRouter.get('/trips', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT mt.id, mt.destination, mt.start_date, mt.end_date,
              mt.safety_status, mt.next_checkin_due, mt.last_checkin_at,
              mt.checkin_interval_hours, mt.notes
       FROM member_trips mt
       WHERE mt.user_id = $1
       ORDER BY mt.start_date DESC`,
      [req.user!.id]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/safety/trips/:id/start
safetyRouter.post('/trips/:id/start', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE member_trips mt SET
        safety_status    = 'active',
        next_checkin_due = NOW() + (mt.checkin_interval_hours * INTERVAL '1 hour')
       FROM travelers t
       WHERE mt.id = $1 AND mt.user_id = $2
         AND mt.safety_status = 'planned'
       RETURNING mt.id, mt.next_checkin_due`,
      [req.params.id, req.user!.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Trip not found or already active' });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/safety/trips/checkin
safetyRouter.post('/trips/checkin', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = checkinSchema.parse(req.body);

    // Ownership + status check - only the trip's own owner can check in,
    // and only while the trip is active or overdue (not planned/completed)
    const trip = await pool.query(
      `SELECT id, checkin_interval_hours FROM member_trips
       WHERE id = $1 AND user_id = $2 AND safety_status IN ('active', 'overdue')`,
      [body.tripId, req.user!.id]
    );
    if (!trip.rows.length) return res.status(404).json({ message: 'Active trip not found' });

    // Resolve traveler_id from the authenticated user, persist using the
    // columns that actually exist on trip_checkins
    const checkin = await pool.query(
      `INSERT INTO trip_checkins (trip_id, traveler_id, lat, lng, battery_pct, note, ip_address)
       SELECT $1, t.id, $2, $3, $4, $5, $6
       FROM travelers t WHERE t.user_id = $7
       RETURNING id, created_at`,
      [
        body.tripId,
        body.latitude ?? null,
        body.longitude ?? null,
        body.batteryPct ?? null,
        body.note ?? null,
        req.ip ?? null,
        req.user!.id,
      ]
    );
    if (!checkin.rows.length) return res.status(500).json({ message: 'Could not record check-in' });

    // Clear overdue status and advance the next check-in deadline
    const updated = await pool.query(
      `UPDATE member_trips SET
        safety_status    = 'active',
        last_checkin_at  = NOW(),
        next_checkin_due = NOW() + (checkin_interval_hours * INTERVAL '1 hour')
       WHERE id = $1
       RETURNING next_checkin_due`,
      [body.tripId]
    );

    return res.status(201).json({
      checkinId: checkin.rows[0].id,
      tripId: body.tripId,
      checkedInAt: checkin.rows[0].created_at,
      nextDueAt: updated.rows[0].next_checkin_due,
      status: 'active',
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});
safetyRouter.post('/trips/:id/complete', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE member_trips mt SET safety_status = 'completed'
       FROM travelers t
       WHERE mt.id = $1 AND mt.user_id = $2
         AND mt.safety_status IN ('active','overdue')
       RETURNING mt.id`,
      [req.params.id, req.user!.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Trip not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── PILLAR 3: SOS EXTENSIONS ────────────────────────────────────────────────

// POST /api/v1/safety/sos/:id/ping — location update during active SOS
safetyRouter.post('/sos/:id/ping', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { latitude, longitude, batteryPct } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ message: 'lat/lng required' });

    // Verify ownership
    const sos = await pool.query(
      `SELECT id FROM sos_events WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (!sos.rows.length) return res.status(404).json({ message: 'SOS not found' });

    await Promise.all([
      pool.query(
        `INSERT INTO sos_location_pings (sos_id, lat, lng, battery_pct) VALUES ($1,$2,$3,$4)`,
        [req.params.id, latitude, longitude, batteryPct ?? null]
      ),
      pool.query(
        `UPDATE sos_events SET last_known_lat=$1, last_known_lng=$2, last_location_at=NOW() WHERE id=$3`,
        [latitude, longitude, req.params.id]
      ),
    ]);

    safetyEmitter.emit(`sos:${req.params.id}`, {
      type: 'location_update', sosId: req.params.id,
      timestamp: new Date().toISOString(),
      data: { lat: latitude, lng: longitude, batteryPct },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /api/v1/safety/sos/:id/resolve
safetyRouter.post('/sos/:id/resolve', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const isFalseAlarm = req.body.falseAlarm === true;
    const timeCol = isFalseAlarm ? 'false_alarm_at' : 'resolved_at';

    await pool.query(
      `UPDATE sos_events SET resolved_at = CASE WHEN $1 THEN resolved_at ELSE NOW() END,
        false_alarm_at = CASE WHEN $1 THEN NOW() ELSE false_alarm_at END
       WHERE id = $2 AND user_id = $3`,
      [isFalseAlarm, req.params.id, req.user!.id]
    );

    safetyEmitter.emit(`sos:${req.params.id}`, {
      type: isFalseAlarm ? 'false_alarm' : 'resolved',
      sosId: req.params.id, timestamp: new Date().toISOString(), data: {},
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// GET /api/v1/safety/sos/:id/stream — SSE for emergency contact tracking
safetyRouter.get('/sos/:id/stream', async (req: any, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sosId = req.params.id;

  // Send current state immediately
  try {
    const current = await pool.query(
      `SELECT id, last_known_lat, last_known_lng, last_location_at FROM sos_events WHERE id = $1`,
      [sosId]
    );
    if (current.rows[0]) {
      res.write(`data: ${JSON.stringify({ type: 'current_state', ...current.rows[0] })}\n\n`);
    }
  } catch {}

  const handler = (event: any) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (['resolved', 'false_alarm'].includes(event.type)) res.end();
  };

  safetyEmitter.on(`sos:${sosId}`, handler);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { safetyEmitter.off(`sos:${sosId}`, handler); clearInterval(heartbeat); });
});

// ─── PILLAR 4: COMMUNITY REPORTING ───────────────────────────────────────────

const reportSchema = z.object({
  reportedTravelerId: z.string().uuid().optional(),
  reportedOperatorId: z.string().uuid().optional(),
  category: z.enum(['harassment','fake_profile','scam','inappropriate_content',
                    'safety_concern','operator_misconduct','no_show','other']),
  description: z.string().min(10).max(2000),
  tripId: z.string().uuid().optional(),
  isAnonymous: z.boolean().default(false),
});

// POST /api/v1/safety/reports
safetyRouter.post('/reports', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = reportSchema.parse(req.body);
    if (!body.reportedTravelerId && !body.reportedOperatorId) {
      return res.status(400).json({ message: 'Must report a traveler or operator' });
    }

    const severityMap: Record<string, number> = {
      harassment: 4, safety_concern: 4, scam: 3, operator_misconduct: 3,
      fake_profile: 2, inappropriate_content: 2, no_show: 2, other: 1,
    };

    const result = await pool.query(
      `INSERT INTO safety_reports
         (reporter_id, reported_traveler_id, reported_operator_id,
          category, description, trip_id, severity, is_anonymous)
       SELECT t.id, $1, $2, $3, $4, $5, $6, $7
       FROM travelers t WHERE t.user_id = $8
       RETURNING id, created_at`,
      [body.reportedTravelerId ?? null, body.reportedOperatorId ?? null,
       body.category, body.description, body.tripId ?? null,
       severityMap[body.category] ?? 2, body.isAnonymous, req.user!.id]
    );

    // Alert admins if critical
    if (severityMap[body.category] >= 4) {
      safetyEmitter.emit('report:critical', { reportId: result.rows[0].id });
    }

    return res.status(201).json({
      reportId: result.rows[0].id,
      message: 'Report submitted. Our team will review within 24 hours.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: 'Validation error', errors: err.errors });
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── PILLAR 5: OPERATOR TRUST ─────────────────────────────────────────────────

// GET /api/v1/safety/operators/:id/trust
safetyRouter.get('/operators/:id/trust', async (req: any, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT composite_score, trust_tier, score_identity, score_reviews,
              score_responsiveness, score_completion, score_safety_record,
              score_tenure, total_bookings, last_calculated_at
       FROM operator_trust_scores WHERE operator_id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Trust score not found' });

    const score = result.rows[0];
    const badgeConfig: Record<string, { label: string; colour: string; icon: string }> = {
      new:      { label: 'New Operator',  colour: '#9CA3AF', icon: '◎' },
      verified: { label: 'Verified',       colour: '#3B82F6', icon: '✓' },
      trusted:  { label: 'Trusted',        colour: '#10B981', icon: '★' },
      elite:    { label: 'Elite Partner',  colour: '#F59E0B', icon: '◆' },
    };

    return res.json({
      score,
      badge: { ...badgeConfig[score.trust_tier], score: score.composite_score, tier: score.trust_tier },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// Emergency numbers endpoint
safetyRouter.get('/emergency-numbers', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { country } = req.query;

    if (!country || typeof country !== 'string') {
      return res.status(400).json({ error: 'country parameter required (ISO code: AU, ID, TH, etc)' });
    }

    const result = await pool.query(
      'SELECT country_code, country_name, service_type, number, description, hours, language FROM emergency_numbers WHERE UPPER(country_code) = UPPER($1) ORDER BY service_type',
      [country]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Country not found in database' });
    }

    res.json({
      country: result.rows[0].country_name,
      numbers: result.rows,
    });
  } catch (err: any) {
    console.error('Emergency numbers error:', err);
    res.status(500).json({ error: err.message });
  }
});
