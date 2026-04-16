// Add this to the bottom of CommunityScreen.web.tsx
// Or save as a separate component and import it

// ─── WHO'S GOING? ─────────────────────────────────────────────────────────────
// Paste this ABOVE the export default function CommunityScreen() line

import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api.web';

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

const REACTIONS = [
  { key: 'like',  emoji: '👍', label: 'Like' },
  { key: 'fire',  emoji: '🔥', label: 'Fire' },
  { key: 'heart', emoji: '❤️',  label: 'Heart' },
  { key: 'wave',  emoji: '🌊', label: 'Wave' },
];

const REGIONS = [
  'Seminyak', 'Canggu', 'Ubud', 'Nusa Penida', 'Uluwatu',
  'Sanur', 'Amed', 'Tulamben', 'Lombok', 'Gili Islands',
  'Flores', 'Sidemen', 'Munduk', 'Lovina', 'Jimbaran',
];

interface Post {
  id: string;
  body: string;
  region: string;
  reaction_count: number;
  comment_count: number;
  created_at: string;
  author_type: string;
  author_id: string;
  display_name: string;
  avatar_url: string | null;
  media: string[];
  my_reaction: string | null;
  place_name: string | null;
}

// ─── WHO'S GOING PANEL ───────────────────────────────────────────────────────

function WhosGoingPanel({ region }: { region?: string }) {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [dest, setDest] = useState(region || '');
  const [tripRegion, setTripRegion] = useState(region || '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = region ? `?region=${encodeURIComponent(region)}` : '';
    api.get(`/members/trips${params}`)
      .then(r => setTrips(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [region]);

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
      setShowPlanForm(false);
      setDest(region || ''); setTripRegion(region || ''); setStartDate(''); setEndDate(''); setNotes('');
      const params = region ? `?region=${encodeURIComponent(region)}` : '';
      const r = await api.get(`/members/trips${params}`);
      setTrips(r.data || []);
    } catch {
      alert('Could not save trip.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={wg.panel}>
      <div style={wg.panelHeader}>
        <div>
          <h3 style={wg.panelTitle}>Who's going{region ? ` to ${region}` : ''}?</h3>
          <p style={wg.panelSub}>Find other members heading the same way</p>
        </div>
        <button style={wg.planBtn} onClick={() => setShowPlanForm(true)}>
          + I'm going
        </button>
      </div>

      {showPlanForm && (
        <div style={wg.form}>
          <input style={wg.input} placeholder="Destination *" value={dest} onChange={e => setDest(e.target.value)} />
          <select style={wg.input} value={tripRegion} onChange={e => setTripRegion(e.target.value)}>
            <option value="">Region</option>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input style={wg.input} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <input style={wg.input} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <textarea style={wg.textarea} placeholder="What are you looking for? (dive buddy, dinner companion, hiking partner...)" value={notes} onChange={e => setNotes(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={wg.cancelBtn} onClick={() => setShowPlanForm(false)}>Cancel</button>
            <button style={wg.saveBtn} onClick={handlePlan} disabled={saving}>
              {saving ? 'Saving...' : 'Share my trip'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: C.muted, fontSize: 13, padding: '8px 0' }}>Loading...</p>
      ) : trips.length === 0 ? (
        <div style={wg.empty}>
          <p style={{ color: C.muted, fontSize: 13 }}>
            No one has shared a trip here yet.{' '}
            <button style={{ background: 'none', border: 'none', color: C.gold, cursor: 'pointer', fontSize: 13, padding: 0, fontWeight: 600 }}
              onClick={() => setShowPlanForm(true)}>
              Be the first →
            </button>
          </p>
        </div>
      ) : (
        <div style={wg.tripList}>
          {trips.slice(0, 5).map((trip: any) => {
            const initials = (trip.member_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
            return (
              <div key={trip.id} style={wg.tripItem}>
                <div style={wg.tripAvatar}>{initials}</div>
                <div style={{ flex: 1 }}>
                  <div style={wg.tripMember}>{trip.member_name}</div>
                  <div style={wg.tripDest}>
                    {trip.destination}
                    {trip.start_date && <span style={{ color: C.muted }}> · {trip.start_date}{trip.end_date ? ` → ${trip.end_date}` : ''}</span>}
                  </div>
                  {trip.notes && <div style={wg.tripNotes}>{trip.notes}</div>}
                </div>
                {trip.budget_range && (
                  <span style={wg.budgetTag}>{trip.budget_range}</span>
                )}
              </div>
            );
          })}
          {trips.length > 5 && (
            <p style={{ color: C.muted, fontSize: 12, textAlign: 'center', paddingTop: 8 }}>
              +{trips.length - 5} more members going
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const wg: Record<string, React.CSSProperties> = {
  panel: { background: C.white, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, marginBottom: 16 },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  panelTitle: { fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 2 },
  panelSub: { fontSize: 12, color: C.muted },
  planBtn: { background: C.goldLight, color: C.goldDark, border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  form: { background: C.soft, borderRadius: 12, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 },
  input: { padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, outline: 'none', background: C.white },
  textarea: { padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, outline: 'none', background: C.white, minHeight: 72, resize: 'vertical' as const },
  cancelBtn: { padding: '7px 14px', border: `1px solid ${C.border}`, borderRadius: 8, background: 'none', fontSize: 13, cursor: 'pointer', color: C.muted },
  saveBtn: { padding: '7px 14px', border: 'none', borderRadius: 8, background: C.gold, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  empty: { padding: '8px 0' },
  tripList: { display: 'flex', flexDirection: 'column', gap: 10 },
  tripItem: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  tripAvatar: { width: 34, height: 34, borderRadius: '50%', background: C.goldLight, color: C.goldDark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 },
  tripMember: { fontSize: 13, fontWeight: 600, color: C.text },
  tripDest: { fontSize: 12, color: C.text, marginTop: 1 },
  tripNotes: { fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 1.4 },
  budgetTag: { fontSize: 11, color: C.muted, background: C.soft, borderRadius: 6, padding: '2px 8px', alignSelf: 'flex-start', flexShrink: 0 },
};

export { WhosGoingPanel };
