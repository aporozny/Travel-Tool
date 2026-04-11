import React, { useEffect, useState } from 'react';
import api from '../services/api.web';
import { Booking } from '@/types';

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  pending:   { background: '#FFF8E1', color: '#F57F17' },
  confirmed: { background: '#E8F5E9', color: '#2E7D32' },
  cancelled: { background: '#FFEBEE', color: '#C62828' },
  completed: { background: '#E3F2FD', color: '#1565C0' },
};

export default function BookingsScreen() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/bookings')
      .then(r => setBookings(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Bookings</h2>
      {loading ? (
        <p style={styles.empty}>Loading...</p>
      ) : bookings.length === 0 ? (
        <div style={styles.emptyBox}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>📋</p>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>No bookings yet</p>
          <p style={{ fontSize: 14, color: '#999', marginTop: 6 }}>Browse operators and make your first booking.</p>
        </div>
      ) : (
        <div style={styles.list}>
          {bookings.map(b => (
            <div key={b.id} style={styles.card}>
              <div style={styles.cardTop}>
                <strong style={styles.bizName}>{b.business_name}</strong>
                <span style={{ ...styles.statusBadge, ...STATUS_STYLES[b.status] }}>{b.status}</span>
              </div>
              <p style={styles.dates}>
                {fmt(b.start_date)}{b.end_date ? ` → ${fmt(b.end_date)}` : ''}
              </p>
              <div style={styles.cardBottom}>
                <span style={styles.guests}>{b.guests} guest{b.guests !== 1 ? 's' : ''}</span>
                {b.total_amount && (
                  <span style={styles.amount}>{b.currency} {parseFloat(b.total_amount).toFixed(2)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32 },
  title: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', marginBottom: 24 },
  list: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 680 },
  card: {
    background: '#fff', borderRadius: 16, padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #f0f0f0',
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  bizName: { fontSize: 16, color: '#1a1a1a' },
  statusBadge: { padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 },
  dates: { fontSize: 14, color: '#555', marginBottom: 12 },
  cardBottom: { display: 'flex', justifyContent: 'space-between' },
  guests: { fontSize: 13, color: '#999' },
  amount: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  empty: { color: '#999', padding: 40, textAlign: 'center' },
  emptyBox: { textAlign: 'center', padding: 80 },
};
