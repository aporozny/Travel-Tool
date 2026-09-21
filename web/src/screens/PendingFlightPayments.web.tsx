import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// Payments that have gone through but have not become a booking (the order step failed, or the
// browser was closed part-way). Shown wherever a traveller looks for their flights so their money
// is never out of sight: Try again books it without paying again, and a refund can be requested.
// Renders nothing when there is nothing to show.

interface OpenPayment {
  paymentIntentId: string;
  status: string;
  summary: string | null;
  amount: number;
  currency: string;
  message: string;
  canRetry: boolean;
  canRequestRefund: boolean;
  createdAt: string;
}

export default function PendingFlightPayments({ onBooked }: { onBooked?: () => void }) {
  const [payments, setPayments] = useState<OpenPayment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [justBooked, setJustBooked] = useState<string | null>(null);

  const load = () => {
    api.get('/flights/payments/pending').then((r) => setPayments(r.data.payments || [])).catch(() => {});
  };
  useEffect(load, []);

  const retry = async (id: string) => {
    setBusy(id);
    setNotes((n) => ({ ...n, [id]: '' }));
    try {
      const r = await api.post(`/flights/payments/${id}/retry`, {});
      setJustBooked(r.data.bookingReference);
      onBooked?.();
    } catch (err: any) {
      setNotes((n) => ({ ...n, [id]: err?.response?.data?.message || 'We could not reach Drift. Nothing has been lost: please try again in a moment.' }));
    } finally {
      setBusy(null);
      load();
    }
  };

  const refund = async (id: string) => {
    if (!window.confirm('Ask us to refund this payment in full?')) return;
    setBusy(id);
    try {
      const r = await api.post(`/flights/payments/${id}/refund-request`);
      setNotes((n) => ({ ...n, [id]: r.data.message || 'Refund requested.' }));
    } catch (err: any) {
      setNotes((n) => ({ ...n, [id]: err?.response?.data?.message || 'We could not send that request. Please try again.' }));
    } finally {
      setBusy(null);
      load();
    }
  };

  if (!payments.length && !justBooked) return null;

  return (
    <div style={st.wrap}>
      {justBooked && <div style={st.success}>Booked! Your booking reference is <strong>{justBooked}</strong>.</div>}
      {payments.map((p) => (
        <div key={p.paymentIntentId} style={st.card}>
          <p style={st.title}>A payment needs attention{p.summary ? `: ${p.summary}` : ''}</p>
          <p style={st.amount}>{p.currency} {p.amount.toFixed(2)}</p>
          <p style={st.message}>{p.message}</p>
          {notes[p.paymentIntentId] && <p style={st.note}>{notes[p.paymentIntentId]}</p>}
          <div style={st.actions}>
            {p.canRetry && (
              <button style={st.primary} disabled={busy === p.paymentIntentId} onClick={() => retry(p.paymentIntentId)}>
                {busy === p.paymentIntentId ? 'Working...' : 'Try again'}
              </button>
            )}
            {p.canRequestRefund && (
              <button style={st.secondary} disabled={busy === p.paymentIntentId} onClick={() => refund(p.paymentIntentId)}>
                Ask for a refund
              </button>
            )}
          </div>
          <p style={st.ref}>Reference: {p.paymentIntentId}</p>
        </div>
      ))}
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20, maxWidth: 680 },
  card: { background: '#FFF8E1', border: '1px solid #F0D9A0', borderRadius: 16, padding: 18 },
  success: { background: '#E8F5E9', color: '#2E7D32', borderRadius: 12, padding: '12px 16px', fontSize: 14 },
  title: { fontSize: 15, fontWeight: 700, color: '#1A1A1A', margin: 0 },
  amount: { fontSize: 14, color: '#555', margin: '4px 0 8px' },
  message: { fontSize: 14, color: '#5c4a00', margin: '0 0 10px', lineHeight: 1.45 },
  note: { fontSize: 13, color: '#1A1A1A', background: '#fff', borderRadius: 10, padding: '8px 12px', margin: '0 0 10px' },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  primary: { background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' },
  secondary: { background: '#fff', color: '#1A1A1A', border: '1px solid #D9CFB8', borderRadius: 10, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' },
  ref: { fontSize: 11, color: '#9B9590', margin: '10px 0 0', wordBreak: 'break-all' },
};
