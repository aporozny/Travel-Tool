import React, { useState, useEffect } from 'react';
import api from '../services/api.web';
import { useTripMode } from '../hooks/useTripMode.web';

const C = {
  gold:      '#C9A84C',
  goldLight: '#FBF5E6',
  goldDark:  '#A8893A',
  white:     '#FFFFFF',
  border:    '#F0EDE8',
  text:      '#1A1A1A',
  muted:     '#9B9590',
  soft:      '#F5F3EF',
};

interface WhosGoingProps {
  region?: string;
}

interface NearbyMember {
  user_id: string;
  member_name: string;
  destination?: string;
  distance_km: number;
}

export function WhosGoingPanel({ region }: WhosGoingProps) {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [dest, setDest] = useState(region || '');
  const [tripRegion, setTripRegion] = useState(region || '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // "Near you now" -- live proximity, powered by Trip Mode. Separate mode
  // from the destination search above since matches here don't require a
  // declared trip at all (see backend/src/routes/members.ts GET /nearby).
  const [nearMode, setNearMode] = useState(false);
  const [nearby, setNearby] = useState<NearbyMember[]>([]);
  const [nearLoading, setNearLoading] = useState(false);
  const [nearError, setNearError] = useState<string | null>(null);
  const { enabled: tripModeOn, enable: enableTripMode } = useTripMode();

  const loadTrips = () => {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    api.get(`/members/trips${params}`)
      .then(r => setTrips(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const loadNearby = () => {
    setNearLoading(true);
    setNearError(null);
    api.get('/members/nearby?radius_km=10')
      .then(r => setNearby(r.data || []))
      .catch((e) => setNearError(e.response?.data?.message || 'Could not load nearby members.'))
      .finally(() => setNearLoading(false));
  };

  // Trip Mode surfaces strangers by live proximity, not just people you've
  // connected with -- report reuses the existing community-reporting
  // endpoint, block is local-only (removes them from your own nearby view,
  // no review step) and doesn't affect what they see of you elsewhere.
  const handleReport = (userId: string, name: string) => {
    const description = window.prompt(`Report ${name} to the Drift safety team. What happened? (at least 10 characters)`);
    if (!description || description.trim().length < 10) return;
    api.post('/safety/reports', {
      reportedTravelerId: userId,
      category: 'safety_concern',
      description: description.trim(),
    }).then(() => window.alert('Report submitted. Our team will review within 24 hours.'))
      .catch(() => window.alert('Could not submit report. Please try again.'));
  };

  const handleBlock = (userId: string, name: string) => {
    if (!window.confirm(`Block ${name}? They'll no longer appear in your nearby list, and you won't be able to message each other. You can undo this later.`)) return;
    api.post(`/members/${userId}/block`)
      .then(() => setNearby(prev => prev.filter(m => m.user_id !== userId)))
      .catch(() => window.alert('Could not block this member. Please try again.'));
  };

  useEffect(() => { loadTrips(); }, [region]);
  useEffect(() => { if (nearMode) loadNearby(); }, [nearMode, tripModeOn]);

  const handlePlan = async () => {
    if (!dest.trim()) return;
    setSaving(true);
    try {
      await api.post('/members/trips', {
        destination: dest,
        region: tripRegion || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        notes: notes || undefined,
        is_public: true,
      });
      setShowForm(false);
      setDest(region || ''); setTripRegion(region || '');
      setStartDate(''); setEndDate(''); setNotes('');
      loadTrips();
    } catch {
      alert('Could not save trip.');
    } finally {
      setSaving(false);
    }
  };

  const visible = expanded ? trips : trips.slice(0, 3);

  return (
    <div style={s.card}>
      <div style={s.header}>
        <div style={s.iconWrap}>◈</div>
        <div style={{ flex: 1 }}>
          <div style={s.title}>
            {nearMode ? 'Who\'s near you now?' : `Who's going${region ? ` to ${region}` : ''}?`}
          </div>
          <div style={s.sub}>
            {nearMode
              ? (nearLoading ? 'Loading...' : nearError ? nearError : `${nearby.length} member${nearby.length !== 1 ? 's' : ''} nearby`)
              : (loading ? 'Loading...' : trips.length === 0
                ? 'No trips planned yet'
                : `${trips.length} member${trips.length !== 1 ? 's' : ''} planning a trip`)}
          </div>
        </div>
        {!nearMode && (
          <button style={s.goingBtn} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : "I'm going"}
          </button>
        )}
      </div>

      <div style={s.modeRow}>
        <button style={{ ...s.modeBtn, ...(!nearMode ? s.modeBtnActive : {}) }} onClick={() => setNearMode(false)}>
          Planned trips
        </button>
        <button style={{ ...s.modeBtn, ...(nearMode ? s.modeBtnActive : {}) }} onClick={() => setNearMode(true)}>
          Near you now
        </button>
      </div>

      {nearMode ? (
        <div style={{ marginTop: 14 }}>
          {nearError && nearError.includes('Trip Mode') ? (
            <div style={s.empty}>
              <span style={{ color: C.muted, fontSize: 13 }}>Turn on Trip Mode to see who's nearby. </span>
              <button style={s.inlineBtn} onClick={() => enableTripMode().then(loadNearby)}>
                Turn on
              </button>
            </div>
          ) : nearby.length > 0 ? (
            <div style={s.tripList}>
              {nearby.map((m) => {
                const initials = (m.member_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <div key={m.user_id} style={s.tripRow}>
                    <div style={s.avatar}>{initials}</div>
                    <div style={{ flex: 1 }}>
                      <span style={s.memberName}>{m.member_name}</span>
                      <span style={s.dates}> · {m.distance_km} km away</span>
                      {m.destination && <div style={s.tripNote}>Heading to {m.destination}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button style={{ ...s.inlineBtn, color: C.muted, fontWeight: 500 }}
                        onClick={() => handleReport(m.user_id, m.member_name)}>Report</button>
                      <button style={{ ...s.inlineBtn, color: C.muted, fontWeight: 500 }}
                        onClick={() => handleBlock(m.user_id, m.member_name)}>Block</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !nearLoading && !nearError && (
            <div style={s.empty}>
              <span style={{ color: C.muted, fontSize: 13 }}>No members nearby right now.</span>
            </div>
          )}
        </div>
      ) : (
        <>
          {showForm && (
            <div style={s.form}>
              <div style={s.formRow}>
                <input style={s.input} placeholder="Destination *" value={dest}
                  onChange={e => setDest(e.target.value)} />
                <input style={s.input} placeholder="Region (optional)" value={tripRegion}
                  onChange={e => setTripRegion(e.target.value)} />
              </div>
              <div style={s.formRow}>
                <input style={s.input} type="date" value={startDate}
                  onChange={e => setStartDate(e.target.value)} />
                <input style={s.input} type="date" value={endDate}
                  onChange={e => setEndDate(e.target.value)} />
              </div>
              <textarea style={s.textarea}
                placeholder="What are you looking for? Dive buddy, surf partner, dinner company..."
                value={notes} onChange={e => setNotes(e.target.value)} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button style={s.submitBtn} onClick={handlePlan} disabled={saving || !dest.trim()}>
                  {saving ? 'Sharing...' : 'Share trip'}
                </button>
              </div>
            </div>
          )}

          {!loading && trips.length > 0 && (
            <div style={s.tripList}>
              {visible.map((trip: any) => {
                const initials = (trip.member_name || '?')
                  .split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <div key={trip.id} style={s.tripRow}>
                    <div style={s.avatar}>{initials}</div>
                    <div style={{ flex: 1 }}>
                      <span style={s.memberName}>{trip.member_name}</span>
                      <span style={s.arrow}> is heading to </span>
                      <span style={s.tripDest}>{trip.destination}</span>
                      {trip.start_date && (
                        <span style={s.dates}>
                          {' · '}{new Date(trip.start_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                          {trip.end_date && ` – ${new Date(trip.end_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`}
                        </span>
                      )}
                      {trip.notes && <div style={s.tripNote}>{trip.notes}</div>}
                    </div>
                  </div>
                );
              })}
              {trips.length > 3 && (
                <button style={s.showMore} onClick={() => setExpanded(!expanded)}>
                  {expanded ? 'Show less' : `+${trips.length - 3} more`}
                </button>
              )}
            </div>
          )}

          {!loading && trips.length === 0 && !showForm && (
            <div style={s.empty}>
              <span style={{ color: C.muted, fontSize: 13 }}>No trips shared yet. </span>
              <button style={s.inlineBtn} onClick={() => setShowForm(true)}>
                Be the first
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: C.white, borderRadius: 16, padding: 20,
    border: `1px solid ${C.border}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  header: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  iconWrap: { fontSize: 18, color: C.gold, lineHeight: 1, paddingTop: 3 },
  title: { fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 },
  sub: { fontSize: 12, color: C.muted },
  goingBtn: {
    background: C.goldLight, color: C.goldDark, border: 'none',
    borderRadius: 20, padding: '6px 14px', fontSize: 12,
    fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0,
  },
  modeRow: { display: 'flex', gap: 6, marginTop: 14 },
  modeBtn: {
    background: C.soft, color: C.muted, border: 'none', borderRadius: 20,
    padding: '5px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
  },
  modeBtnActive: { background: C.goldLight, color: C.goldDark },
  form: {
    marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8,
    padding: 14, background: C.soft, borderRadius: 10,
  },
  formRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  input: {
    padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, outline: 'none', background: C.white,
    width: '100%', boxSizing: 'border-box' as const,
  },
  textarea: {
    padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8,
    fontSize: 13, outline: 'none', background: C.white, minHeight: 64,
    resize: 'vertical' as const, fontFamily: 'inherit', width: '100%',
    boxSizing: 'border-box' as const,
  },
  submitBtn: {
    background: C.gold, color: '#fff', border: 'none', borderRadius: 8,
    padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  tripList: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  tripRow: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  avatar: {
    width: 30, height: 30, borderRadius: '50%', background: C.goldLight,
    color: C.goldDark, display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
  },
  memberName: { fontSize: 13, fontWeight: 600, color: C.text },
  arrow: { fontSize: 13, color: C.muted },
  tripDest: { fontSize: 13, fontWeight: 600, color: C.gold },
  dates: { fontSize: 12, color: C.muted },
  tripNote: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 1.4 },
  showMore: {
    background: 'none', border: 'none', color: C.gold, fontSize: 12,
    fontWeight: 600, cursor: 'pointer', padding: '4px 0', textAlign: 'left' as const,
  },
  empty: { marginTop: 12 },
  inlineBtn: {
    background: 'none', border: 'none', color: C.gold,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0,
  },
};
