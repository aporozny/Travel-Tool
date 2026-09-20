import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api.web';
import { useTripgicBookingEnabled, TripgicHotelCheckout, TripgicOrders, type HotelSearchContext } from './TripgicCheckout.web';

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
  provider: 'duffel' | 'travelport' | 'tripgic';
}

const PROVIDER_LABELS: Record<StaysAccommodation['provider'], string> = {
  duffel: 'Duffel',
  travelport: 'Travelport',
  tripgic: 'TripGic',
};

// TripGic hotel search takes ~40s upstream, so the backend runs it as a
// background job (POST /stays/tripgic-search, then poll the GET). These
// results are appended below the fast providers' once they land.
const EXTRA_POLL_INTERVAL_MS = 3000;
const EXTRA_POLL_MAX_MS = 150000;
type ExtraStatus = 'idle' | 'searching' | 'done' | 'failed';

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
  const [extraResults, setExtraResults] = useState<StaysAccommodation[]>([]);
  const [extraStatus, setExtraStatus] = useState<ExtraStatus>('idle');

  // Booking: only TripGic results are bookable, and only when the backend says so.
  const tripgicBookingEnabled = useTripgicBookingEnabled();
  const [lastSearch, setLastSearch] = useState<HotelSearchContext | null>(null);
  const [bookingHotel, setBookingHotel] = useState<StaysAccommodation | null>(null);
  const [ordersKey, setOrdersKey] = useState(0);

  // Bumped on every new search (and on unmount) so a poll loop belonging to
  // an earlier search stops instead of overwriting the newer one's results.
  const searchToken = useRef(0);
  useEffect(() => () => { searchToken.current += 1; }, []);

  const todayIso = new Date().toISOString().slice(0, 10);

  const handleCheckInChange = (value: string) => {
    setCheckInDate(value);
    if (checkOutDate && value && checkOutDate <= value) setCheckOutDate('');
  };

  const runExtendedSearch = async (token: number, payload: Record<string, unknown>) => {
    const isStale = () => token !== searchToken.current;
    try {
      let res = await api.post('/stays/tripgic-search', payload, { timeout: 30000 });
      const deadline = Date.now() + EXTRA_POLL_MAX_MS;
      while (res.data.status === 'pending' || res.data.status === 'unknown') {
        if (Date.now() > deadline) throw new Error('timed out');
        await new Promise((resolve) => setTimeout(resolve, EXTRA_POLL_INTERVAL_MS));
        if (isStale()) return;
        res = await api.get(`/stays/tripgic-search/${res.data.searchId}`, { timeout: 30000 });
      }
      if (isStale()) return;
      if (res.data.status === 'ready') {
        setExtraResults(res.data.results || []);
        setExtraStatus('done');
      } else {
        setExtraStatus('failed');
      }
    } catch {
      // Extended search is best-effort -- the fast providers' results stand on their own.
      if (!isStale()) setExtraStatus('failed');
    }
  };

  const handleSearch = async () => {
    if (!destination.trim()) { setError('Enter a destination.'); return; }
    if (!checkInDate || !checkOutDate) { setError('Pick check-in and check-out dates.'); return; }

    const token = ++searchToken.current;
    const payload = { destination: destination.trim(), checkInDate, checkOutDate, rooms, adults };
    setLastSearch({ checkInDate, checkOutDate, rooms, adults });

    setLoading(true);
    setError('');
    setSearched(true);
    setExtraResults([]);
    setExtraStatus('searching');
    void runExtendedSearch(token, payload);
    try {
      const res = await api.post('/stays/search', payload, { timeout: 30000 });
      if (token !== searchToken.current) return;
      setResults(res.data.results || []);
    } catch (err: any) {
      if (token !== searchToken.current) return;
      setError(err?.response?.data?.message || 'Could not search stays.');
      setResults(null);
    } finally {
      if (token === searchToken.current) setLoading(false);
    }
  };

  const allResults = [...(results ?? []), ...extraResults];
  const searchingMore = extraStatus === 'searching';

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

      {/* The fast providers' error only matters when nothing else turned up. */}
      {error && allResults.length === 0 && !searchingMore && <div style={s.error}>{error}</div>}

      {searchingMore && (
        <div style={s.banner}>
          {allResults.length > 0
            ? 'Searching more hotels -- more results will appear below in about a minute.'
            : 'Searching hotels -- this can take up to a minute.'}
        </div>
      )}
      {extraStatus === 'failed' && (
        <p style={s.mutedSmall}>Some additional hotel results couldn't be loaded.</p>
      )}

      {searched && !loading && !searchingMore && allResults.length === 0 && !error && (
        <p style={s.muted}>No places found for that search.</p>
      )}

      {allResults.length > 0 && (
        <div style={s.results}>
          {allResults.map((r) => (
            <div key={`${r.provider}:${r.id}`} style={s.stayCard}>
              {r.photoUrls[0] && (
                <img src={r.photoUrls[0]} alt="" loading="lazy" style={s.photo}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              )}
              <div style={s.stayBody}>
              <div style={s.stayHeader}>
                <span style={s.stayName}>{r.name}</span>
                <span style={s.providerTag}>via {PROVIDER_LABELS[r.provider]}</span>
                <span style={s.price}>
                  {r.cheapestRateTotalAmount ? `$${r.cheapestRateTotalAmount} ${r.cheapestRateCurrency}` : 'Price unavailable'}
                </span>
              </div>
              <p style={s.staySub}>
                {r.cityName}{r.cityName && r.countryCode ? ', ' : ''}{r.countryCode}
                {r.rating != null && <> · {r.rating}★</>}
              </p>
              {r.provider === 'tripgic' && tripgicBookingEnabled && lastSearch && (
                <button style={s.bookBtn} onClick={() => setBookingHotel(r)}>View rooms and book</button>
              )}
              {r.amenityTypes.length > 0 && (
                <div style={s.amenityRow}>
                  {r.amenityTypes.slice(0, 6).map((a, i) => (
                    <span key={i} style={s.amenityTag}>{a}</span>
                  ))}
                  {r.amenityTypes.length > 6 && <span style={s.mutedSmall}>+{r.amenityTypes.length - 6} more</span>}
                </div>
              )}
              </div>
            </div>
          ))}
        </div>
      )}

      {bookingHotel && lastSearch && (
        <TripgicHotelCheckout
          hotelId={bookingHotel.accommodationId}
          hotelName={bookingHotel.name}
          search={lastSearch}
          onClose={() => setBookingHotel(null)}
          onBooked={() => setOrdersKey((k) => k + 1)}
        />
      )}

      <TripgicOrders product="hotel" refreshKey={ordersKey} />
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
  banner: { background: C.goldLight, color: C.goldDark, padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  stayCard: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, display: 'flex', gap: 16, alignItems: 'flex-start' },
  photo: { width: 96, height: 72, objectFit: 'cover' as const, borderRadius: 8, flexShrink: 0, background: C.soft },
  stayBody: { flex: 1, minWidth: 0 },
  stayHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  stayName: { fontSize: 15, fontWeight: 600, color: C.text, flex: 1 },
  providerTag: { fontSize: 11, color: C.muted, background: C.bg, borderRadius: 6, padding: '2px 8px' },
  price: { fontSize: 16, fontWeight: 700, color: C.goldDark },
  staySub: { fontSize: 13, color: C.muted, margin: '0 0 10px' },
  amenityRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' },
  bookBtn: { padding: '8px 18px', background: C.gold, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', margin: '0 0 10px' },
  amenityTag: { fontSize: 11, color: C.text, background: C.soft, borderRadius: 6, padding: '3px 9px' },
};
