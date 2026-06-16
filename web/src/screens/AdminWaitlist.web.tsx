import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

const C = {
  gold:      '#C9A84C',
  goldLight: '#FBF5E6',
  goldDark:  '#A8893A',
  white:     '#FFFFFF',
  border:    '#F0EDE8',
  text:      '#1A1A1A',
  muted:     '#9B9590',
  bg:        '#f8f7f4',
  green:     '#10B981',
  greenLight:'#ECFDF5',
  red:       '#C62828',
  redLight:  '#FFEBEE',
};

export default function AdminWaitlist() {
  const [entries, setEntries] = useState<any[]>([]);
  const [counts, setCounts] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('waiting');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    api.get(`/admin/waitlist?status=${filter}`)
      .then(r => {
        setEntries(r.data.entries || []);
        setCounts(r.data.counts || {});
      })
      .catch(() => setError('Could not load waitlist. Make sure you are signed in as admin.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const handleApprove = async (id: string, email: string) => {
    try {
      const r = await api.post(`/admin/waitlist/${id}/approve`);
      setInviteLinks(prev => ({ ...prev, [id]: r.data.invite_url }));
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not approve.');
    }
  };

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const statusColour = (status: string) => {
    switch (status) {
      case 'waiting': return { color: C.muted, background: C.bg };
      case 'approved': return { color: C.goldDark, background: C.goldLight };
      case 'invited': return { color: '#1D4ED8', background: '#EFF6FF' };
      case 'joined': return { color: C.green, background: C.greenLight };
      default: return { color: C.muted, background: C.bg };
    }
  };

  const total = Object.values(counts).reduce((a: any, b: any) => a + b, 0);

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>◈ Drift — Waitlist</h1>
            <p style={s.sub}>{total as number} total · {counts.waiting || 0} waiting · {counts.invited || 0} invited · {counts.joined || 0} joined</p>
          </div>
        </div>

        {error && <div style={s.error}>{error}</div>}

        {/* Filter tabs */}
        <div style={s.tabs}>
          {['waiting', 'invited', 'joined'].map(status => (
            <button key={status} style={{ ...s.tab, ...(filter === status ? s.tabActive : {}) }}
              onClick={() => setFilter(status)}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
              {counts[status] ? ` (${counts[status]})` : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: C.muted, padding: 32 }}>Loading...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: C.muted, padding: 32 }}>No {filter} entries.</p>
        ) : (
          <div style={s.table}>
            {entries.map(entry => (
              <div key={entry.id} style={s.row}>
                <div style={s.rowMain}>
                  <div style={s.avatar}>
                    {(entry.name || entry.email).charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={s.name}>{entry.name || '—'}</div>
                    <div style={s.email}>{entry.email}</div>
                    <div style={s.meta}>
                      {entry.source && <span style={s.tag}>{entry.source}</span>}
                      <span style={s.date}>
                        {new Date(entry.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                    </div>
                    {entry.note && <div style={s.note}>{entry.note}</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                    <span style={{ ...s.statusBadge, ...statusColour(entry.status) }}>
                      {entry.status}
                    </span>
                    {entry.status === 'waiting' && (
                      <button style={s.approveBtn}
                        onClick={() => handleApprove(entry.id, entry.email)}>
                        Approve
                      </button>
                    )}
                  </div>
                </div>

                {/* Show invite link after approval */}
                {(inviteLinks[entry.id] || entry.invite_token) && (
                  <div style={s.inviteRow}>
                    <span style={s.inviteUrl}>
                      {inviteLinks[entry.id] || `${window.location.origin}/invite/${entry.invite_token}`}
                    </span>
                    <button style={s.copyBtn}
                      onClick={() => handleCopy(entry.id, inviteLinks[entry.id] || `${window.location.origin}/invite/${entry.invite_token}`)}>
                      {copiedId === entry.id ? '✓ Copied' : 'Copy link'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: C.bg, padding: 32 },
  container: { maxWidth: 800, margin: '0 auto' },
  header: { marginBottom: 24 },
  title: { fontSize: 24, fontWeight: 700, color: C.text, marginBottom: 4 },
  sub: { fontSize: 14, color: C.muted },
  error: { background: C.redLight, color: C.red, padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${C.border}`, paddingBottom: 0 },
  tab: { padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: C.muted, fontWeight: 500, borderBottom: '2px solid transparent', marginBottom: -1 },
  tabActive: { color: C.gold, borderBottomColor: C.gold, fontWeight: 600 },
  table: { display: 'flex', flexDirection: 'column', gap: 8 },
  row: { background: C.white, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` },
  rowMain: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: '50%', background: C.goldLight, color: C.goldDark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 },
  name: { fontSize: 15, fontWeight: 600, color: C.text },
  email: { fontSize: 13, color: C.muted, marginTop: 2 },
  meta: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 },
  tag: { fontSize: 11, background: C.goldLight, color: C.goldDark, borderRadius: 4, padding: '1px 6px' },
  date: { fontSize: 12, color: C.muted },
  note: { fontSize: 13, color: '#666', marginTop: 6, fontStyle: 'italic' },
  statusBadge: { fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '3px 10px', textTransform: 'capitalize' as const },
  approveBtn: { background: C.gold, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  inviteRow: { marginTop: 12, padding: '10px 12px', background: C.greenLight, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 },
  inviteUrl: { fontSize: 12, color: '#1D4ED8', flex: 1, wordBreak: 'break-all' as const },
  copyBtn: { background: C.green, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' as const },
};
