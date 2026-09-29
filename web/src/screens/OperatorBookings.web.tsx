import React, { useEffect, useState } from 'react';
import api from '../services/api.web';
import { Booking } from '@/types';

// Local experiences booked directly with an operator (hostels, tours, rentals --
// requested from Explore, not through Duffel/TripGic). Its own component,
// mirroring TravelBookings.web.tsx, so it can be shown on the Bookings tab and
// on the Trips tab without either screen re-implementing the fetch or the cards.

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  pending:   { background: '#FFF8E1', color: '#F57F17' },
  confirmed: { background: '#E8F5E9', color: '#2E7D32' },
  cancelled: { background: '#FFEBEE', color: '#C62828' },
  completed: { background: '#E3F2FD', color: '#1565C0' },
};

const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

export function OperatorBookings({ onLoaded }: { onLoaded?: (count: number) => void }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.get('/bookings').then((r) => {
      if (!alive) return;
      setBookings(r.data);
      onLoaded?.(r.data.length);
    }).catch(() => { if (alive) { setBookings([]); onLoaded?.(0); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!bookings || bookings.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const isPast = (b: Booking) => ['cancelled', 'completed'].includes(b.status) || (b.end_date ?? b.start_date) < today;
  const upcoming = bookings.filter((b) => !isPast(b)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const past = bookings.filter(isPast).sort((a, b) => b.start_date.localeCompare(a.start_date));

  const Card = ({ b }: { b: Booking }) => (
    <div style={s.card}>
      <div style={s.top}>
        <strong style={s.bizName}>{b.business_name}</strong>
        <span style={{ ...s.pill, ...STATUS_STYLES[b.status] }}>{b.status}</span>
      </div>
      <p style={s.dates}>{fmt(b.start_date)}{b.end_date ? ` → ${fmt(b.end_date)}` : ''}</p>
      <div style={s.bottom}>
        <span style={s.guests}>{b.guests} guest{b.guests !== 1 ? 's' : ''}</span>
        {b.total_amount && <span style={s.amount}>{b.currency} {parseFloat(b.total_amount).toFixed(2)}</span>}
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={s.heading}>Local experiences</h3>
      {upcoming.length > 0 && (
        <>
          <div style={s.groupLabel}>Upcoming</div>
          {upcoming.map((b) => <Card key={b.id} b={b} />)}
        </>
      )}
      {past.length > 0 && (
        <>
          <div style={s.groupLabel}>Past or cancelled</div>
          {past.map((b) => <Card key={b.id} b={b} />)}
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  heading: { fontSize: 20, fontWeight: 700, color: '#1a1a1a', margin: '0 0 4px' },
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#9B9590', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '14px 0 8px' },
  card: {
    background: '#fff', borderRadius: 16, padding: 20, maxWidth: 680,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #f0f0f0', marginBottom: 12,
  },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  bizName: { fontSize: 16, color: '#1a1a1a' },
  pill: { padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 },
  dates: { fontSize: 14, color: '#555', marginBottom: 12 },
  bottom: { display: 'flex', justifyContent: 'space-between' },
  guests: { fontSize: 13, color: '#999' },
  amount: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
};
