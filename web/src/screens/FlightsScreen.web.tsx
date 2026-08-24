import React, { useState, useEffect, useMemo } from 'react';
import api from '../services/api.web';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardNumberElement, CardExpiryElement, CardCvcElement, useStripe, useElements } from '@stripe/react-stripe-js';

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

interface FlightOfferPassenger {
  id: string;
  type: string | null;
  age: number | null;
}

interface FlightOffer {
  id: string;
  airline: string;
  airlineLogoUrl: string | null;
  slices: FlightSlice[];
  passengers: FlightOfferPassenger[];
  baseAmount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  expiresAt: string;
}

interface PassengerForm {
  id: string;
  type: string | null;
  title: 'mr' | 'ms' | 'mrs' | 'miss';
  gender: 'm' | 'f';
  givenName: string;
  familyName: string;
  bornOn: string;
  email: string;
  phoneNumber: string;
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

// Duffel's Payment Intent client_token is a base64 JSON blob wrapping the
// underlying Stripe client_secret + publishable_key (Duffel Payments runs
// on Stripe) -- confirmed live by decoding a real token, not documented
// anywhere. Decoding it ourselves and driving Stripe Elements directly
// (instead of @duffel/components' DuffelPayments, which renders Stripe's
// PaymentElement with no layout or field control) is what makes a
// multi-row card form and a hidden/backfilled postal code possible --
// neither is configurable through DuffelPayments' props.
function decodeClientToken(token: string): { clientSecret: string; publishableKey: string } {
  const parsed = JSON.parse(atob(token));
  return { clientSecret: parsed.client_secret, publishableKey: parsed.publishable_key };
}

const stripeElementStyle = {
  base: {
    fontSize: '14px',
    color: C.text,
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    '::placeholder': { color: C.muted },
  },
  invalid: { color: '#c62828' },
};

// Raw card data never reaches Drift's servers -- Stripe Elements collect
// it directly into Stripe's own iframes. We only ever see a card's
// completion state (usable/not), never its number, expiry, or CVC.
function StripeCardFields({
  clientSecret,
  onSuccess,
  onFailure,
}: {
  clientSecret: string;
  onSuccess: () => void;
  onFailure: (err: any) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    const cardNumberElement = elements.getElement(CardNumberElement);
    if (!cardNumberElement) return;
    setSubmitting(true);
    try {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardNumberElement,
          // No postal/address field is shown to the traveler -- we don't
          // collect a billing address anywhere in this checkout, so a
          // fixed placeholder goes to Stripe instead of asking for one.
          // Stripe treats an unverifiable postal code as an AVS mismatch,
          // not a decline; it doesn't block the charge.
          billing_details: { address: { postal_code: '00000' } },
        },
      });
      if (result.error) {
        onFailure(result.error);
        setSubmitting(false);
        return;
      }
      if (result.paymentIntent?.status === 'succeeded' || result.paymentIntent?.status === 'requires_capture') {
        onSuccess();
      } else {
        onFailure({ message: `Payment status: ${result.paymentIntent?.status ?? 'unknown'}. Try a different card.` });
        setSubmitting(false);
      }
    } catch (err: any) {
      onFailure(err);
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={cs.cardFieldFull}>
        <CardNumberElement options={{ style: stripeElementStyle }} />
      </div>
      <div style={cs.passengerRow}>
        <div style={cs.cardFieldHalf}>
          <CardExpiryElement options={{ style: stripeElementStyle }} />
        </div>
        <div style={cs.cardFieldHalf}>
          <CardCvcElement options={{ style: stripeElementStyle }} />
        </div>
      </div>
      <button style={s.searchBtn} disabled={!stripe || submitting} onClick={handlePay}>
        {submitting ? 'Charging...' : 'Pay'}
      </button>
    </div>
  );
}

// Checkout: Payment Intent -> Balance -> Order (see RISK-REGISTER.md R12).
// Stripe Elements (via StripeCardFields above) collect the card directly
// into Stripe's iframes -- raw card data never reaches Drift's servers.
// Confirming the Payment Intent client-side charges the traveler; the
// backend then confirms it server-side and spends from Drift's Balance to
// place the actual order.
function CheckoutModal({
  offer,
  onClose,
  onBooked,
}: {
  offer: FlightOffer;
  onClose: () => void;
  onBooked: (booking: { bookingReference: string }) => void;
}) {
  const [step, setStep] = useState<'passengers' | 'payment' | 'submitting'>('passengers');
  const [passengers, setPassengers] = useState<PassengerForm[]>(
    offer.passengers.map((p) => ({
      id: p.id,
      type: p.type,
      title: 'mr',
      gender: 'm',
      givenName: '',
      familyName: '',
      bornOn: '',
      email: '',
      phoneNumber: '',
    }))
  );
  const [paymentIntent, setPaymentIntent] = useState<{ id: string; clientToken: string; amount: string; currency: string } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updatePassenger = (idx: number, field: keyof PassengerForm, value: string) => {
    setPassengers((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const passengersValid = passengers.every((p) => p.givenName && p.familyName && p.bornOn && p.email && p.phoneNumber);

  const handleContinueToPayment = async () => {
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/flights/payment-intents', { offerId: offer.id });
      setPaymentIntent(res.data);
      setStep('payment');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not start payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCardSuccess = async () => {
    if (!paymentIntent) return;
    setStep('submitting');
    setError('');
    try {
      await api.post('/flights/payment-intents/confirm', { paymentIntentId: paymentIntent.id });
      const res = await api.post('/flights/orders', {
        offerId: offer.id,
        paymentIntentId: paymentIntent.id,
        passengers: passengers.map((p) => ({
          id: p.id,
          title: p.title,
          gender: p.gender,
          givenName: p.givenName,
          familyName: p.familyName,
          bornOn: p.bornOn,
          email: p.email,
          phoneNumber: p.phoneNumber,
        })),
      });
      onBooked(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not complete booking -- your card was charged, contact support with this reference: ' + paymentIntent.id);
      setStep('payment');
    }
  };

  const handleCardFailure = (cardErr: any) => {
    setError(cardErr?.message || 'Card was declined. Try a different card.');
  };

  const stripeData = useMemo(
    () => (paymentIntent ? decodeClientToken(paymentIntent.clientToken) : null),
    [paymentIntent]
  );
  const stripePromise = useMemo(
    () => (stripeData ? loadStripe(stripeData.publishableKey) : null),
    [stripeData]
  );

  return (
    <div style={cs.overlay} onClick={onClose}>
      <div style={cs.modal} onClick={(e) => e.stopPropagation()}>
        <div style={cs.modalHeader}>
          <h2 style={cs.modalTitle}>{step === 'passengers' ? 'Passenger details' : 'Payment'}</h2>
          <button style={cs.closeBtn} onClick={onClose}>✕</button>
        </div>

        {error && <div style={s.error}>{error}</div>}

        {step === 'passengers' && (
          <>
            {passengers.map((p, idx) => (
              <div key={p.id} style={cs.passengerBlock}>
                <p style={cs.passengerLabel}>Passenger {idx + 1} ({p.type || 'adult'})</p>
                <div style={cs.passengerRow}>
                  <select style={s.input} value={p.title} onChange={(e) => updatePassenger(idx, 'title', e.target.value)}>
                    <option value="mr">Mr</option>
                    <option value="ms">Ms</option>
                    <option value="mrs">Mrs</option>
                    <option value="miss">Miss</option>
                  </select>
                  <select style={s.input} value={p.gender} onChange={(e) => updatePassenger(idx, 'gender', e.target.value)}>
                    <option value="m">Male</option>
                    <option value="f">Female</option>
                  </select>
                </div>
                <div style={cs.passengerRow}>
                  <input style={s.input} placeholder="Given name" value={p.givenName} onChange={(e) => updatePassenger(idx, 'givenName', e.target.value)} />
                  <input style={s.input} placeholder="Family name" value={p.familyName} onChange={(e) => updatePassenger(idx, 'familyName', e.target.value)} />
                </div>
                <div style={cs.passengerRow}>
                  <input style={s.input} type="date" value={p.bornOn} onChange={(e) => updatePassenger(idx, 'bornOn', e.target.value)} />
                  <input style={s.input} type="email" placeholder="Email" value={p.email} onChange={(e) => updatePassenger(idx, 'email', e.target.value)} />
                </div>
                <input style={s.input} placeholder="Phone, e.g. +61412345678" value={p.phoneNumber} onChange={(e) => updatePassenger(idx, 'phoneNumber', e.target.value)} />
              </div>
            ))}
            <button style={s.searchBtn} disabled={!passengersValid || submitting} onClick={handleContinueToPayment}>
              {submitting ? 'Loading...' : `Continue to payment -- $${offer.totalAmount.toFixed(2)} ${offer.currency}`}
            </button>
          </>
        )}

        {step === 'payment' && paymentIntent && stripeData && stripePromise && (
          <>
            <p style={s.muted}>Charging ${paymentIntent.amount} {paymentIntent.currency}</p>
            <Elements stripe={stripePromise}>
              <StripeCardFields
                clientSecret={stripeData.clientSecret}
                onSuccess={handleCardSuccess}
                onFailure={handleCardFailure}
              />
            </Elements>
          </>
        )}

        {step === 'submitting' && <p style={s.muted}>Booking your flight...</p>}
      </div>
    </div>
  );
}

interface FlightOrderSummary {
  id: string;
  bookingReference: string;
  status: string;
  priceChargedAmount: number;
  priceChargedCurrency: string;
  createdAt: string;
  slices: FlightSlice[];
}

export default function FlightsScreen() {
  const [tripType, setTripType] = useState<'roundtrip' | 'oneway'>('roundtrip');
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
  const [checkoutOffer, setCheckoutOffer] = useState<FlightOffer | null>(null);
  const [booking, setBooking] = useState<{ bookingReference: string } | null>(null);
  const [myOrders, setMyOrders] = useState<FlightOrderSummary[]>([]);

  const loadMyOrders = () => {
    api.get('/flights/orders').then((res) => setMyOrders(res.data.orders || [])).catch(() => {});
  };

  useEffect(() => { loadMyOrders(); }, []);

  const handleTripTypeChange = (next: 'roundtrip' | 'oneway') => {
    setTripType(next);
    if (next === 'oneway') setReturnDate('');
  };

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
      // The shared axios client defaults to a 10s timeout, which is too
      // tight for this call specifically -- Duffel's own search response
      // time varies with result-set size and isn't something our backend
      // controls (the ~20s DB-side bug is fixed, see WP10.7; this is a
      // separate, real ~10-15s ceiling on Duffel's side for larger
      // result sets). A real search that succeeded server-side in ~11s
      // was previously aborted client-side and shown as a generic
      // failure -- confirmed live in production logs.
      const res = await api.post('/flights/search', {
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        departureDate,
        returnDate: tripType === 'roundtrip' && returnDate ? returnDate : undefined,
        adults,
        cabinClass,
      }, { timeout: 30000 });
      setOffers(res.data.offers || []);
    } catch (err: any) {
      if (err?.response?.status === 503) {
        setError("Flight search isn't turned on yet.");
      } else if (err?.code === 'ECONNABORTED') {
        setError('Search is taking longer than usual -- please try again.');
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
        <p style={s.subtitle}>Search real fares and book directly.</p>
      </div>

      <div style={s.searchCard}>
        <div style={s.tripTypeRow}>
          <button
            type="button"
            style={{ ...s.tripTypeBtn, ...(tripType === 'roundtrip' ? s.tripTypeBtnActive : {}) }}
            onClick={() => handleTripTypeChange('roundtrip')}
          >
            Round trip
          </button>
          <button
            type="button"
            style={{ ...s.tripTypeBtn, ...(tripType === 'oneway' ? s.tripTypeBtnActive : {}) }}
            onClick={() => handleTripTypeChange('oneway')}
          >
            One way
          </button>
        </div>
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
          {tripType === 'roundtrip' && (
            <div style={s.field}>
              <label style={s.label}>Return</label>
              <input style={s.input} type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
          )}
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

      {booking && (
        <div style={s.confirmation}>
          Booked! Your confirmation code is <strong>{booking.bookingReference}</strong>.
        </div>
      )}

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

              <p style={s.disclosure}>Fare shown includes Drift's booking fee.</p>
              <button style={s.bookBtn} onClick={() => { setBooking(null); setCheckoutOffer(offer); }}>
                Book this flight
              </button>
            </div>
          ))}
        </div>
      )}

      {checkoutOffer && (
        <CheckoutModal
          offer={checkoutOffer}
          onClose={() => setCheckoutOffer(null)}
          onBooked={(b) => { setBooking(b); setCheckoutOffer(null); loadMyOrders(); }}
        />
      )}

      {myOrders.length > 0 && (
        <div style={s.myBookings}>
          <h2 style={s.myBookingsTitle}>Your bookings</h2>
          {myOrders.map((order) => (
            <div key={order.id} style={s.myBookingCard}>
              <div style={s.myBookingHeader}>
                <span style={s.myBookingRef}>{order.bookingReference}</span>
                <span style={s.myBookingStatus}>{order.status}</span>
                <span style={s.price}>${order.priceChargedAmount.toFixed(2)} {order.priceChargedCurrency}</span>
              </div>
              {order.slices.map((slice, i) => (
                <p key={i} style={s.myBookingSlice}>
                  {slice.originAirport} → {slice.destinationAirport} · {formatTime(slice.departingAt)} - {formatTime(slice.arrivingAt)}
                </p>
              ))}
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
  tripTypeRow: { display: 'flex', gap: 8, marginBottom: 14 },
  tripTypeBtn: { padding: '7px 16px', borderRadius: 20, border: `1.5px solid ${C.border}`, background: C.bg, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  tripTypeBtnActive: { background: C.goldLight, borderColor: C.gold, color: C.goldDark },
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
  bookBtn: { marginTop: 10, width: '100%', padding: '11px 22px', background: C.gold, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  confirmation: { background: '#E8F5E9', color: '#2E7D32', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 },
  myBookings: { marginTop: 32 },
  myBookingsTitle: { fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 12, fontFamily: "'DM Serif Display', serif" },
  myBookingCard: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 },
  myBookingHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
  myBookingRef: { fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: '0.5px' },
  myBookingStatus: { fontSize: 11, color: C.goldDark, background: C.goldLight, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase' as const, fontWeight: 600, flex: 1 },
  myBookingSlice: { fontSize: 13, color: C.muted, margin: '2px 0' },
};

const cs: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 },
  modal: { background: C.white, borderRadius: 16, padding: 24, width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' as const },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'DM Serif Display', serif" },
  closeBtn: { background: 'none', border: 'none', fontSize: 16, color: C.muted, cursor: 'pointer', padding: 4 },
  passengerBlock: { marginBottom: 16, paddingBottom: 16, borderBottom: `1px solid ${C.border}` },
  passengerLabel: { fontSize: 12, fontWeight: 600, color: C.muted, textTransform: 'uppercase' as const, letterSpacing: '0.4px', marginBottom: 8 },
  passengerRow: { display: 'flex', gap: 10, marginBottom: 10 },
  cardFieldFull: { padding: '10px 12px', border: `1.5px solid ${C.border}`, borderRadius: 8, background: C.bg, marginBottom: 10 },
  cardFieldHalf: { flex: 1, padding: '10px 12px', border: `1.5px solid ${C.border}`, borderRadius: 8, background: C.bg },
};
