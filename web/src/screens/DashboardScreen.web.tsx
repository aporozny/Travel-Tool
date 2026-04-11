import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  pending:   { background: '#FFF8E1', color: '#F57F17' },
  confirmed: { background: '#E8F5E9', color: '#2E7D32' },
  cancelled: { background: '#FFEBEE', color: '#C62828' },
  completed: { background: '#E3F2FD', color: '#1565C0' },
};

export default function DashboardScreen() {
  const [overview, setOverview] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'bookings' | 'reviews'>('overview');

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/overview'),
      api.get('/dashboard/bookings'),
      api.get('/dashboard/reviews'),
      api.get('/dashboard/analytics'),
    ]).then(([o, b, r, a]) => {
      setOverview(o.data);
      setBookings(b.data);
      setReviews(r.data);
      setAnalytics(a.data);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const updateBookingStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/bookings/${id}/status`, { status });
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    } catch (err) {
      console.error(err);
    }
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  if (loading) return <div style={styles.loading}>Loading dashboard...</div>;
  if (!overview) return <div style={styles.loading}>No operator profile found. Create your listing first.</div>;

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <div>
          <h2 style={styles.title}>{overview.business_name}</h2>
          <div style={styles.badges}>
            <span style={styles.tierBadge}>{overview.tier}</span>
            {overview.is_verified && <span style={styles.verifiedBadge}>✓ Verified</span>}
            <span style={styles.regionBadge}>{overview.region}</span>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div style={styles.metrics}>
        {[
          { label: 'Pending', value: overview.pending_bookings, color: '#F57F17', bg: '#FFF8E1' },
          { label: 'Confirmed', value: overview.confirmed_bookings, color: '#2E7D32', bg: '#E8F5E9' },
          { label: 'Completed', value: overview.completed_bookings, color: '#1565C0', bg: '#E3F2FD' },
          { label: 'Avg Rating', value: overview.avg_rating ? `★ ${overview.avg_rating}` : '—', color: '#F9A825', bg: '#FFF8E1' },
          { label: 'Reviews', value: overview.total_reviews, color: '#555', bg: '#f5f5f5' },
          { label: 'Revenue', value: `$${parseFloat(overview.total_revenue || 0).toLocaleString()}`, color: '#2E7D32', bg: '#E8F5E9' },
        ].map(m => (
          <div key={m.label} style={{ ...styles.metricCard, background: m.bg }}>
            <p style={{ ...styles.metricValue, color: m.color }}>{m.value}</p>
            <p style={styles.metricLabel}>{m.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {(['overview', 'bookings', 'reviews'] as const).map(t => (
          <button key={t} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
            onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'bookings' && overview.pending_bookings > 0 && (
              <span style={styles.badge}>{overview.pending_bookings}</span>
            )}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && analytics && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>Last 30 days</h3>
          {analytics.daily.length === 0 ? (
            <p style={styles.empty}>No booking activity yet.</p>
          ) : (
            <div style={styles.chartWrap}>
              {analytics.daily.map((d: any) => (
                <div key={d.date} style={styles.barGroup}>
                  <div style={styles.barTrack}>
                    <div style={{
                      ...styles.bar,
                      height: `${Math.min((parseInt(d.bookings) / 10) * 100, 100)}%`,
                    }} />
                  </div>
                  <p style={styles.barLabel}>{new Date(d.date).getDate()}</p>
                </div>
              ))}
            </div>
          )}

          <h3 style={{ ...styles.sectionTitle, marginTop: 24 }}>Rating breakdown</h3>
          {analytics.ratings.map((r: any) => (
            <div key={r.rating} style={styles.ratingRow}>
              <span style={styles.ratingLabel}>{r.rating}★</span>
              <div style={styles.ratingTrack}>
                <div style={{
                  ...styles.ratingFill,
                  width: `${(parseInt(r.count) / parseInt(overview.total_reviews)) * 100}%`,
                }} />
              </div>
              <span style={styles.ratingCount}>{r.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bookings tab */}
      {tab === 'bookings' && (
        <div style={styles.section}>
          {bookings.length === 0 ? (
            <p style={styles.empty}>No bookings yet.</p>
          ) : (
            bookings.map(b => (
              <div key={b.id} style={styles.bookingCard}>
                <div style={styles.bookingTop}>
                  <div>
                    <strong style={styles.guestName}>
                      {b.first_name || b.last_name ? `${b.first_name || ''} ${b.last_name || ''}`.trim() : b.traveler_email}
                    </strong>
                    <p style={styles.guestEmail}>{b.traveler_email}</p>
                  </div>
                  <span style={{ ...styles.statusPill, ...STATUS_STYLES[b.status] }}>{b.status}</span>
                </div>
                <p style={styles.bookingDates}>
                  {fmt(b.start_date)}{b.end_date ? ` → ${fmt(b.end_date)}` : ''} · {b.guests} guest{b.guests !== 1 ? 's' : ''}
                </p>
                {b.notes && <p style={styles.bookingNotes}>"{b.notes}"</p>}
                {b.total_amount && (
                  <p style={styles.bookingAmount}>{b.currency} {parseFloat(b.total_amount).toFixed(2)}</p>
                )}
                {b.status === 'pending' && (
                  <div style={styles.actionRow}>
                    <button style={styles.confirmBtn} onClick={() => updateBookingStatus(b.id, 'confirmed')}>
                      Confirm
                    </button>
                    <button style={styles.cancelBtn} onClick={() => updateBookingStatus(b.id, 'cancelled')}>
                      Decline
                    </button>
                  </div>
                )}
                {b.status === 'confirmed' && (
                  <div style={styles.actionRow}>
                    <button style={styles.confirmBtn} onClick={() => updateBookingStatus(b.id, 'completed')}>
                      Mark completed
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Reviews tab */}
      {tab === 'reviews' && (
        <div style={styles.section}>
          {reviews.length === 0 ? (
            <p style={styles.empty}>No reviews yet.</p>
          ) : (
            reviews.map(r => (
              <div key={r.id} style={styles.reviewCard}>
                <div style={styles.reviewTop}>
                  <strong style={styles.reviewerName}>
                    {r.first_name || r.last_name ? `${r.first_name || ''} ${r.last_name || ''}`.trim() : 'Guest'}
                  </strong>
                  <span style={styles.stars}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                </div>
                {r.title && <p style={styles.reviewTitle}>{r.title}</p>}
                {r.body && <p style={styles.reviewBody}>{r.body}</p>}
                <p style={styles.reviewDate}>{fmt(r.created_at)} · {r.guests} guest{r.guests !== 1 ? 's' : ''}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, maxWidth: 900 },
  loading: { padding: 60, color: '#999', textAlign: 'center' },
  headerRow: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 },
  badges: { display: 'flex', gap: 8 },
  tierBadge: { background: '#FFF8E1', color: '#F57F17', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 },
  verifiedBadge: { background: '#E8F5E9', color: '#2E7D32', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 },
  regionBadge: { background: '#f5f5f5', color: '#666', padding: '3px 10px', borderRadius: 6, fontSize: 12 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12, marginBottom: 28 },
  metricCard: { borderRadius: 14, padding: '16px 12px', textAlign: 'center' },
  metricValue: { fontSize: 26, fontWeight: 700, marginBottom: 4 },
  metricLabel: { fontSize: 12, color: '#888' },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid #f0f0f0' },
  tab: { padding: '10px 20px', border: 'none', background: 'transparent', fontSize: 15, color: '#888', cursor: 'pointer', fontWeight: 500, position: 'relative' },
  tabActive: { color: '#2E7D32', borderBottom: '2px solid #2E7D32', marginBottom: -2 },
  badge: { background: '#C62828', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, marginLeft: 6 },
  section: {},
  sectionTitle: { fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 14 },
  empty: { color: '#999', padding: '40px 0', textAlign: 'center' },
  chartWrap: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, marginBottom: 8 },
  barGroup: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  barTrack: { width: '100%', height: 60, background: '#f5f5f5', borderRadius: 4, display: 'flex', alignItems: 'flex-end' },
  bar: { width: '100%', background: '#2E7D32', borderRadius: 4, minHeight: 2 },
  barLabel: { fontSize: 10, color: '#bbb' },
  ratingRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  ratingLabel: { width: 24, fontSize: 13, color: '#F9A825', fontWeight: 600 },
  ratingTrack: { flex: 1, height: 8, background: '#f5f5f5', borderRadius: 4 },
  ratingFill: { height: 8, background: '#F9A825', borderRadius: 4 },
  ratingCount: { width: 24, fontSize: 12, color: '#999', textAlign: 'right' },
  bookingCard: { background: '#fff', borderRadius: 14, padding: 20, marginBottom: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' },
  bookingTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  guestName: { fontSize: 16, color: '#1a1a1a' },
  guestEmail: { fontSize: 13, color: '#888', marginTop: 2 },
  statusPill: { padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600 },
  bookingDates: { fontSize: 14, color: '#555', marginBottom: 6 },
  bookingNotes: { fontSize: 13, color: '#888', fontStyle: 'italic', marginBottom: 6 },
  bookingAmount: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 10 },
  actionRow: { display: 'flex', gap: 8 },
  confirmBtn: { padding: '8px 20px', background: '#2E7D32', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  cancelBtn: { padding: '8px 20px', background: '#fff', color: '#C62828', border: '1px solid #ffcdd2', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  reviewCard: { background: '#fff', borderRadius: 14, padding: 20, marginBottom: 12, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' },
  reviewTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reviewerName: { fontSize: 15, color: '#1a1a1a' },
  stars: { color: '#F9A825', fontSize: 16 },
  reviewTitle: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 },
  reviewBody: { fontSize: 14, color: '#555', lineHeight: 1.6, marginBottom: 8 },
  reviewDate: { fontSize: 12, color: '#bbb' },
};
