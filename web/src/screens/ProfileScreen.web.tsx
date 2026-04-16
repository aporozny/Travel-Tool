import React, { useEffect, useState } from 'react';
import api from '../services/api.web';
import { TravelerProfile, TravelerPreferences } from '@/types';

const ACTIVITIES = ['Diving', 'Surfing', 'Hiking', 'Cultural', 'Food', 'Wellness', 'Snorkeling'];
const STYLES = ['Solo', 'Couple', 'Group', 'Family', 'Backpacker', 'Luxury'];
const BUDGETS = ['budget', 'mid', 'luxury'] as const;

export default function ProfileScreen() {
  const [profile, setProfile] = useState<TravelerProfile | null>(null);
  const [prefs, setPrefs] = useState<TravelerPreferences | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');

  const [posts, setPosts] = useState<any[]>([]);

  useEffect(() => {
    api.get('/community/posts').then(r => setPosts(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([api.get('/travelers/me'), api.get('/travelers/me/preferences')])
      .then(([p, pref]) => {
        setProfile(p.data);
        setPrefs(pref.data);
        setFirstName(p.data.first_name || '');
        setLastName(p.data.last_name || '');
        setBio(p.data.bio || '');
        setPhone(p.data.phone || '');
      })
      .catch(console.error);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/travelers/me', { first_name: firstName || undefined, last_name: lastName || undefined, bio: bio || undefined, phone: phone || undefined });
      setEditing(false);
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const updatePref = async (patch: Partial<TravelerPreferences>) => {
    if (!prefs) return;
    const updated = { ...prefs, ...patch };
    setPrefs(updated);
    await api.put('/travelers/me/preferences', updated);
  };

  const toggle = (arr: string[], val: string) =>
    arr.includes(val.toLowerCase()) ? arr.filter(x => x !== val.toLowerCase()) : [...arr, val.toLowerCase()];

  if (!profile) return <div style={{ padding: 40, color: '#999' }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.title}>Profile</h2>
        <button style={styles.editBtn} onClick={() => editing ? save() : setEditing(true)} disabled={saving}>
          {saving ? 'Saving...' : editing ? 'Save changes' : 'Edit profile'}
        </button>
      </div>

      <div style={styles.card}>
        <div style={styles.avatarRow}>
          <div style={styles.avatar}>{(firstName || profile.email).charAt(0).toUpperCase()}</div>
          <div>
            <p style={styles.name}>{firstName} {lastName}</p>
            <p style={styles.email}>{profile.email}</p>
          </div>
        </div>

        <div style={styles.fields}>
          <div style={styles.fieldRow}>
            <div style={styles.field}>
              <label style={styles.label}>First name</label>
              <input style={styles.input} value={firstName} onChange={e => setFirstName(e.target.value)} disabled={!editing} />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Last name</label>
              <input style={styles.input} value={lastName} onChange={e => setLastName(e.target.value)} disabled={!editing} />
            </div>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Phone</label>
            <input style={styles.input} value={phone} onChange={e => setPhone(e.target.value)} disabled={!editing} placeholder="+61 400 000 000" />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Bio</label>
            <textarea style={{ ...styles.input, height: 80, resize: 'vertical' }} value={bio} onChange={e => setBio(e.target.value)} disabled={!editing} />
          </div>
        </div>
      </div>

      {prefs && (
        <>
          <div style={styles.card}>
            <h3 style={styles.sectionTitle}>Budget</h3>
            <div style={styles.chips}>
              {BUDGETS.map(b => (
                <button key={b} style={{ ...styles.chip, ...(prefs.budget_range === b ? styles.chipActive : {}) }}
                  onClick={() => updatePref({ budget_range: b })}>
                  {b.charAt(0).toUpperCase() + b.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div style={styles.card}>
            <h3 style={styles.sectionTitle}>Activities</h3>
            <div style={styles.chips}>
              {ACTIVITIES.map(a => {
                const on = (prefs.activity_types || []).includes(a.toLowerCase());
                return <button key={a} style={{ ...styles.chip, ...(on ? styles.chipActive : {}) }}
                  onClick={() => updatePref({ activity_types: toggle(prefs.activity_types || [], a) })}>{a}</button>;
              })}
            </div>
          </div>
          <div style={styles.card}>
            <h3 style={styles.sectionTitle}>Travel style</h3>
            <div style={styles.chips}>
              {STYLES.map(s => {
                const on = (prefs.travel_style || []).includes(s.toLowerCase());
                return <button key={s} style={{ ...styles.chip, ...(on ? styles.chipActive : {}) }}
                  onClick={() => updatePref({ travel_style: toggle(prefs.travel_style || [], s) })}>{s}</button>;
              })}
            </div>
          </div>
        </>
      )}
      {/* My Posts */}
      <div style={styles.card}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A', marginBottom: 16 }}>My Posts</h3>
        {posts.length === 0 ? (
          <p style={{ color: '#9B9590', fontSize: 14 }}>No posts yet. Share something from the Feed tab.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {posts.map((post: any) => (
              <div key={post.id} style={{ padding: '12px 0', borderBottom: '1px solid #F0EDE8' }}>
                {post.region && (
                  <span style={{ fontSize: 11, color: '#A8893A', background: '#FBF5E6', borderRadius: 20, padding: '2px 8px', fontWeight: 600, marginBottom: 6, display: 'inline-block' }}>
                    {post.region}
                  </span>
                )}
                <p style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.6, marginTop: 4 }}>{post.body}</p>
                <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: '#9B9590' }}>👍 {post.reaction_count}</span>
                  <span style={{ fontSize: 12, color: '#9B9590' }}>◇ {post.comment_count}</span>
                  <span style={{ fontSize: 12, color: '#9B9590' }}>
                    {new Date(post.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, maxWidth: 720 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700, color: '#1a1a1a' },
  editBtn: { padding: '10px 20px', background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  card: { background: '#fff', borderRadius: 16, padding: 24, marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  avatarRow: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 },
  avatar: { width: 64, height: 64, borderRadius: 32, background: '#C9A84C', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, flexShrink: 0 },
  name: { fontSize: 18, fontWeight: 600, color: '#1a1a1a' },
  email: { fontSize: 13, color: '#888' },
  fields: { display: 'flex', flexDirection: 'column', gap: 16 },
  fieldRow: { display: 'flex', gap: 16 },
  field: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 500, color: '#888' },
  input: { padding: '10px 12px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 14, color: '#1a1a1a', width: '100%', background: '#fff' },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 14 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  chip: { padding: '8px 16px', borderRadius: 20, border: '1px solid #e8e8e8', background: '#fafafa', fontSize: 13, cursor: 'pointer', fontWeight: 500, color: '#555' },
  chipActive: { background: '#C9A84C', borderColor: '#C9A84C', color: '#fff' },
};
