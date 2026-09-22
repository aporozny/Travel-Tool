import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// The Profile tab for an operator account. Registration gives an operator no business
// listing at all (no `operators` row), so this screen's first job is letting them create
// one -- without it, an operator's Dashboard and Bookings tabs have nothing to show and
// there was no way in the app to fix that. Once a listing exists, it can be edited here,
// and a second section lets the operator claim a listing already in Drift's catalogue.

const CATEGORIES = [
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'activity', label: 'Activity' },
  { value: 'transport', label: 'Transport' },
  { value: 'food', label: 'Food' },
] as const;

interface OperatorProfile {
  id: string;
  business_name: string;
  description: string | null;
  category: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  region: string | null;
  country: string | null;
  tier: string;
  is_verified: boolean;
}

interface ListingForm {
  businessName: string;
  description: string;
  category: string;
  website: string;
  phone: string;
  address: string;
  region: string;
  country: string;
}

const emptyForm: ListingForm = { businessName: '', description: '', category: 'activity', website: '', phone: '', address: '', region: '', country: '' };

function toForm(p: OperatorProfile): ListingForm {
  return {
    businessName: p.business_name, description: p.description ?? '', category: p.category,
    website: p.website ?? '', phone: p.phone ?? '', address: p.address ?? '', region: p.region ?? '', country: p.country ?? '',
  };
}

// The API requires a full URL ("https://..."). Typing just the domain is the natural
// thing to do, so this fills in the scheme rather than rejecting it.
function normalizeWebsite(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function toPayload(f: ListingForm) {
  return {
    business_name: f.businessName.trim(),
    description: f.description.trim() || undefined,
    category: f.category,
    website: normalizeWebsite(f.website),
    phone: f.phone.trim() || undefined,
    address: f.address.trim() || undefined,
    region: f.region.trim() || undefined,
    country: f.country.trim() || undefined,
  };
}

interface PlaceResult {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  region: string | null;
  rating: number | null;
  is_claimed: boolean;
  has_pending_claim: boolean;
}

interface ClaimRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  evidence: string | null;
  created_at: string;
  place_name: string;
  address: string | null;
  category: string | null;
  region: string | null;
}

const CLAIM_STATUS_STYLE: Record<string, React.CSSProperties> = {
  pending: { background: '#FFF8E1', color: '#8a5a00' },
  approved: { background: '#E8F5E9', color: '#2E7D32' },
  rejected: { background: '#FFEBEE', color: '#C62828' },
};

export default function OperatorProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<OperatorProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ListingForm>(emptyForm);
  const [error, setError] = useState('');
  const [myEmail, setMyEmail] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/operators/me')
      .then((r) => { setProfile(r.data); setForm(toForm(r.data)); })
      .catch((err) => { if (err?.response?.status !== 404) console.error(err); setProfile(null); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => { api.get('/auth/me').then((r) => setMyEmail(r.data.email)).catch(() => {}); }, []);

  const startCreating = () => { setForm(emptyForm); setEditing(true); setError(''); };
  const startEditing = () => { if (profile) setForm(toForm(profile)); setEditing(true); setError(''); };

  const save = async () => {
    if (!form.businessName.trim()) { setError('Business name is required.'); return; }
    setSaving(true);
    setError('');
    try {
      if (profile) {
        const res = await api.patch(`/operators/${profile.id}`, toPayload(form));
        setProfile((p) => (p ? { ...p, ...res.data } : p));
      } else {
        const res = await api.post('/operators', toPayload(form));
        setProfile({ ...res.data, description: form.description || null, website: normalizeWebsite(form.website) ?? null, phone: form.phone || null, address: form.address || null, region: form.region || null, country: form.country || null } as OperatorProfile);
      }
      setEditing(false);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save your listing. Please check the details and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: '#999' }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2 style={styles.title}>Your business</h2>
        {profile && !editing && (
          <button style={styles.editBtn} onClick={startEditing}>Edit listing</button>
        )}
      </div>

      {!profile && !editing && (
        <div style={styles.card}>
          <p style={styles.emptyTitle}>You haven't listed your business yet.</p>
          <p style={styles.emptyBody}>Create your listing so travellers can find you and book with you on Drift.</p>
          <button style={styles.primaryBtn} onClick={startCreating}>Create your listing</button>
        </div>
      )}

      {profile && !editing && (
        <div style={styles.card}>
          <div style={styles.badges}>
            <span style={styles.tierBadge}>{profile.tier}</span>
            {profile.is_verified && <span style={styles.verifiedBadge}>✓ Verified</span>}
          </div>
          <p style={styles.bizName}>{profile.business_name}</p>
          <p style={styles.category}>{CATEGORIES.find((c) => c.value === profile.category)?.label ?? profile.category}</p>
          {profile.description && <p style={styles.description}>{profile.description}</p>}
          <div style={styles.detailGrid}>
            {profile.address && <Detail label="Address" value={profile.address} />}
            {profile.region && <Detail label="Region" value={profile.region} />}
            {profile.country && <Detail label="Country" value={profile.country} />}
            {profile.phone && <Detail label="Phone" value={profile.phone} />}
            {profile.website && <Detail label="Website" value={profile.website} link />}
          </div>
        </div>
      )}

      {editing && (
        <div style={styles.card}>
          {error && <p style={styles.error}>{error}</p>}
          <div style={styles.fields}>
            <Field label="Business name">
              <input style={styles.input} value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="e.g. Tapasita Nusa Penida" />
            </Field>
            <Field label="Category">
              <select style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Description">
              <textarea style={{ ...styles.input, height: 80, resize: 'vertical' }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What makes your place worth visiting?" />
            </Field>
            <div style={styles.fieldRow}>
              <Field label="Address"><input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
              <Field label="Region"><input style={styles.input} value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="e.g. Nusa Penida" /></Field>
            </div>
            <div style={styles.fieldRow}>
              <Field label="Country"><input style={styles.input} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Indonesia" /></Field>
              <Field label="Phone"><input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+62..." /></Field>
            </div>
            <Field label="Website">
              <input style={styles.input} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="yourbusiness.com" />
            </Field>
          </div>
          <div style={styles.actionRow}>
            <button style={styles.primaryBtn} disabled={saving} onClick={save}>{saving ? 'Saving...' : profile ? 'Save changes' : 'Create listing'}</button>
            <button style={styles.secondaryBtn} disabled={saving} onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}

      <ClaimListing hasProfile={!!profile} myEmail={myEmail} />
    </div>
  );
}

function Detail({ label, value, link }: { label: string; value: string; link?: boolean }) {
  return (
    <div>
      <p style={styles.detailLabel}>{label}</p>
      {link ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noreferrer" style={styles.detailLink}>{value}</a> : <p style={styles.detailValue}>{value}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

// The "claim an existing catalogue listing" section: search, submit a claim, and see
// where past claims stand. A claim needs an operator profile to attach to, so this
// stays a hint until one exists.
function ClaimListing({ hasProfile, myEmail }: { hasProfile: boolean; myEmail: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [claimTarget, setClaimTarget] = useState<PlaceResult | null>(null);
  const [evidence, setEvidence] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimNotice, setClaimNotice] = useState('');

  const loadClaims = () => { api.get('/operators/claims').then((r) => setClaims(r.data || [])).catch(() => {}); };
  useEffect(() => { if (hasProfile) loadClaims(); }, [hasProfile]);

  const search = async () => {
    if (query.trim().length < 2) { setSearchError('Type at least 2 characters.'); return; }
    setSearching(true);
    setSearchError('');
    try {
      const r = await api.get('/operators/search-places', { params: { q: query.trim() } });
      setResults(r.data || []);
    } catch (err: any) {
      setSearchError(err?.response?.data?.message || 'Search failed. Please try again.');
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const openClaim = (place: PlaceResult) => {
    setClaimTarget(place);
    setEvidence('');
    setContactEmail(myEmail);
    setContactPhone('');
    setClaimError('');
    setClaimNotice('');
  };

  const submitClaim = async () => {
    if (!claimTarget) return;
    if (evidence.trim().length < 10) { setClaimError('Explain your connection to this listing in a sentence or two (at least 10 characters).'); return; }
    if (!/^\S+@\S+\.\S+$/.test(contactEmail)) { setClaimError('Enter a valid contact email.'); return; }
    setSubmitting(true);
    setClaimError('');
    try {
      const res = await api.post('/operators/claims', { place_id: claimTarget.id, evidence: evidence.trim(), contact_email: contactEmail.trim(), contact_phone: contactPhone.trim() || undefined });
      setClaimNotice(res.data.message || 'Claim submitted.');
      setClaimTarget(null);
      setResults((prev) => prev && prev.map((p) => (p.id === claimTarget.id ? { ...p, has_pending_claim: true } : p)));
      loadClaims();
    } catch (err: any) {
      setClaimError(err?.response?.data?.message || 'Could not submit the claim.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.card}>
      <h3 style={styles.sectionTitle}>Claim an existing listing</h3>
      {!hasProfile ? (
        <p style={styles.emptyBody}>Create your business listing above first -- a claim is attached to it.</p>
      ) : (
        <>
          <p style={styles.emptyBody}>If your business is already in Drift's catalogue (for example from Google Places), claim it here instead of creating a duplicate.</p>
          <div style={styles.searchRow}>
            <input style={{ ...styles.input, flex: 1 }} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Search by business name" />
            <button style={styles.secondaryBtn} disabled={searching} onClick={search}>{searching ? 'Searching...' : 'Search'}</button>
          </div>
          {searchError && <p style={styles.error}>{searchError}</p>}
          {claimNotice && <p style={styles.notice}>{claimNotice}</p>}

          {results && (
            results.length === 0 ? <p style={styles.emptyBody}>No matching places found.</p> : (
              <div style={styles.resultList}>
                {results.map((p) => (
                  <div key={p.id} style={styles.resultRow}>
                    <div>
                      <p style={styles.resultName}>{p.name}</p>
                      <p style={styles.resultMeta}>{[p.category, p.region, p.address].filter(Boolean).join(' · ')}</p>
                    </div>
                    {p.is_claimed ? (
                      <span style={styles.claimedTag}>Already claimed</span>
                    ) : p.has_pending_claim ? (
                      <span style={styles.pendingTag}>Claim pending</span>
                    ) : (
                      <button style={styles.secondaryBtn} onClick={() => openClaim(p)}>Claim this listing</button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {claimTarget && (
            <div style={styles.claimForm}>
              <p style={styles.claimFormTitle}>Claiming "{claimTarget.name}"</p>
              {claimError && <p style={styles.error}>{claimError}</p>}
              <Field label="How is this your business? (at least 10 characters)">
                <textarea style={{ ...styles.input, height: 70, resize: 'vertical' }} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="I'm the owner / manager of this business..." />
              </Field>
              <div style={styles.fieldRow}>
                <Field label="Contact email"><input style={styles.input} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></Field>
                <Field label="Contact phone (optional)"><input style={styles.input} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></Field>
              </div>
              <div style={styles.actionRow}>
                <button style={styles.primaryBtn} disabled={submitting} onClick={submitClaim}>{submitting ? 'Submitting...' : 'Submit claim'}</button>
                <button style={styles.secondaryBtn} disabled={submitting} onClick={() => setClaimTarget(null)}>Cancel</button>
              </div>
            </div>
          )}

          {claims.length > 0 && (
            <div style={styles.claimsHistory}>
              <p style={styles.sectionSubtitle}>Your claims</p>
              {claims.map((c) => (
                <div key={c.id} style={styles.claimHistoryRow}>
                  <div>
                    <p style={styles.resultName}>{c.place_name}</p>
                    <p style={styles.resultMeta}>{[c.category, c.region].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span style={{ ...styles.statusPill, ...CLAIM_STATUS_STYLE[c.status] }}>{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, maxWidth: 720 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 28, fontWeight: 700, color: '#1a1a1a' },
  editBtn: { padding: '10px 20px', background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  card: { background: '#fff', borderRadius: 16, padding: 24, marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 6 },
  emptyBody: { fontSize: 14, color: '#888', marginBottom: 16, lineHeight: 1.5 },
  primaryBtn: { padding: '10px 20px', background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { padding: '10px 20px', background: '#fff', color: '#1a1a1a', border: '1px solid #e8e8e8', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  badges: { display: 'flex', gap: 8, marginBottom: 12 },
  tierBadge: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#A8893A', background: '#FBF5E6', borderRadius: 20, padding: '3px 10px' },
  verifiedBadge: { fontSize: 11, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', borderRadius: 20, padding: '3px 10px' },
  bizName: { fontSize: 20, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 },
  category: { fontSize: 13, color: '#888', marginBottom: 12 },
  description: { fontSize: 14, color: '#444', lineHeight: 1.6, marginBottom: 16 },
  detailGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  detailLabel: { fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', marginBottom: 2 },
  detailValue: { fontSize: 14, color: '#1a1a1a' },
  detailLink: { fontSize: 14, color: '#A8893A' },
  fields: { display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 },
  fieldRow: { display: 'flex', gap: 16 },
  field: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 500, color: '#888' },
  input: { padding: '10px 12px', borderRadius: 8, border: '1px solid #e8e8e8', fontSize: 14, color: '#1a1a1a', width: '100%', background: '#fff', fontFamily: 'inherit' },
  actionRow: { display: 'flex', gap: 10 },
  error: { fontSize: 13, color: '#C62828', background: '#FFEBEE', borderRadius: 8, padding: '8px 12px', marginBottom: 12 },
  notice: { fontSize: 13, color: '#2E7D32', background: '#E8F5E9', borderRadius: 8, padding: '8px 12px', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 },
  sectionSubtitle: { fontSize: 13, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 10 },
  searchRow: { display: 'flex', gap: 10, marginBottom: 12 },
  resultList: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 },
  resultRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0', gap: 12 },
  resultName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  resultMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  claimedTag: { fontSize: 12, color: '#999', fontWeight: 600 },
  pendingTag: { fontSize: 12, color: '#8a5a00', fontWeight: 600 },
  claimForm: { marginTop: 16, padding: 16, background: '#FAF8F4', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 14 },
  claimFormTitle: { fontSize: 14, fontWeight: 700, color: '#1a1a1a' },
  claimsHistory: { marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0' },
  claimHistoryRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' },
  statusPill: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', borderRadius: 20, padding: '4px 10px' },
};
