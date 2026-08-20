import React, { useState } from 'react';
import api from '../services/api.web';

// ─── Design tokens ─────────────────────────────────────────────────────────
// Matches TripsScreen.web.tsx / CommunityScreen.web.tsx / AppShell.web.tsx.
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

interface FlightSegment {
  marketingCarrier: string;
  flightNumber: string;
  departingAt: string;
  arrivingAt: string;
}

interface FlightSlice {
  originAirport: string;
  originCity: string | null;
  destinationAirport: string;
  destinationCity: string | null;
  departingAt: string;
  arrivingAt: string;
  durationMinutes: number | null;
  stops: number;
  segments: FlightSegment[];
}

interface FlightOffer {
  id: string;
  airline: string;
  airlineLogoUrl: string | null;
  slices: FlightSlice[];
  baseAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  expiresAt: string;
}

function formatDuration(minutes: number | null): string {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatStops(stops: number): string {
  if (stops === 0) return 'Nonstop';
  return `${stops} stop${stops > 1 ? 's' : ''}`;
}

export default function FlightsScreen() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [adults, setAdults] = useState(1);
  const [cabinClass, setCabinClass] = useState<'economy' | 'premium_economy' | 'business' | 'first'>('economy');

  const [offers, setOffers] = useState<FlightOffer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (origin.length !== 3 || destination.length !== 3) {
      setError('Enter valid 3-letter airport codes (e.g. SYD, LHR).');
      return;
    }
    if (!departureDate) { setError('Pick a departure date.'); return; }

    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await api.post('/flights/search', {
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        departureDate,
        returnDate: returnDate || undefined,
        adults,
        cabinClass,
      });
      setOffers(res.data.offers || []);
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setError("Flight search isn't turned on yet.");
      } else {
        setError(err?.response?.data?.message || 'Could not search flights.');
      }
      setOffers(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Flights</h1>
        <p style={s.subtitle}>Search real fares. Booking is coming soon -- for now, this shows you what's available and what it costs.</p>
      </div>

      <div style={s.searchCard}>
        <div style={s.searchRow}>
          <div style={s.field}>
            <label style={s.label}>From</label>
            <input style={s.input} value={origin} onChange={(e) => setOrigin(e.target.value.toUpperCase())} placeholder="SYD" maxLength={3} />
          </div>
          <div style={s.field}>
            <label style={s.label}>To</label>
            <input style={s.input} value={destination} onChange={(e) => setDestination(e.target.value.toUpperCase())} placeholder="DPS" maxLength={3} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Departure</label>
            <input style={s.input} type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Return (optional)</label>
            <input style={s.input} type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
          <div style={s.fieldNarrow}>
            <label style={s.label}>Adults</label>
            <input style={s.input} type="number" min={1} max={9} value={adults} onChange={(e) => setAdults(parseInt(e.target.value, 10) || 1)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Cabin</label>
            <select style={s.input} value={cabinClass} onChange={(e) => setCabinClass(e.target.value as any)}>
              <option value="economy">Economy</option>
              <option value="premium_economy">Premium economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
          </div>
        </div>
        <button style={s.searchBtn} disabled={loading} onClick={handleSearch}>
          {loading ? 'Searching...' : 'Search flights'}
        </button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {searched && !loading && offers && offers.length === 0 && !error && (
        <p style={s.muted}>No flights found for that search.</p>
      )}

      {offers && offers.length > 0 && (
        <div style={s.results}>
          {offers.map((offer) => (
            <div key={offer.id} style={s.offerCard}>
              <div style={s.offerHeader}>
                {offer.airlineLogoUrl && <img src={offer.airlineLogoUrl} alt={offer.airline} style={s.airlineLogo} />}
                <span style={s.airlineName}>{offer.airline}</span>
                <span style={s.price}>${offer.totalAmount.toFixed(2)} {offer.currency}</span>
              </div>

              {offer.slices.map((slice, i) => (
                <div key={i} style={s.sliceRow}>
                  <div style={s.sliceTimes}>
                    <span style={s.sliceTime}>{formatTime(slice.departingAt)}</span>
                    <span style={s.sliceAirport}>{slice.originAirport}</span>
                  </div>
                  <div style={s.sliceMiddle}>
                    <span style={s.mutedSmall}>{formatDuration(slice.durationMinutes)}</span>
                    <div style={s.sliceLine} />
                    <span style={s.mutedSmall}>{formatStops(slice.stops)}</span>
                  </div>
                  <div style={s.sliceTimes}>
                    <span style={s.sliceTime}>{formatTime(slice.arrivingAt)}</span>
                    <span style={s.sliceAirport}>{slice.destinationAirport}</span>
                  </div>
                </div>
              ))}

              <p style={s.disclosure}>Fare shown includes Drift's booking fee. Booking isn't available yet.</p>
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
  offerCard: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 },
  offerHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  airlineLogo: { width: 24, height: 24, objectFit: 'contain' as const },
  airlineName: { fontSize: 14, fontWeight: 600, color: C.text, flex: 1 },
  price: { fontSize: 18, fontWeight: 700, color: C.goldDark },
  sliceRow: { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderTop: `1px solid ${C.border}` },
  sliceTimes: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', minWidth: 60 },
  sliceTime: { fontSize: 15, fontWeight: 600, color: C.text },
  sliceAirport: { fontSize: 12, color: C.muted },
  sliceMiddle: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4 },
  sliceLine: { width: '100%', height: 1, background: C.border },
  disclosure: { fontSize: 11, color: C.muted, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` },
};
