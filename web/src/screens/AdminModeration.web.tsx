import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// Admin-only: review whatever the automated pipeline (services/moderation.ts) queued as
// pending/held, plus anything three members independently reported. See
// docs/pm/BLOG-MODERATION-DESIGN-AND-IMPLEMENTATION-PLAN.md for the design this implements.

const C = {
  gold: '#C9A84C', goldLight: '#FBF5E6', goldDark: '#A8893A', white: '#FFFFFF',
  border: '#F0EDE8', text: '#1A1A1A', muted: '#9B9590', bg: '#f8f7f4',
  green: '#10B981', greenLight: '#ECFDF5', red: '#C62828', redLight: '#FFEBEE',
};

interface QueueItem {
  contentType: 'post' | 'comment';
  id: string;
  body: string;
  authorId: string;
  authorName: string | null;
  createdAt: string;
  moderationStatus: 'pending' | 'held' | 'blocked';
  reporterCount: number;
  latestDecision: {
    stage: string;
    verdict: string;
    categories: string[];
    quotedSpan: string | null;
    reason: string;
    reviewerQuestion: string | null;
  } | null;
}

const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const STAGE_LABEL: Record<string, string> = {
  rule_check: 'Automated rule check',
  openai_moderation: 'Automated content screening',
  claude_review: 'Automated policy review',
  member_reports: 'Member reports',
  human_review: 'Human review',
  appeal_requested: 'Appeal requested',
};

export default function AdminModeration() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState<string | null>(null); // "contentType:id" while its panel is open
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/admin/moderation/queue', { params: { status: 'both', limit: 50 } })
      .then((r) => { setItems(r.data.items || []); setError(''); })
      .catch((err) => setError(err?.response?.data?.message || 'Could not load the moderation queue. Make sure you are signed in as admin.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const openDecide = (item: QueueItem) => {
    setDeciding(`${item.contentType}:${item.id}`);
    setNote('');
    setSaveError('');
  };

  const submitDecision = async (item: QueueItem, verdict: 'allow' | 'block') => {
    if (!note.trim()) { setSaveError('A one-line note is required before deciding.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      await api.post(`/admin/moderation/${item.contentType}/${item.id}/decide`, { verdict, note: note.trim() });
      setDeciding(null);
      load();
    } catch (err: any) {
      setSaveError(err?.response?.data?.message || 'Could not save that decision.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={s.page}>
      <h1 style={s.title}>Moderation queue</h1>
      <p style={s.subtitle}>
        Everything the automated pipeline is holding for a decision, plus anything members have reported enough times to hold on its own — oldest first.
      </p>

      {error && <p style={s.error}>{error}</p>}
      {loading ? (
        <p style={s.note}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={s.card}><p style={s.note}>Nothing waiting on a decision right now.</p></div>
      ) : (
        items.map((item) => {
          const key = `${item.contentType}:${item.id}`;
          const decision = item.latestDecision;
          const isAppeal = decision?.stage === 'appeal_requested';
          const isMemberHeld = decision?.stage === 'member_reports';
          return (
            <div key={key} style={s.card}>
              <div style={s.cardHeader}>
                <span style={s.cardType}>{item.contentType === 'post' ? 'Post' : 'Comment'} · by {item.authorName || 'a member'} · {timeAgo(item.createdAt)}</span>
                <div style={s.badges}>
                  {isAppeal && <span style={s.appealBadge}>Appealed</span>}
                  <span style={item.moderationStatus === 'pending' ? s.pendingBadge : s.heldBadge}>{item.moderationStatus}</span>
                </div>
              </div>

              <p style={s.body}>"{item.body}"</p>

              {isMemberHeld ? (
                <p style={s.reason}>Held because: {item.reporterCount} members reported this.</p>
              ) : decision ? (
                <>
                  {decision.categories.length > 0 && (
                    <p style={s.categories}>Categories: {decision.categories.join(', ')}</p>
                  )}
                  {decision.quotedSpan && <p style={s.quoted}>Quoted span: "{decision.quotedSpan}"</p>}
                  <p style={s.reason}>{isAppeal ? 'Original reason' : 'Reason'}: {decision.reason}</p>
                  {decision.reviewerQuestion && !isAppeal && <p style={s.question}>Reviewer question: {decision.reviewerQuestion}</p>}
                  <p style={s.via}>via {STAGE_LABEL[decision.stage] ?? decision.stage}</p>
                </>
              ) : (
                <p style={s.reason}>No automated verdict yet — every stage may still be running, or all of them errored.</p>
              )}

              {item.reporterCount > 0 && !isMemberHeld && (
                <p style={s.via}>Also reported by {item.reporterCount} member{item.reporterCount !== 1 ? 's' : ''}.</p>
              )}

              {deciding === key ? (
                <div style={s.decidePanel}>
                  {saveError && <p style={s.error}>{saveError}</p>}
                  <textarea
                    style={s.noteInput}
                    placeholder="A one-line note for the record (required)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                  />
                  <div style={s.decideActions}>
                    <button style={s.secondaryBtn} disabled={saving} onClick={() => setDeciding(null)}>Cancel</button>
                    <button style={s.allowBtn} disabled={saving} onClick={() => submitDecision(item, 'allow')}>{saving ? 'Saving…' : 'Allow'}</button>
                    <button style={s.blockBtn} disabled={saving} onClick={() => submitDecision(item, 'block')}>{saving ? 'Saving…' : 'Block'}</button>
                  </div>
                </div>
              ) : (
                <button style={s.reviewBtn} onClick={() => openDecide(item)}>Decide</button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 32, maxWidth: 900, margin: '0 auto', background: C.bg, minHeight: '100vh' },
  title: { fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: C.muted, marginBottom: 24 },
  card: { background: C.white, borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 },
  cardType: { fontSize: 13, color: C.muted },
  badges: { display: 'flex', gap: 6 },
  pendingBadge: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '3px 9px', borderRadius: 999, background: C.goldLight, color: C.goldDark },
  heldBadge: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '3px 9px', borderRadius: 999, background: C.redLight, color: C.red },
  appealBadge: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '3px 9px', borderRadius: 999, background: '#E3F2FD', color: '#1565C0' },
  body: { fontSize: 15, color: C.text, background: C.bg, borderRadius: 10, padding: '10px 12px', marginBottom: 10, whiteSpace: 'pre-wrap' },
  categories: { fontSize: 13, color: C.text, marginBottom: 4 },
  quoted: { fontSize: 13, color: C.red, fontStyle: 'italic', marginBottom: 4 },
  reason: { fontSize: 13, color: C.text, marginBottom: 4 },
  question: { fontSize: 13, color: C.goldDark, fontWeight: 600, marginBottom: 4 },
  via: { fontSize: 12, color: C.muted, marginBottom: 10 },
  reviewBtn: { padding: '9px 16px', background: C.gold, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  decidePanel: { marginTop: 8, paddingTop: 14, borderTop: `1px solid ${C.border}` },
  noteInput: { width: '100%', padding: '9px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' },
  decideActions: { display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' },
  secondaryBtn: { padding: '9px 14px', background: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  allowBtn: { padding: '9px 16px', background: C.green, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  blockBtn: { padding: '9px 16px', background: C.red, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  error: { fontSize: 13, color: C.red, background: C.redLight, borderRadius: 8, padding: '8px 12px', marginBottom: 10 },
  note: { fontSize: 13, color: C.muted },
};
