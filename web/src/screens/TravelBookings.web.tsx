import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// "My flights and stays": every flight or hotel the traveller has booked
// through Drift, in one place, whichever provider it went through (TripGic
// or Duffel). Shown at the top of the Bookings tab. Before this, a booking
// only appeared as a small list at the bottom of the Flights or Stays tab,
// with no airline and no times, and the Bookings tab said "No bookings yet".

const C = {
  gold:      '#C9A84C',
  goldLight: '#FBF5E6',
  goldDark:  '#A8893A',
  bg:        '#f8f7f4',
  white:     '#FFFFFF',
  border:    '#F0EDE8',
  text:      '#1A1A1A',
  muted:     '#9B9590',
  soft:      '#F5F3EF',
};

interface Leg {
  from: string;
  to: string;
  fromCity: string | null;
  toCity: string | null;
  departingAt: string;
  arrivingAt: string;
  stops: number;
  flights: string[];
}

interface TravelBooking {
  key: string;
  orderId: string;
  source: 'tripgic' | 'duffel';
  kind: 'flight' | 'hotel';
  provider: 'tripgic' | 'duffel';
  status: string;
  title: string;
  withName: string | null; // the airline, or the hotel
  legs: Leg[];
  stay: { checkIn: string; checkOut: string; nights: number | null; room: string | null; address: string | null } | null;
  people: string[];
  reference: string | null;
  supplierReference: string | null;
  price: number;
  currency: string;
  testBooking: boolean;
  message: string | null;
  holdExpiresAt: string | null;
  when: number; // ms, for ordering: first departure or check-in
  createdAt: string;
}

// "2026-09-23T07:55:00" and "2026-09-23" are local times / dates with no
// zone. Parse them as such (new Date("2026-09-23") would be UTC and can show
// the wrong day).
function parseLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

const dayTime = (v: string) => {
  const d = parseLocal(v);
  return d ? d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: false }) : '';
};
const timeOnly = (v: string) => {
  const d = parseLocal(v);
  return d ? d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: false }) : '';
};
// Arrival shows its date when it is not the same day as departure (a 1-stop
// Sydney to Bali flight lands the next day).
const arrival = (dep: string, arr: string) => (dep.slice(0, 10) === arr.slice(0, 10) ? timeOnly(arr) : dayTime(arr));
const dayOnly = (v: string) => {
  const d = parseLocal(v);
  return d ? d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
};

function toLegs(slices: any[] | undefined): Leg[] {
  return (slices ?? []).map((s) => ({
    from: s.originAirport,
    to: s.destinationAirport,
    fromCity: s.originCity ?? null,
    toCity: s.destinationCity ?? null,
    departingAt: s.departingAt,
    arrivingAt: s.arrivingAt,
    stops: s.stops ?? 0,
    flights: (s.segments ?? []).map((g: any) => `${g.flightNumber ?? ''}${g.marketingCarrier ? ` (${g.marketingCarrier})` : ''}`.trim()).filter(Boolean),
  }));
}

function airlineOf(slices: any[] | undefined): string | null {
  const names = new Set<string>();
  for (const s of slices ?? []) for (const g of s.segments ?? []) if (g.marketingCarrier) names.add(g.marketingCarrier);
  const list = Array.from(names);
  return list.length === 0 ? null : list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function fromTripgic(o: any): TravelBooking {
  const d = o.details ?? {};
  const isFlight = o.product === 'flight';
  const legs = isFlight ? toLegs(d.slices) : [];
  const first = legs[0] ? parseLocal(legs[0].departingAt) : parseLocal(d.checkInDate);
  const people = (isFlight ? d.passengers : d.guests ?? []) ?? [];
  return {
    key: `tg-${o.id}`,
    orderId: String(o.id),
    source: 'tripgic',
    kind: isFlight ? 'flight' : 'hotel',
    provider: 'tripgic',
    status: o.status,
    title: o.title,
    // All airlines on the trip: a return can be on a different carrier from the outbound.
    withName: isFlight ? airlineOf(d.slices) ?? d.airline ?? null : d.hotelName ?? null,
    legs,
    stay: isFlight ? null : { checkIn: d.checkInDate, checkOut: d.checkOutDate, nights: d.nights ?? null, room: d.roomTitle ?? null, address: d.address ?? null },
    people: people.map((p: any) => `${p.givenName} ${p.familyName}`.trim()),
    reference: o.bookingId,
    supplierReference: o.supplierReference,
    price: o.priceChargedAmount,
    currency: o.currency,
    testBooking: o.paymentStatus === 'not_collected_sandbox',
    message: o.message,
    holdExpiresAt: o.holdExpiresAt,
    when: first ? first.getTime() : new Date(o.createdAt).getTime(),
    createdAt: o.createdAt,
  };
}

function fromDuffel(o: any): TravelBooking {
  const legs = toLegs(o.slices);
  const first = legs[0] ? parseLocal(legs[0].departingAt) : null;
  const route = legs.length ? `${legs[0].from} to ${legs[legs.length - 1].to}` : 'Flight';
  return {
    key: `df-${o.id}`,
    orderId: String(o.id),
    source: 'duffel',
    kind: 'flight',
    provider: 'duffel',
    status: o.status === 'confirmed' ? 'ticketed' : o.status,
    title: route,
    withName: airlineOf(o.slices),
    legs,
    stay: null,
    people: [],
    reference: o.bookingReference,
    supplierReference: null,
    price: o.priceChargedAmount,
    currency: o.priceChargedCurrency,
    testBooking: false,
    message: null,
    holdExpiresAt: null,
    when: first ? first.getTime() : new Date(o.createdAt).getTime(),
    createdAt: o.createdAt,
  };
}

interface ScheduledReminder { type: string; sendAt: string; status: string; source: string; orderId: string }

const REMINDER_LABEL: Record<string, string> = {
  pre_7d: '1 week before', pre_72h: '3 days before', pre_24h: '1 day before', pre_3h: '3 hours before', hotel_checkin: 'Check-in day',
};

// Upcoming reminders for one booking, e.g. "1 week before (Tue 13 Oct)".
function upcomingReminders(b: TravelBooking, all: ScheduledReminder[]): string[] {
  const seen = new Set<string>();
  return all
    .filter((r) => r.source === b.source && r.orderId === b.orderId && r.status === 'pending' && REMINDER_LABEL[r.type] && new Date(r.sendAt).getTime() > Date.now() - 60000)
    .sort((a, c) => new Date(a.sendAt).getTime() - new Date(c.sendAt).getTime())
    .map((r) => `${REMINDER_LABEL[r.type]} (${new Date(r.sendAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: false })})`)
    .filter((line) => (seen.has(line) ? false : (seen.add(line), true)));
}

const STATUS: Record<string, { label: string; tone: 'good' | 'wait' | 'off' | 'bad'; note: string }> = {
  held:      { label: 'Reserved',  tone: 'wait', note: "Your seats are held, but the ticket hasn't been issued yet." },
  ticketed:  { label: 'Ticketed',  tone: 'good', note: 'Your tickets are issued.' },
  confirmed: { label: 'Confirmed', tone: 'good', note: 'Your booking is confirmed.' },
  cancelled: { label: 'Cancelled', tone: 'off',  note: 'This booking was cancelled.' },
  expired:   { label: 'Expired',   tone: 'off',  note: 'The reservation expired before it was ticketed.' },
  failed:    { label: 'Failed',    tone: 'bad',  note: 'This booking could not be completed.' },
};

function Card({ b, reminders }: { b: TravelBooking; reminders: ScheduledReminder[] }) {
  const coming = upcomingReminders(b, reminders);
  const st = STATUS[b.status] ?? { label: b.status, tone: 'off' as const, note: '' };
  return (
    <div style={s.card}>
      <div style={s.top}>
        <span style={s.icon}>{b.kind === 'flight' ? '✈︎' : '⌂'}</span>
        <div style={s.topText}>
          <div style={s.title}>{b.kind === 'flight' && b.legs.length ? routeTitle(b.legs) : b.withName ?? b.title}</div>
          {b.withName && (
            <div style={s.with}>
              {b.kind === 'flight' ? 'With ' : 'Staying at '}<strong>{b.withName}</strong>
            </div>
          )}
        </div>
        <span style={{ ...s.pill, ...pillTone[st.tone] }}>{st.label}</span>
      </div>

      {b.kind === 'flight' && b.legs.map((l, i) => (
        <div key={i} style={s.leg}>
          <div style={s.legLabel}>{b.legs.length > 1 ? (i === 0 ? 'Outbound' : i === b.legs.length - 1 ? 'Return' : `Leg ${i + 1}`) : 'Flight'}</div>
          <div style={s.legMain}>
            {dayTime(l.departingAt)} → {arrival(l.departingAt, l.arrivingAt)}
            <span style={s.legPlaces}> · {l.from} → {l.to}{l.stops > 0 ? ` · ${l.stops} stop${l.stops > 1 ? 's' : ''}` : ' · direct'}</span>
          </div>
          {l.flights.length > 0 && <div style={s.legSub}>Flight {l.flights.join(', ')}</div>}
        </div>
      ))}

      {b.stay && (
        <div style={s.leg}>
          <div style={s.legMain}>{dayOnly(b.stay.checkIn)} → {dayOnly(b.stay.checkOut)}{b.stay.nights ? ` · ${b.stay.nights} night${b.stay.nights > 1 ? 's' : ''}` : ''}</div>
          {b.stay.room && <div style={s.legSub}>{b.stay.room}</div>}
          {b.stay.address && <div style={s.legSub}>{b.stay.address}</div>}
        </div>
      )}

      <div style={s.facts}>
        {b.people.length > 0 && <div><span style={s.k}>{b.kind === 'flight' ? 'Passengers' : 'Guests'}</span> {b.people.join(', ')}</div>}
        {b.reference && <div><span style={s.k}>Booking ref</span> <strong>{b.reference}</strong></div>}
        {b.supplierReference && <div><span style={s.k}>{b.kind === 'flight' ? 'Airline ref' : 'Confirmation'}</span> <strong>{b.supplierReference}</strong></div>}
        <div><span style={s.k}>Total</span> <strong>${b.price.toFixed(2)} {b.currency}</strong>{b.testBooking && <span style={s.test}> Test booking, not charged</span>}</div>
        <div style={s.viaLine}>Booked through Drift · via {b.provider === 'tripgic' ? 'TripGic' : 'Duffel'}</div>
      </div>

      {(coming.length > 0 || (b.status === 'held' && !b.testBooking)) && (
        <div style={s.reminders}>
          <div style={s.remindersTitle}>Reminders</div>
          {coming.length > 0
            ? coming.map((line) => <div key={line} style={s.reminderLine}>{line}</div>)
            : <div style={s.reminderLine}>You'll get reminders once your ticket is issued.</div>}
        </div>
      )}

      <div style={s.note}>
        {b.message ?? st.note}
        {b.status === 'held' && b.holdExpiresAt && <> Held until {new Date(b.holdExpiresAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: false })}.</>}
      </div>
    </div>
  );
}

function routeTitle(legs: Leg[]): string {
  const a = legs[0].fromCity ? `${legs[0].fromCity} (${legs[0].from})` : legs[0].from;
  const last = legs[legs.length - 1];
  const bLeg = legs.length > 1 ? legs[0] : last;
  const b = bLeg.toCity ? `${bLeg.toCity} (${bLeg.to})` : bLeg.to;
  return legs.length > 1 ? `${a} ⇄ ${b}` : `${a} → ${b}`;
}

export function TravelBookings({ onLoaded }: { onLoaded?: (count: number) => void }) {
  const [items, setItems] = useState<TravelBooking[] | null>(null);
  const [reminders, setReminders] = useState<ScheduledReminder[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.get('/tripgic/orders'), api.get('/flights/orders'), api.get('/notifications/schedule')]).then(([tg, df, sc]) => {
      if (!alive) return;
      const all: TravelBooking[] = [];
      if (tg.status === 'fulfilled') for (const o of tg.value.data.orders ?? []) all.push(fromTripgic(o));
      if (df.status === 'fulfilled') for (const o of df.value.data.orders ?? []) all.push(fromDuffel(o));
      setItems(all);
      if (sc.status === 'fulfilled') setReminders(sc.value.data.items ?? []);
      onLoaded?.(all.length);
    });
    return () => { alive = false; };
  }, []);

  if (!items || items.length === 0) return null;

  const now = Date.now();
  const live = (b: TravelBooking) => !['cancelled', 'expired', 'failed'].includes(b.status);
  // Upcoming: soonest first. Past, cancelled or expired: most recent first.
  const upcoming = items.filter((b) => live(b) && b.when >= now - 24 * 3600 * 1000).sort((a, b) => a.when - b.when);
  const rest = items.filter((b) => !upcoming.includes(b)).sort((a, b) => b.when - a.when);

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={s.heading}>Flights and stays</h3>
      {upcoming.length > 0 && (
        <>
          <div style={s.groupLabel}>Upcoming</div>
          {upcoming.map((b) => <Card key={b.key} b={b} reminders={reminders} />)}
        </>
      )}
      {rest.length > 0 && (
        <>
          <div style={s.groupLabel}>Past, cancelled or expired</div>
          {rest.map((b) => <Card key={b.key} b={b} reminders={reminders} />)}
        </>
      )}
    </div>
  );
}

const pillTone: Record<string, React.CSSProperties> = {
  good: { background: '#e8f5e9', color: '#2e7d32' },
  wait: { background: C.goldLight, color: C.goldDark },
  off:  { background: C.soft, color: C.muted },
  bad:  { background: '#ffebee', color: '#c62828' },
};

const s: Record<string, React.CSSProperties> = {
  heading: { fontSize: 20, fontWeight: 700, color: C.text, margin: '0 0 12px', fontFamily: "'DM Serif Display', serif" },
  groupLabel: { fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 8px' },
  card: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 18, marginBottom: 12, maxWidth: 680 },
  top: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  icon: { fontSize: 20, color: C.goldDark, lineHeight: '24px' },
  topText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: 700, color: C.text },
  with: { fontSize: 13, color: C.text, marginTop: 2 },
  pill: { fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '4px 11px', whiteSpace: 'nowrap' },
  leg: { borderTop: `1px solid ${C.border}`, padding: '9px 0' },
  legLabel: { fontSize: 11, fontWeight: 700, color: C.goldDark, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 },
  legMain: { fontSize: 14, color: C.text },
  legPlaces: { color: C.muted },
  legSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  facts: { borderTop: `1px solid ${C.border}`, paddingTop: 10, fontSize: 13, color: C.text, display: 'flex', flexDirection: 'column', gap: 4 },
  k: { display: 'inline-block', minWidth: 96, color: C.muted, fontSize: 12 },
  test: { color: C.goldDark, fontSize: 12 },
  viaLine: { fontSize: 11, color: C.muted, marginTop: 2 },
  reminders: { marginTop: 10, fontSize: 12, color: C.text },
  remindersTitle: { fontSize: 11, fontWeight: 700, color: C.goldDark, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 },
  reminderLine: { color: C.muted, lineHeight: 1.6 },
  note: { background: C.bg, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.text, marginTop: 10 },
};
