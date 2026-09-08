import React, { useState } from 'react';
import api from '../services/api.web';

// Matches FlightsScreen.web.tsx / AppShell.web.tsx design tokens exactly.
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

interface StaysAccommodation {
  id: string;
  accommodationId: string;
  name: string;
  cityName: string;
  countryCode: string;
  rating: number | null;
  reviewScore: number | null;
  reviewCount: number | null;
  photoUrls: string[];
  amenityTypes: string[];
  cheapestRateTotalAmount: string | null;
  cheapestRateCurrency: string | null;
  latitude: number | null;
  longitude: number | null;
  provider: 'duffel' | 'travelport';
}

// Browse only -- there's no booking path for either provider yet (Duffel
// Stays is blocked on account access, Travelport's payment model hasn't
// been built). No "Book" button anywhere in this screen; adding one here
// would be the same mistake Flights had to be gated for.
export default function StaysScreen() {
  const [destination, setDestination] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(1);

  const [results, setResults] = useState<StaysAccommodation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const todayIso = new Date().toISOString().slice(0, 10);

  const handleCheckInChange = (value: string) => {
    setCheckInDate(value);
    if (checkOutDate && value && checkOutDate <= value) setCheckOutDate('');
  };

  const handleSearch = async () => {
    if (!destination.trim()) { setError('Enter a destination.'); return; }
    if (!checkInDate || !checkOutDate) { setError('Pick check-in and check-out dates.'); return; }

    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await api.post('/stays/search', {
        destination: destination.trim(),
        checkInDate,
        checkOutDate,
        rooms,
        adults,
      }, { timeout: 30000 });
      setResults(res.data.results || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not search stays.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Stays</h1>
        <p style={s.subtitle}>Browse real places to stay -- booking is coming soon.</p>
      </div>

      <div style={s.searchCard}>
        <div style={s.searchRow}>
          <div style={s.field}>
            <label style={s.label}>Destination</label>
            <input style={s.input} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Bali" />
          </div>
          <div style={s.field}>
            <label style={s.label}>Check-in</label>
            <input style={s.input} type="date" min={todayIso} value={checkInDate} onChange={(e) => handleCheckInChange(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Check-out</label>
            <input style={s.input} type="date" min={checkInDate || todayIso} value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} />
          </div>
          <div style={s.fieldNarrow}>
            <label style={s.label}>Rooms</label>
            <input style={s.input} type="number" min={1} max={8} value={rooms} onChange={(e) => setRooms(parseInt(e.target.value, 10) || 1)} />
          </div>
          <div style={s.fieldNarrow}>
            <label style={s.label}>Adults</label>
            <input style={s.input} type="number" min={1} max={16} value={adults} onChange={(e) => setAdults(parseInt(e.target.value, 10) || 1)} />
          </div>
        </div>
        <button style={s.searchBtn} disabled={loading} onClick={handleSearch}>
          {loading ? 'Searching...' : 'Search stays'}
        </button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {searched && !loading && results && results.length === 0 && !error && (
        <p style={s.muted}>No places found for that search.</p>
      )}

      {results && results.length > 0 && (
        <div style={s.results}>
          {results.map((r) => (
            <div key={r.id} style={s.stayCard}>
              <div style={s.stayHeader}>
                <span style={s.stayName}>{r.name}</span>
                <span style={s.providerTag}>via {r.provider === 'travelport' ? 'Travelport' : 'Duffel'}</span>
                <span style={s.price}>
                  {r.cheapestRateTotalAmount ? `$${r.cheapestRateTotalAmount} ${r.cheapestRateCurrency}` : 'Price unavailable'}
                </span>
              </div>
              <p style={s.staySub}>
                {r.cityName}{r.cityName && r.countryCode ? ', ' : ''}{r.countryCode}
                {r.rating != null && <> · {r.rating}★</>}
              </p>
              {r.amenityTypes.length > 0 && (
                <div style={s.amenityRow}>
                  {r.amenityTypes.slice(0, 6).map((a, i) => (
                    <span key={i} style={s.amenityTag}>{a}</span>
                  ))}
                  {r.amenityTypes.length > 6 && <span style={s.mutedSmall}>+{r.amenityTypes.length - 6} more</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px 40px', maxWidth: 1000, margin: '0 auto' },
  header: { marginBottom: 24 },
  title: { fontSize: 26, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'DM Serif Display', serif" },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 6 },
  searchCard: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, marginBottom: 24 },
  searchRow: { display: 'flex', gap: 12, flexWrap: 'wrap' as const, marginBottom: 14 },
  field: { flex: '1 1 140px', minWidth: 120 },
  fieldNarrow: { flex: '0 1 80px', minWidth: 70 },
  label: { fontSize: 11, fontWeight: 600, color: C.muted, display: 'block', marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '0.4px' },
  input: { width: '100%', padding: '10px 12px', border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, background: C.bg, outline: 'none' },
  searchBtn: { padding: '11px 22px', background: C.gold, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  error: { background: '#ffebee', color: '#c62828', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  muted: { color: C.muted, fontSize: 14 },
  mutedSmall: { color: C.muted, fontSize: 11 },
  results: { display: 'flex', flexDirection: 'column' as const, gap: 14 },
  stayCard: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 },
  stayHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  stayName: { fontSize: 15, fontWeight: 600, color: C.text, flex: 1 },
  providerTag: { fontSize: 11, color: C.muted, background: C.bg, borderRadius: 6, padding: '2px 8px' },
  price: { fontSize: 16, fontWeight: 700, color: C.goldDark },
  staySub: { fontSize: 13, color: C.muted, margin: '0 0 10px' },
  amenityRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' },
  amenityTag: { fontSize: 11, color: C.text, background: C.soft, borderRadius: 6, padding: '3px 9px' },
};
