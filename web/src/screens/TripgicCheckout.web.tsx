import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// Booking UI for TripGic flights and hotels (backend: routes/tripgic.ts,
// services/tripgicBooking.ts). The client never sends a price: the quote
// step returns one, the order step is keyed on the quote id, and the
// server charges exactly what it stored.
//
// TripGic bookings are sandbox-only until Drift has its own card
// processing (TripGic takes no customer payment), and are limited to admin
// accounts -- useTripgicBookingEnabled() is how a screen finds out whether
// to show a Book button at all.

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

export function useTripgicBookingEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/tripgic/status')
      .then((res) => { if (alive) setEnabled(!!res.data.bookingEnabled); })
      .catch(() => { /* not enabled -- no Book buttons, browse still works */ });
    return () => { alive = false; };
  }, []);
  return enabled;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Quote {
  quoteId: string;
  title: string;
  details: any;
  totalAmount: number;
  currency: string;
  priceChanged: boolean;
  previousAmount: number | null;
  adultCount: number;
  roomOccupancies: number[];
  holdPossible: boolean;
  docRequired: boolean;
  expiresAt: string;
  paymentMode: string;
}

export interface TripgicOrder {
  id: string;
  product: 'flight' | 'hotel';
  status: 'held' | 'ticketed' | 'confirmed' | 'cancelled' | 'expired' | 'failed';
  title: string;
  details: any;
  priceChargedAmount: number;
  currency: string;
  bookingId: string | null;
  supplierReference: string | null;
  paymentStatus: string;
  fulfilled: boolean;
  message: string | null;
  voucherUrl: string | null;
  holdExpiresAt: string | null;
  canCancel: boolean;
  createdAt: string;
}

interface Contact { email: string; isdCode: string; phoneNumber: string }
interface Person { title: 'mr' | 'ms' | 'mrs' | 'miss'; gender: 'm' | 'f'; givenName: string; familyName: string }
interface FlightPax extends Person { bornOn: string; passportNumber: string; passportCountry: string; passportExpiry: string }

const money = (amount: number, currency: string) => `$${amount.toFixed(2)} ${currency}`;
const digits = (v: string) => v.replace(/\D/g, '');
const apiMessage = (err: any, fallback: string) => err?.response?.data?.message || fallback;

// ─── Shared pieces ──────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHeader}>
          <h2 style={s.modalTitle}>{title}</h2>
          <button style={s.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SandboxNotice({ mode }: { mode: string }) {
  if (mode !== 'not_collected_sandbox') return null;
  return <div style={s.notice}>Test booking -- no payment is taken and nothing is charged to a card.</div>;
}

function PersonFields({ label, person, onChange }: { label: string; person: Person; onChange: (patch: Partial<Person>) => void }) {
  return (
    <>
      <p style={s.blockLabel}>{label}</p>
      <div style={s.row}>
        <select style={s.input} value={person.title} onChange={(e) => onChange({ title: e.target.value as Person['title'] })}>
          <option value="mr">Mr</option><option value="ms">Ms</option><option value="mrs">Mrs</option><option value="miss">Miss</option>
        </select>
        <select style={s.input} value={person.gender} onChange={(e) => onChange({ gender: e.target.value as Person['gender'] })}>
          <option value="m">Male</option><option value="f">Female</option>
        </select>
      </div>
      <div style={s.row}>
        <input style={s.input} placeholder="Given name" value={person.givenName} onChange={(e) => onChange({ givenName: e.target.value })} />
        <input style={s.input} placeholder="Family name" value={person.familyName} onChange={(e) => onChange({ familyName: e.target.value })} />
      </div>
    </>
  );
}

function ContactFields({ contact, onChange }: { contact: Contact; onChange: (patch: Partial<Contact>) => void }) {
  return (
    <div style={s.block}>
      <p style={s.blockLabel}>Contact</p>
      <input style={s.input} type="email" placeholder="Email" value={contact.email} onChange={(e) => onChange({ email: e.target.value })} />
      <div style={{ ...s.row, marginTop: 8, marginBottom: 0 }}>
        <input style={{ ...s.input, flex: '0 0 80px' }} inputMode="numeric" placeholder="+61" value={contact.isdCode} onChange={(e) => onChange({ isdCode: digits(e.target.value) })} />
        <input style={s.input} inputMode="numeric" placeholder="Mobile, e.g. 0412345678" value={contact.phoneNumber} onChange={(e) => onChange({ phoneNumber: digits(e.target.value) })} />
      </div>
    </div>
  );
}

const contactValid = (c: Contact) => /\S+@\S+\.\S+/.test(c.email) && c.isdCode.length >= 1 && c.phoneNumber.length >= 5;
const personValid = (p: Person) => p.givenName.trim().length > 0 && p.familyName.trim().length > 0;

function PriceBar({ quote }: { quote: Quote }) {
  return (
    <div style={s.priceBar}>
      <div>
        <div style={s.priceLabel}>Total</div>
        <div style={s.priceValue}>{money(quote.totalAmount, quote.currency)}</div>
      </div>
      {quote.priceChanged && quote.previousAmount != null && (
        <div style={s.priceChanged}>Price changed from {money(quote.previousAmount, quote.currency)}</div>
      )}
    </div>
  );
}

function OrderResult({ order, onClose }: { order: TripgicOrder; onClose: () => void }) {
  const good = order.fulfilled;
  return (
    <>
      <div style={{ ...s.resultBox, borderColor: good ? '#2e7d32' : C.gold, background: good ? '#f1f8f1' : C.goldLight }}>
        <div style={s.resultTitle}>{good ? (order.product === 'flight' ? 'Tickets issued' : 'Stay confirmed') : 'Reserved -- not finalised yet'}</div>
        <p style={s.resultText}>{order.message}</p>
      </div>
      <div style={s.summary}>
        <div style={s.summaryRow}><span>Booking</span><strong>{order.title}</strong></div>
        {order.bookingId && <div style={s.summaryRow}><span>Reference</span><strong>{order.bookingId}</strong></div>}
        {order.supplierReference && <div style={s.summaryRow}><span>{order.product === 'flight' ? 'Airline reference' : 'Confirmation'}</span><strong>{order.supplierReference}</strong></div>}
        <div style={s.summaryRow}><span>Total</span><strong>{money(order.priceChargedAmount, order.currency)}</strong></div>
        {order.paymentStatus === 'not_collected_sandbox' && <div style={s.summaryRow}><span>Payment</span><strong>Test booking -- not charged</strong></div>}
        {order.holdExpiresAt && !good && <div style={s.summaryRow}><span>Held until</span><strong>{new Date(order.holdExpiresAt).toLocaleString()}</strong></div>}
      </div>
      <button style={s.primaryBtn} onClick={onClose}>Done</button>
    </>
  );
}

// ─── Flight checkout ────────────────────────────────────────────────────────

const emptyFlightPax = (): FlightPax => ({ title: 'mr', gender: 'm', givenName: '', familyName: '', bornOn: '', passportNumber: '', passportCountry: 'AU', passportExpiry: '' });

export function TripgicFlightCheckout({ offerId, onClose, onBooked }: { offerId: string; onClose: () => void; onBooked: (order: TripgicOrder) => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadError, setLoadError] = useState('');
  const [pax, setPax] = useState<FlightPax[]>([]);
  const [contact, setContact] = useState<Contact>({ email: '', isdCode: '61', phoneNumber: '' });
  const [acceptPrice, setAcceptPrice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<TripgicOrder | null>(null);

  useEffect(() => {
    let alive = true;
    api.post('/tripgic/flights/quote', { offerId }, { timeout: 30000 })
      .then((res) => {
        if (!alive) return;
        setQuote(res.data);
        setPax(Array.from({ length: res.data.adultCount }, emptyFlightPax));
      })
      .catch((err) => { if (alive) setLoadError(apiMessage(err, 'Could not confirm this fare.')); });
    return () => { alive = false; };
  }, [offerId]);

  const paxValid = pax.every((p) => personValid(p) && p.bornOn && (!quote?.docRequired || (p.passportNumber.length >= 5 && p.passportCountry.length === 2 && p.passportExpiry)));
  const canSubmit = !!quote && paxValid && contactValid(contact) && (!quote.priceChanged || acceptPrice) && !submitting;

  const submit = async () => {
    if (!quote) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/tripgic/flights/orders', {
        quoteId: quote.quoteId,
        passengers: pax.map((p) => ({
          title: p.title, gender: p.gender, givenName: p.givenName.trim(), familyName: p.familyName.trim(), bornOn: p.bornOn,
          ...(p.passportNumber ? { passportNumber: p.passportNumber, passportCountry: p.passportCountry.toUpperCase(), passportExpiry: p.passportExpiry } : {}),
        })),
        contact: { email: contact.email.trim(), isdCode: contact.isdCode, phoneNumber: contact.phoneNumber },
        acceptPriceChange: acceptPrice || undefined,
      }, { timeout: 90000 });
      setOrder(res.data);
      onBooked(res.data);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'price_changed') {
        setQuote((q) => (q ? { ...q, priceChanged: true, totalAmount: data.totalAmount, previousAmount: data.previousAmount } : q));
      }
      setError(apiMessage(err, 'Could not complete the booking.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={order ? 'Booking' : 'Passenger details'} onClose={onClose}>
      {loadError && <div style={s.error}>{loadError}</div>}
      {!quote && !loadError && <p style={s.muted}>Confirming this fare...</p>}
      {quote && order && <OrderResult order={order} onClose={onClose} />}
      {quote && !order && (
        <>
          <p style={s.tripTitle}>{quote.title}</p>
          <PriceBar quote={quote} />
          <SandboxNotice mode={quote.paymentMode} />
          {error && <div style={s.error}>{error}</div>}
          {pax.map((p, i) => (
            <div key={i} style={s.block}>
              <PersonFields label={`Passenger ${i + 1}`} person={p} onChange={(patch) => setPax((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))} />
              <div style={s.row}>
                <div style={s.field}><label style={s.smallLabel}>Date of birth</label>
                  <input style={s.input} type="date" value={p.bornOn} onChange={(e) => setPax((prev) => prev.map((x, j) => (j === i ? { ...x, bornOn: e.target.value } : x)))} /></div>
              </div>
              {quote.docRequired && (
                <>
                  <div style={s.row}>
                    <input style={s.input} placeholder="Passport number" value={p.passportNumber} onChange={(e) => setPax((prev) => prev.map((x, j) => (j === i ? { ...x, passportNumber: e.target.value.replace(/[^A-Za-z0-9]/g, '') } : x)))} />
                    <input style={{ ...s.input, flex: '0 0 70px' }} maxLength={2} placeholder="AU" value={p.passportCountry} onChange={(e) => setPax((prev) => prev.map((x, j) => (j === i ? { ...x, passportCountry: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() } : x)))} />
                  </div>
                  <div style={s.field}><label style={s.smallLabel}>Passport expiry</label>
                    <input style={s.input} type="date" value={p.passportExpiry} onChange={(e) => setPax((prev) => prev.map((x, j) => (j === i ? { ...x, passportExpiry: e.target.value } : x)))} /></div>
                </>
              )}
            </div>
          ))}
          <ContactFields contact={contact} onChange={(patch) => setContact((c) => ({ ...c, ...patch }))} />
          {quote.priceChanged && (
            <label style={s.check}><input type="checkbox" checked={acceptPrice} onChange={(e) => setAcceptPrice(e.target.checked)} /> I accept the new price</label>
          )}
          <button style={{ ...s.primaryBtn, opacity: canSubmit ? 1 : 0.5 }} disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Booking...' : `Book -- ${money(quote.totalAmount, quote.currency)}`}
          </button>
        </>
      )}
    </Modal>
  );
}

// ─── Hotel checkout ─────────────────────────────────────────────────────────

interface Room {
  roomTrackingId: string;
  title: string;
  totalAmount: number;
  currency: string;
  refundable: boolean;
  freeCancellationUntil: string | null;
  holdPossible: boolean;
  meals: string[];
  beds: string[];
  amenities: string[];
}

export interface HotelSearchContext { checkInDate: string; checkOutDate: string; rooms: number; adults: number }

const emptyGuest = (): Person => ({ title: 'mr', gender: 'm', givenName: '', familyName: '' });

export function TripgicHotelCheckout({ hotelId, hotelName, search, onClose, onBooked }: {
  hotelId: string; hotelName: string; search: HotelSearchContext; onClose: () => void; onBooked: (order: TripgicOrder) => void;
}) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [trackingId, setTrackingId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [guests, setGuests] = useState<Person[]>([]);
  const [contact, setContact] = useState<Contact>({ email: '', isdCode: '61', phoneNumber: '' });
  const [requests, setRequests] = useState('');
  const [acceptPrice, setAcceptPrice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<TripgicOrder | null>(null);

  useEffect(() => {
    let alive = true;
    api.post('/tripgic/hotels/rooms', { hotelId, ...search }, { timeout: 60000 })
      .then((res) => { if (alive) { setRooms(res.data.rooms || []); setTrackingId(res.data.trackingId); } })
      .catch((err) => { if (alive) setLoadError(apiMessage(err, 'Could not load rooms.')); });
    return () => { alive = false; };
  }, [hotelId, search]);

  const chooseRoom = async (room: Room) => {
    setQuoting(true);
    setError('');
    try {
      const res = await api.post('/tripgic/hotels/quote', { trackingId, roomTrackingId: room.roomTrackingId }, { timeout: 30000 });
      setQuote(res.data);
      setGuests(Array.from({ length: res.data.adultCount }, emptyGuest));
    } catch (err: any) {
      setError(apiMessage(err, 'That room is no longer available.'));
    } finally {
      setQuoting(false);
    }
  };

  const canSubmit = !!quote && guests.every(personValid) && contactValid(contact) && (!quote.priceChanged || acceptPrice) && !submitting;

  const submit = async () => {
    if (!quote) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/tripgic/hotels/orders', {
        quoteId: quote.quoteId,
        guests: guests.map((g) => ({ title: g.title, gender: g.gender, givenName: g.givenName.trim(), familyName: g.familyName.trim() })),
        contact: { email: contact.email.trim(), isdCode: contact.isdCode, phoneNumber: contact.phoneNumber },
        specialRequests: requests.trim() || undefined,
        acceptPriceChange: acceptPrice || undefined,
      }, { timeout: 90000 });
      setOrder(res.data);
      onBooked(res.data);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'price_changed') {
        setQuote((q) => (q ? { ...q, priceChanged: true, totalAmount: data.totalAmount, previousAmount: data.previousAmount } : q));
      }
      setError(apiMessage(err, 'Could not complete the booking.'));
    } finally {
      setSubmitting(false);
    }
  };

  const nights = Math.max(1, Math.round((new Date(search.checkOutDate).getTime() - new Date(search.checkInDate).getTime()) / 86400000));

  return (
    <Modal title={order ? 'Booking' : quote ? 'Guest details' : `Rooms -- ${hotelName}`} onClose={onClose}>
      {loadError && <div style={s.error}>{loadError}</div>}
      {order && <OrderResult order={order} onClose={onClose} />}

      {!order && !quote && (
        <>
          <p style={s.tripTitle}>{search.checkInDate} to {search.checkOutDate} · {nights} night{nights > 1 ? 's' : ''} · {search.adults} adult{search.adults > 1 ? 's' : ''}</p>
          {error && <div style={s.error}>{error}</div>}
          {!rooms && !loadError && <p style={s.muted}>Loading rooms...</p>}
          {rooms && rooms.length === 0 && <p style={s.muted}>No rooms are available for these dates.</p>}
          {rooms?.map((r) => (
            <div key={r.roomTrackingId} style={s.roomCard}>
              <div style={s.roomTop}>
                <span style={s.roomTitle}>{r.title}</span>
                <span style={s.roomPrice}>{money(r.totalAmount, r.currency)}</span>
              </div>
              <div style={s.roomMeta}>
                {r.beds.join(' or ')}{r.meals.length > 0 && ` · ${r.meals.join(', ')}`}
              </div>
              <div style={s.roomMeta}>
                {r.refundable
                  ? `Free cancellation${r.freeCancellationUntil ? ` until ${new Date(r.freeCancellationUntil).toLocaleDateString()}` : ''}`
                  : 'Non-refundable'}
              </div>
              {r.amenities.length > 0 && <div style={s.amenityRow}>{r.amenities.map((a, i) => <span key={i} style={s.amenityTag}>{a}</span>)}</div>}
              <button style={{ ...s.secondaryBtn, opacity: quoting ? 0.5 : 1 }} disabled={quoting} onClick={() => chooseRoom(r)}>
                {quoting ? 'Checking...' : 'Select'}
              </button>
            </div>
          ))}
        </>
      )}

      {!order && quote && (
        <>
          <p style={s.tripTitle}>{quote.title}</p>
          {quote.details?.roomTitle && <p style={s.roomMeta}>{quote.details.roomTitle}</p>}
          <PriceBar quote={quote} />
          <SandboxNotice mode={quote.paymentMode} />
          {error && <div style={s.error}>{error}</div>}
          {guests.map((g, i) => (
            <div key={i} style={s.block}>
              <PersonFields label={`Guest ${i + 1}${quote.roomOccupancies.length > 1 ? ` (room ${quote.roomOccupancies.reduce<number[]>((acc, n, ri) => acc.concat(Array(n).fill(ri + 1)), [])[i] ?? 1})` : ''}`} person={g}
                onChange={(patch) => setGuests((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))} />
            </div>
          ))}
          <ContactFields contact={contact} onChange={(patch) => setContact((c) => ({ ...c, ...patch }))} />
          <textarea style={{ ...s.input, marginTop: 12, minHeight: 56 }} maxLength={200} placeholder="Special requests (optional)" value={requests} onChange={(e) => setRequests(e.target.value)} />
          {quote.priceChanged && (
            <label style={s.check}><input type="checkbox" checked={acceptPrice} onChange={(e) => setAcceptPrice(e.target.checked)} /> I accept the new price</label>
          )}
          <button style={{ ...s.primaryBtn, opacity: canSubmit ? 1 : 0.5 }} disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Booking...' : `Book -- ${money(quote.totalAmount, quote.currency)}`}
          </button>
          <button style={s.linkBtn} onClick={() => { setQuote(null); setError(''); }}>Choose a different room</button>
        </>
      )}
    </Modal>
  );
}

// ─── The traveller's TripGic bookings ───────────────────────────────────────

const STATUS_LABEL: Record<TripgicOrder['status'], string> = {
  held: 'Reserved', ticketed: 'Ticketed', confirmed: 'Confirmed', cancelled: 'Cancelled', expired: 'Expired', failed: 'Failed',
};

export function TripgicOrders({ product, refreshKey }: { product: 'flight' | 'hotel'; refreshKey?: number }) {
  const [orders, setOrders] = useState<TripgicOrder[]>([]);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = () => api.get('/tripgic/orders').then((res) => setOrders((res.data.orders || []).filter((o: TripgicOrder) => o.product === product))).catch(() => {});
  useEffect(() => { load(); }, [product, refreshKey]);

  const cancel = async (id: string) => {
    setBusyId(id);
    setNotice('');
    try {
      await api.post(`/tripgic/orders/${id}/cancel`, {}, { timeout: 60000 });
      await load();
    } catch (err: any) {
      setNotice(apiMessage(err, 'Could not cancel this booking.'));
    } finally {
      setBusyId('');
    }
  };

  if (orders.length === 0) return null;
  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={s.listTitle}>Your {product === 'flight' ? 'flight' : 'hotel'} bookings</h2>
      {notice && <div style={s.error}>{notice}</div>}
      {orders.map((o) => (
        <div key={o.id} style={s.orderCard}>
          <div style={s.roomTop}>
            <span style={s.roomTitle}>{o.title}</span>
            <span style={{ ...s.pill, ...(o.fulfilled ? s.pillGood : o.status === 'held' ? s.pillWait : s.pillOff) }}>{STATUS_LABEL[o.status]}</span>
          </div>
          <div style={s.roomMeta}>
            {o.bookingId && <>Ref {o.bookingId} · </>}{money(o.priceChargedAmount, o.currency)}
            {o.paymentStatus === 'not_collected_sandbox' && ' · test booking'}
          </div>
          {o.message && <div style={s.roomMeta}>{o.message}</div>}
          {o.canCancel && (
            <button style={s.linkBtn} disabled={busyId === o.id} onClick={() => cancel(o.id)}>{busyId === o.id ? 'Cancelling...' : 'Cancel booking'}</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 },
  modal: { background: C.white, borderRadius: 16, padding: 24, width: '100%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'DM Serif Display', serif" },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: C.muted },
  tripTitle: { fontSize: 14, fontWeight: 600, color: C.text, margin: '0 0 10px' },
  muted: { color: C.muted, fontSize: 14 },
  error: { background: '#ffebee', color: '#c62828', padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13 },
  notice: { background: C.goldLight, color: C.goldDark, padding: '9px 12px', borderRadius: 8, marginBottom: 14, fontSize: 12 },
  block: { border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 12 },
  blockLabel: { fontSize: 12, fontWeight: 700, color: C.goldDark, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.4px' },
  smallLabel: { fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 },
  row: { display: 'flex', gap: 8, marginBottom: 8 },
  field: { flex: 1, marginBottom: 8 },
  input: { flex: 1, width: '100%', padding: '9px 11px', border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: C.bg, outline: 'none', fontFamily: 'inherit' },
  primaryBtn: { width: '100%', padding: '12px 20px', background: C.gold, color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
  secondaryBtn: { padding: '8px 18px', background: C.white, color: C.goldDark, border: `1.5px solid ${C.gold}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginTop: 10 },
  linkBtn: { background: 'none', border: 'none', color: C.goldDark, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: '10px 0 0', display: 'block' },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text, margin: '10px 0' },
  priceBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.soft, borderRadius: 10, padding: '10px 14px', marginBottom: 12 },
  priceLabel: { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.4px' },
  priceValue: { fontSize: 20, fontWeight: 700, color: C.goldDark },
  priceChanged: { fontSize: 12, color: '#c62828' },
  roomCard: { border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 10 },
  roomTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  roomTitle: { fontSize: 14, fontWeight: 600, color: C.text },
  roomPrice: { fontSize: 15, fontWeight: 700, color: C.goldDark, whiteSpace: 'nowrap' },
  roomMeta: { fontSize: 12, color: C.muted, marginTop: 4 },
  amenityRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  amenityTag: { fontSize: 11, color: C.text, background: C.soft, borderRadius: 6, padding: '3px 9px' },
  resultBox: { border: '1.5px solid', borderRadius: 12, padding: 14, marginBottom: 14 },
  resultTitle: { fontSize: 15, fontWeight: 700, color: C.text },
  resultText: { fontSize: 13, color: C.text, margin: '6px 0 0' },
  summary: { border: `1px solid ${C.border}`, borderRadius: 12, padding: '4px 14px', marginBottom: 10 },
  summaryRow: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: C.muted, padding: '8px 0', borderBottom: `1px solid ${C.border}` },
  listTitle: { fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 12px', fontFamily: "'DM Serif Display', serif" },
  orderCard: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 10 },
  pill: { fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' },
  pillGood: { background: '#e8f5e9', color: '#2e7d32' },
  pillWait: { background: C.goldLight, color: C.goldDark },
  pillOff: { background: C.soft, color: C.muted },
};
