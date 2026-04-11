import { Router, Response } from 'express';
import { z } from 'zod';
import { pool } from '../utils/db';
import { redis } from '../utils/redis';
import { authenticate, AuthenticatedRequest } from '../middleware/authenticate';
import { sendSOSAlert } from '../services/notifications';

export const safetyRouter = Router();

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  timestamp: z.number().optional(),
});

const contactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  relationship: z.string().max(50).optional(),
  can_see_location: z.boolean().default(true),
  receives_sos: z.boolean().default(true),
  access_expires_at: z.string().datetime().optional(),
});

const sosSchema = z.object({
  message: z.string().max(500).optional(),
});

safetyRouter.post('/location', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.user!.role !== 'traveler') {
      return res.status(403).json({ message: 'Only travelers can submit location updates' });
    }
    const body = locationSchema.parse(req.body);
    const recordedAt = body.timestamp
      ? new Date(body.timestamp * 1000).toISOString()
      : new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `INSERT INTO location_history
         (id, traveler_id, location, accuracy, recorded_at, expires_at)
       SELECT gen_random_uuid(), t.id, ST_MakePoint($1, $2)::geography, $3, $4, $5
       FROM travelers t WHERE t.user_id = $6
       RETURNING id, recorded_at`,
      [body.longitude, body.latitude, body.accuracy ?? null, recordedAt, expiresAt, req.user!.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Traveler profile not found' });
    }

    await redis.setex(
      `location:${req.user!.id}`,
      60 * 60 * 24,
      JSON.stringify({ latitude: body.latitude, longitude: body.longitude, recorded_at: recordedAt })
    );

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
      SELECT lh.id, ST_X(lh.location::geometry) AS longitude, ST_Y(lh.location::geometry) AS latitude,
             lh.accuracy, lh.recorded_at
      FROM location_history lh
      JOIN travelers t ON t.id = lh.traveler_id
      WHERE t.user_id = $1 AND lh.expires_at > NOW()
    `;
    const params: any[] = [req.user!.id];
    let pc = 2;
    if (from) { query += ` AND lh.recorded_at >= $${pc}`; params.push(from); pc++; }
    if (to) { query += ` AND lh.recorded_at <= $${pc}`; params.push(to); pc++; }
    query += ` ORDER BY lh.recorded_at DESC LIMIT $${pc}`;
    params.push(Math.min(parseInt(limit as string), 200));

    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
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
      `INSERT INTO safety_contacts (id, traveler_id, name, email, phone, relationship, can_see_location, receives_sos, access_expires_at)
       SELECT gen_random_uuid(), t.id, $1, $2, $3, $4, $5, $6, $7
       FROM travelers t WHERE t.user_id = $8
       RETURNING id, name, email, phone, relationship, can_see_location, receives_sos, access_expires_at, created_at`,
      [body.name, body.email ?? null, body.phone ?? null, body.relationship ?? null,
       body.can_see_location, body.receives_sos, body.access_expires_at ?? null, req.user!.id]
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
      `SELECT sc.id, sc.name, sc.email, sc.phone, sc.relationship,
              sc.can_see_location, sc.receives_sos, sc.access_expires_at, sc.created_at
       FROM safety_contacts sc
       JOIN travelers t ON t.id = sc.traveler_id
       WHERE t.user_id = $1 ORDER BY sc.created_at ASC`,
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
      `DELETE FROM safety_contacts sc USING travelers t
       WHERE sc.id = $1 AND sc.traveler_id = t.id AND t.user_id = $2 RETURNING sc.id`,
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
      `SELECT sc.name, sc.email, sc.phone
       FROM safety_contacts sc
       JOIN travelers t ON t.id = sc.traveler_id
       WHERE t.user_id = $1 AND sc.receives_sos = true`,
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
      `INSERT INTO sos_events (id, traveler_id, ${locationData ? 'location,' : ''} message, contacts_notified)
       SELECT gen_random_uuid(), t.id, ${locationData ? `ST_MakePoint($1, $2)::geography,` : ''} $${locationData ? 3 : 1}, $${locationData ? 4 : 2}
       FROM travelers t WHERE t.user_id = $${locationData ? 5 : 3}
       RETURNING id, created_at`,
      locationData
        ? [locationData.longitude, locationData.latitude, body.message ?? null, contacts.length, req.user!.id]
        : [body.message ?? null, contacts.length, req.user!.id]
    );

    // Send notifications
    if (contacts.length > 0) {
      sendSOSAlert({
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
