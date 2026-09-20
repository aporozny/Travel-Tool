import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// Trip updates for the Bookings tab: the traveller's in-app notifications
// (reminders as they come due), and two switches for how they hear about their
// trips. Reminders are also emailed unless switched off here or via the
// unsubscribe link in any email.

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

interface Item { id: string; type: string; title: string; body: string; read_at: string | null; created_at: string }
interface Prefs { emailEnabled: boolean; inAppEnabled: boolean }

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

export function TripUpdates() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    api.get('/notifications').then((res) => { setItems(res.data.notifications || []); setUnread(res.data.unread || 0); }).catch(() => {});
    api.get('/notifications/preferences').then((res) => setPrefs(res.data)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const markAllRead = async () => {
    try { await api.post('/notifications/read-all'); load(); } catch { /* not critical */ }
  };

  const update = async (patch: Partial<Prefs>) => {
    if (!prefs) return;
    setSaving(true);
    setError('');
    const previous = prefs;
    setPrefs({ ...prefs, ...patch }); // show the change at once, undo if it fails
    try {
      const res = await api.put('/notifications/preferences', patch);
      setPrefs(res.data);
    } catch {
      setPrefs(previous);
      setError("Couldn't save that. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (items.length === 0 && !prefs) return null;

  return (
    <div style={s.wrap}>
      <div style={s.headRow}>
        <h3 style={s.heading}>Trip updates{unread > 0 && <span style={s.badge}>{unread} new</span>}</h3>
        <div style={s.headActions}>
          {unread > 0 && <button style={s.link} onClick={markAllRead}>Mark all read</button>}
          <button style={s.link} onClick={() => setShowSettings((v) => !v)}>{showSettings ? 'Hide settings' : 'Reminder settings'}</button>
        </div>
      </div>

      {showSettings && prefs && (
        <div style={s.settings}>
          <label style={s.check}>
            <input type="checkbox" checked={prefs.emailEnabled} disabled={saving} onChange={(e) => update({ emailEnabled: e.target.checked })} />
            <span><strong>Email me trip reminders</strong><br /><span style={s.small}>Confirmation, entry checklist and reminders before you fly. Every email also has a stop link.</span></span>
          </label>
          <label style={s.check}>
            <input type="checkbox" checked={prefs.inAppEnabled} disabled={saving} onChange={(e) => update({ inAppEnabled: e.target.checked })} />
            <span><strong>Show reminders here in Drift</strong><br /><span style={s.small}>The list below.</span></span>
          </label>
          {error && <div style={s.error}>{error}</div>}
        </div>
      )}

      {items.length === 0 ? (
        <p style={s.empty}>No updates yet. Reminders for your trips will appear here as they come up.</p>
      ) : (
        items.map((n) => (
          <div key={n.id} style={{ ...s.item, ...(n.read_at ? {} : s.itemUnread) }}>
            <div style={s.itemTop}>
              <span style={s.itemTitle}>{n.title}</span>
              <span style={s.itemTime}>{ago(n.created_at)}</span>
            </div>
            <div style={s.itemBody}>{n.body}</div>
          </div>
        ))
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginBottom: 32, maxWidth: 680 },
  headRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' },
  heading: { fontSize: 20, fontWeight: 700, color: C.text, margin: 0, fontFamily: "'DM Serif Display', serif" },
  badge: { marginLeft: 10, fontSize: 11, fontWeight: 700, color: '#fff', background: C.gold, borderRadius: 999, padding: '3px 9px', fontFamily: 'inherit' },
  headActions: { display: 'flex', gap: 16 },
  link: { background: 'none', border: 'none', color: C.goldDark, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', padding: 0 },
  settings: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 12 },
  check: { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: C.text, cursor: 'pointer' },
  small: { fontSize: 12, color: C.muted },
  error: { background: '#ffebee', color: '#c62828', padding: '8px 12px', borderRadius: 8, fontSize: 13 },
  empty: { color: C.muted, fontSize: 14 },
  item: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 8 },
  itemUnread: { borderColor: C.gold, background: C.goldLight },
  itemTop: { display: 'flex', justifyContent: 'space-between', gap: 12 },
  itemTitle: { fontSize: 14, fontWeight: 600, color: C.text },
  itemTime: { fontSize: 11, color: C.muted, whiteSpace: 'nowrap' },
  itemBody: { fontSize: 13, color: C.text, marginTop: 4 },
};
