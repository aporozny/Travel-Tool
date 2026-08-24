import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import api from '../services/api.web';
import { WhosGoingPanel } from './WhosGoingPanel';

// ─── Design tokens ─────────────────────────────────────────────────────────
// Matches CommunityScreen.web.tsx / AppShell.web.tsx exactly -- same
// palette across every screen, not a one-off.
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
  danger:    '#E53E3E',
};

interface Trip {
  id: string;
  title: string;
  description: string | null;
  destination: string | null;
  region: string | null;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  coverImageUrl: string | null;
  status: 'draft' | 'published' | 'cancelled';
  createdBy: string;
  createdAt: string;
  confirmedCount: number;
  waitlistedCount: number;
  spotsRemaining: number | null;
  myRsvpStatus: 'confirmed' | 'waitlisted' | 'cancelled' | null;
}

interface Rsvp {
  id: string;
  status: string;
  createdAt: string;
  userId: string;
  email: string;
  name: string;
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const startStr = new Date(start).toLocaleDateString('en-US', opts);
  if (!end) return startStr;
  const endStr = new Date(end).toLocaleDateString('en-US', opts);
  return `${startStr} – ${endStr}`;
}

export default function TripsScreen() {
  const { user } = useSelector((s: RootState) => s.auth);
  const isAdmin = user?.role === 'admin';

  const [subTab, setSubTab] = useState<'curated' | 'travelers'>('curated');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyTripId, setBusyTripId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rsvpPanelTripId, setRsvpPanelTripId] = useState<string | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [rsvpsLoading, setRsvpsLoading] = useState(false);

  useEffect(() => {
    loadTrips();
  }, []);

  const loadTrips = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/trips');
      setTrips(res.data.trips || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not load trips.');
    } finally {
      setLoading(false);
    }
  };

  const handleRsvp = async (tripId: string) => {
    setBusyTripId(tripId);
    try {
      await api.post(`/trips/${tripId}/rsvp`);
      await loadTrips();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not RSVP.');
    } finally {
      setBusyTripId(null);
    }
  };

  const handleCancelRsvp = async (tripId: string) => {
    setBusyTripId(tripId);
    try {
      await api.delete(`/trips/${tripId}/rsvp`);
      await loadTrips();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not cancel RSVP.');
    } finally {
      setBusyTripId(null);
    }
  };

  const openRsvpPanel = async (tripId: string) => {
    setRsvpPanelTripId(tripId);
    setRsvpsLoading(true);
    try {
      const res = await api.get(`/trips/${tripId}/rsvps`);
      setRsvps(res.data.rsvps || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not load RSVPs.');
    } finally {
      setRsvpsLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Trips</h1>
          <p style={s.subtitle}>
            {subTab === 'curated'
              ? "Curated trips you can join -- posted by Drift, not the algorithm."
              : 'Travelers heading somewhere and looking for company -- post your own or see who else is going.'}
          </p>
        </div>
        {isAdmin && subTab === 'curated' && (
          <button style={s.createBtn} onClick={() => setCreating(true)}>+ New trip</button>
        )}
      </div>

      <div style={s.subTabRow}>
        <button
          style={{ ...s.subTabBtn, ...(subTab === 'curated' ? s.subTabBtnActive : {}) }}
          onClick={() => setSubTab('curated')}
        >
          Curated trips
        </button>
        <button
          style={{ ...s.subTabBtn, ...(subTab === 'travelers' ? s.subTabBtnActive : {}) }}
          onClick={() => setSubTab('travelers')}
        >
          Travelers going your way
        </button>
      </div>

      {subTab === 'travelers' && <WhosGoingPanel />}

      {subTab === 'curated' && error && <div style={s.error}>{error}</div>}

      {subTab === 'curated' && (loading ? (
        <p style={s.muted}>Loading trips...</p>
      ) : trips.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyTitle}>No trips posted yet</p>
          {isAdmin && <p style={s.mutedSmall}>Create one to get started.</p>}
        </div>
      ) : (
        <div style={s.grid}>
          {trips.map((trip) => (
            <div key={trip.id} style={s.card}>
              {trip.status === 'draft' && <span style={s.draftBadge}>Draft</span>}
              <h3 style={s.cardTitle}>{trip.title}</h3>
              {trip.destination && <p style={s.cardDestination}>{trip.destination}</p>}
              {formatDateRange(trip.startDate, trip.endDate) && (
                <p style={s.cardDates}>{formatDateRange(trip.startDate, trip.endDate)}</p>
              )}
              {trip.description && <p style={s.cardDescription}>{trip.description}</p>}

              <div style={s.cardMeta}>
                {trip.capacity != null ? (
                  <span style={s.mutedSmall}>
                    {trip.spotsRemaining} of {trip.capacity} spots left
                    {trip.waitlistedCount > 0 ? ` · ${trip.waitlistedCount} waitlisted` : ''}
                  </span>
                ) : (
                  <span style={s.mutedSmall}>{trip.confirmedCount} going</span>
                )}
              </div>

              <div style={s.cardActions}>
                {trip.myRsvpStatus === 'confirmed' && (
                  <>
                    <span style={s.statusBadgeConfirmed}>You're going</span>
                    <button style={s.cancelBtn} disabled={busyTripId === trip.id} onClick={() => handleCancelRsvp(trip.id)}>
                      {busyTripId === trip.id ? '...' : 'Cancel'}
                    </button>
                  </>
                )}
                {trip.myRsvpStatus === 'waitlisted' && (
                  <>
                    <span style={s.statusBadgeWaitlisted}>Waitlisted</span>
                    <button style={s.cancelBtn} disabled={busyTripId === trip.id} onClick={() => handleCancelRsvp(trip.id)}>
                      {busyTripId === trip.id ? '...' : 'Cancel'}
                    </button>
                  </>
                )}
                {(!trip.myRsvpStatus || trip.myRsvpStatus === 'cancelled') && trip.status === 'published' && (
                  <button style={s.rsvpBtn} disabled={busyTripId === trip.id} onClick={() => handleRsvp(trip.id)}>
                    {busyTripId === trip.id ? 'Joining...' : trip.spotsRemaining === 0 ? 'Join waitlist' : "I'm in"}
                  </button>
                )}
                {isAdmin && (
                  <button style={s.viewRsvpsBtn} onClick={() => openRsvpPanel(trip.id)}>
                    View RSVPs
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {subTab === 'curated' && creating && (
        <CreateTripModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); loadTrips(); }}
        />
      )}

      {rsvpPanelTripId && (
        <div style={s.modalOverlay} onClick={() => setRsvpPanelTripId(null)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={s.modalTitle}>Who's RSVPed</h3>
            {rsvpsLoading ? (
              <p style={s.muted}>Loading...</p>
            ) : rsvps.length === 0 ? (
              <p style={s.muted}>No RSVPs yet.</p>
            ) : (
              <div style={s.rsvpList}>
                {rsvps.map((r) => (
                  <div key={r.id} style={s.rsvpRow}>
                    <span>{r.name}</span>
                    <span style={r.status === 'confirmed' ? s.statusBadgeConfirmed : s.statusBadgeWaitlisted}>{r.status}</span>
                  </div>
                ))}
              </div>
            )}
            <button style={s.closeBtn} onClick={() => setRsvpPanelTripId(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateTripModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/trips', {
        title: title.trim(),
        description: description.trim() || undefined,
        destination: destination.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        capacity: capacity ? parseInt(capacity, 10) : undefined,
        status: 'published',
      });
      onCreated();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not create trip.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.modalOverlay} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={s.modalTitle}>New trip</h3>
        {error && <div style={s.error}>{error}</div>}

        <div style={s.field}>
          <label style={s.label}>Title</label>
          <input style={s.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Trip to Bali" autoFocus />
        </div>
        <div style={s.field}>
          <label style={s.label}>Destination</label>
          <input style={s.input} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Bali, Indonesia" />
        </div>
        <div style={s.fieldRow}>
          <div style={s.field}>
            <label style={s.label}>Start date</label>
            <input style={s.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div style={s.field}>
            <label style={s.label}>End date</label>
            <input style={s.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div style={s.field}>
          <label style={s.label}>Capacity (optional)</label>
          <input style={s.input} type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Leave blank for unlimited" />
        </div>
        <div style={s.field}>
          <label style={s.label}>Description</label>
          <textarea style={s.textarea} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this trip about?" rows={4} />
        </div>

        <div style={s.modalActions}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.rsvpBtn} disabled={saving} onClick={handleCreate}>{saving ? 'Creating...' : 'Create trip'}</button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '32px 40px', maxWidth: 1100, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 },
  title: { fontSize: 26, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'DM Serif Display', serif" },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 6 },
  createBtn: { padding: '10px 18px', background: C.gold, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  subTabRow: { display: 'flex', gap: 8, marginBottom: 20, borderBottom: `1px solid ${C.border}` },
  subTabBtn: { padding: '10px 4px', marginRight: 20, background: 'transparent', border: 'none', borderBottom: '2px solid transparent', color: C.muted, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  subTabBtnActive: { color: C.text, borderBottomColor: C.gold },
  error: { background: '#ffebee', color: '#c62828', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  muted: { color: C.muted, fontSize: 14 },
  mutedSmall: { color: C.muted, fontSize: 12 },
  empty: { textAlign: 'center' as const, padding: '60px 0' },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 6 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 },
  card: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, position: 'relative' as const },
  draftBadge: { position: 'absolute' as const, top: 16, right: 16, fontSize: 10, fontWeight: 700, color: C.goldDark, background: C.goldLight, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  cardTitle: { fontSize: 17, fontWeight: 700, color: C.text, margin: '0 0 4px' },
  cardDestination: { fontSize: 13, color: C.goldDark, fontWeight: 600, margin: '0 0 4px' },
  cardDates: { fontSize: 12, color: C.muted, margin: '0 0 10px' },
  cardDescription: { fontSize: 13, color: C.text, lineHeight: 1.5, margin: '0 0 14px' },
  cardMeta: { marginBottom: 14 },
  cardActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  rsvpBtn: { padding: '9px 16px', background: C.gold, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  cancelBtn: { padding: '9px 16px', background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  viewRsvpsBtn: { padding: '9px 16px', background: C.soft, color: C.text, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  statusBadgeConfirmed: { fontSize: 11, fontWeight: 700, color: '#10B981', background: '#ECFDF5', padding: '5px 10px', borderRadius: 6 },
  statusBadgeWaitlisted: { fontSize: 11, fontWeight: 700, color: C.goldDark, background: C.goldLight, padding: '5px 10px', borderRadius: 6 },
  modalOverlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: C.white, borderRadius: 16, padding: 28, width: '100%', maxWidth: 440, maxHeight: '85vh', overflowY: 'auto' as const },
  modalTitle: { fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 18px' },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
  field: { marginBottom: 14, flex: 1 },
  fieldRow: { display: 'flex', gap: 12 },
  label: { fontSize: 12, fontWeight: 600, color: C.muted, display: 'block', marginBottom: 5 },
  input: { width: '100%', padding: '10px 12px', border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, background: C.bg, outline: 'none' },
  textarea: { width: '100%', padding: '10px 12px', border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' as const, background: C.bg, outline: 'none', fontFamily: 'inherit', resize: 'vertical' as const },
  rsvpList: { display: 'flex', flexDirection: 'column' as const, gap: 8, marginBottom: 18, maxHeight: 320, overflowY: 'auto' as const },
  rsvpRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 },
  closeBtn: { width: '100%', padding: '10px 0', background: C.soft, color: C.text, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};
