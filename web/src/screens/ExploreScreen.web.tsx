import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api.web';

const CATEGORIES = [
  { key: '', label: 'All' },
  { key: 'food', label: 'Food & drink' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'activity', label: 'Activities' },
  { key: 'transport', label: 'Transport' },
];

const REGIONS = [
  'Seminyak', 'Canggu', 'Ubud', 'Nusa Penida', 'Uluwatu',
  'Sanur', 'Amed', 'Tulamben', 'Lombok', 'Gili Islands',
  'Flores', 'Sidemen', 'Munduk', 'Lovina', 'Jimbaran',
  'Saranda', 'Ksamil', 'Gjirokastra', 'Himara', 'Dhermi',
];

function PhotoUrl(ref: string): string {
  if (!ref) return '';
  if (ref.startsWith('http')) {
    const match = ref.match(/photo_reference=([^&]+)/);
    if (match) return `/api/v1/photos?ref=${match[1]}`;
    return ref;
  }
  return `/api/v1/photos?ref=${ref}`;
}

function ScoreBadge({ score, personalized }: { score: number; personalized: boolean }) {
  if (!personalized || score === 0) return null;
  const color = score >= 70 ? '#C9A84C' : score >= 40 ? '#F57F17' : '#888';
  return (
    <span style={{ ...styles.scoreBadge, background: color }}>
      {score}% match
    </span>
  );
}

function ResultCard({ item, personalized, onSave, saved, onView }: any) {
  const photo = item.photos?.[0] ? PhotoUrl(item.photos[0]) : null;
  const score = Math.round((item.score / 100) * 100);

  return (
    <div style={styles.card} onClick={() => onView(item)}>
      <div style={styles.cardPhoto}>
        {photo ? (
          <img src={photo} alt={item.name} style={styles.cardImg}
            onError={(e: any) => { e.target.style.display = 'none'; }} />
        ) : (
          <div style={styles.cardNoPhoto}>{item.category?.[0]?.toUpperCase()}</div>
        )}
        <ScoreBadge score={score} personalized={personalized} />
        <button
          style={{ ...styles.saveBtn, color: saved ? '#E53935' : '#fff' }}
          onClick={(e) => { e.stopPropagation(); onSave(item); }}>
          {saved ? '♥' : '♡'}
        </button>
      </div>
      <div style={styles.cardBody}>
        <div style={styles.cardTopRow}>
          <span style={styles.cardCategory}>{item.category}</span>
          {item.is_verified && <span style={styles.verifiedBadge}>✓ Verified</span>}
          {item.trust_tier === 'elite' && <span style={styles.eliteBadge}>◆ Elite</span>}
          {item.trust_tier === 'trusted' && <span style={styles.trustedBadge}>★ Trusted</span>}
          {item.is_claimed && !item.is_verified && <span style={styles.claimedBadge}>Claimed</span>}
          {!item.operator_id && <span style={styles.unclaimedBadge}>Unclaimed</span>}
        </div>
        <h3 style={styles.cardName}>{item.name}</h3>
        <p style={styles.cardRegion}>{item.region}</p>
        {item.rating > 0 && (
          <div style={styles.cardRating}>
            <span style={styles.stars}>★</span>
            <span style={styles.ratingNum}>{parseFloat(item.rating).toFixed(1)}</span>
            <span style={styles.reviewCount}>({item.review_count?.toLocaleString()})</span>
          </div>
        )}
        {item.description && (
          <p style={styles.cardDesc}>{item.description.slice(0, 100)}{item.description.length > 100 ? '...' : ''}</p>
        )}
        {item.tags?.length > 0 && (
          <div style={styles.tagRow}>
            {item.tags.slice(0, 3).map((t: string) => (
              <span key={t} style={styles.tag}>{t.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ item, onClose, onBook }: any) {
  const photos = item.photos || [];

  return (
    <div style={styles.detail}>
      <button style={styles.detailClose} onClick={onClose}>✕ Close</button>
      {photos[0] && (
        <img src={PhotoUrl(photos[0])} alt={item.name} style={styles.detailPhoto}
          onError={(e: any) => { e.target.style.display = 'none'; }} />
      )}
      <div style={styles.detailBody}>
        <div style={styles.detailTopRow}>
          <span style={styles.cardCategory}>{item.category}</span>
          {item.is_verified && <span style={styles.verifiedBadge}>✓ Verified</span>}
        </div>
        <h2 style={styles.detailName}>{item.name}</h2>
        <p style={styles.detailRegion}>{item.region}{item.address ? ` · ${item.address}` : ''}</p>
        {item.rating > 0 && (
          <div style={styles.cardRating}>
            <span style={styles.stars}>★</span>
            <span style={styles.ratingNum}>{parseFloat(item.rating).toFixed(1)}</span>
            <span style={styles.reviewCount}>({item.review_count?.toLocaleString()} reviews)</span>
          </div>
        )}
        {item.description && <p style={styles.detailDesc}>{item.description}</p>}
        {item.tags?.length > 0 && (
          <div style={{ ...styles.tagRow, marginBottom: 16 }}>
            {item.tags.map((t: string) => (
              <span key={t} style={styles.tag}>{t.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
        <div style={styles.detailLinks}>
          {item.website && (
            <a href={item.website} target="_blank" rel="noopener noreferrer" style={styles.detailLink}>
              Website
            </a>
          )}
          {item.phone && <span style={styles.detailPhone}>{item.phone}</span>}
        </div>
        {item.type === 'operator' && (
          <button style={styles.bookBtn} onClick={() => onBook(item)}>Request booking</button>
        )}
      </div>
    </div>
  );
}

export default function ExploreScreen({ onSelectOperator, detail, onClearDetail }: any) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [personalized, setPersonalized] = useState(false);
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [search, setSearch] = useState('');
  const [saves, setSaves] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<any>(null);
  const [activeTrips, setActiveTrips] = useState<any[]>([]);

  // Restore saved region and load active trips
  useEffect(() => {
    const saved = localStorage.getItem('drift_region');
    if (saved) setRegion(saved);

    api.get('/safety/trips').then((r: any) => {
      const active = (r.data || []).filter((t: any) =>
        ['active', 'planned'].includes(t.safety_status)
      );
      setActiveTrips(active);
      // Auto-set region from active trip if none saved
      if (!saved && active.length > 0) {
        const dest = active[0].destination || '';
        const match = REGIONS.find(r =>
          dest.toLowerCase().includes(r.toLowerCase())
        );
        if (match) {
          setRegion(match);
          localStorage.setItem('drift_region', match);
        }
      }
    }).catch(() => {});
  }, []);

  const setDestination = (r: string) => {
    const next = region === r ? '' : r;
    setRegion(next);
    if (next) localStorage.setItem('drift_region', next);
    else localStorage.removeItem('drift_region');
  };

  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 40 };
      if (category) params.category = category;
      if (region) params.region = region;

      const res = await api.get('/recommendations', { params });
      setResults(res.data.results || []);
      setPersonalized(res.data.personalized || false);
    } catch {
      try {
        const res = await api.get('/operators', { params: { category, region } });
        setResults(res.data.map((o: any) => ({ ...o, type: 'operator', score: 0 })));
      } catch {}
    } finally {
      setLoading(false);
    }
  }, [category, region]);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const handleSave = async (item: any) => {
    try {
      const res = await api.post('/recommendations/save', {
        entity_type: item.type,
        entity_id: item.id,
      });
      setSaves(prev => {
        const next = new Set(prev);
        if (res.data.saved) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
    } catch {}
  };

  const handleView = async (item: any) => {
    setSelected(item);
    try {
      await api.post('/recommendations/interact', {
        entity_type: item.type,
        entity_id: item.id,
        interaction_type: 'view',
        region: item.region,
        category: item.category,
        tags: item.tags,
      });
    } catch {}
  };

  const filtered = search
    ? results.filter(r =>
        r.name?.toLowerCase().includes(search.toLowerCase()) ||
        r.region?.toLowerCase().includes(search.toLowerCase()) ||
        r.tags?.some((t: string) => t.includes(search.toLowerCase()))
      )
    : results;

  if (selected) {
    return (
      <div style={styles.container}>
        <DetailPanel
          item={selected}
          onClose={() => setSelected(null)}
          onBook={(item: any) => { onSelectOperator(item); setSelected(null); }}
        />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>

        {/* Destination picker */}
        <div style={styles.destinationSection}>
          <div style={styles.destinationHeader}>
            <span style={styles.destinationTitle}>
              {region ? `Exploring ${region}` : 'Where are you going?'}
            </span>
            {region && (
              <button style={styles.clearDest} onClick={() => setDestination(region)}>
                Clear
              </button>
            )}
          </div>

          {/* Active trips first */}
          {activeTrips.length > 0 && (
            <div style={styles.tripPills}>
              {activeTrips.map((t: any) => {
                const match = REGIONS.find(r =>
                  (t.destination || '').toLowerCase().includes(r.toLowerCase())
                ) || t.destination;
                return (
                  <button
                    key={t.id}
                    style={{ ...styles.destPill, ...styles.tripPill, ...(region === match ? styles.destPillActive : {}) }}
                    onClick={() => match && setDestination(match)}
                  >
                    ✈ {t.destination}
                  </button>
                );
              })}
            </div>
          )}

          {/* Region pills */}
          <div style={styles.regionPills}>
            {REGIONS.map(r => (
              <button
                key={r}
                style={{ ...styles.destPill, ...(region === r ? styles.destPillActive : {}) }}
                onClick={() => setDestination(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div style={styles.searchRow}>
          <input
            style={styles.searchInput}
            placeholder={region ? `Search in ${region}...` : 'Search by name, activity...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Category filters */}
        <div style={styles.filterRow}>
          <div style={styles.filterScroll}>
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                style={{ ...styles.filterChip, ...(category === c.key ? styles.filterChipActive : {}) }}
                onClick={() => setCategory(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {personalized && (
          <p style={styles.personalizedNote}>✦ Ranked by your preferences</p>
        )}
      </div>

      {loading ? (
        <div style={styles.loading}>
          {region ? `Finding the best of ${region} for you...` : 'Finding matches...'}
        </div>
      ) : filtered.length === 0 ? (
        <div style={styles.empty}>
          {region
            ? `Nothing found in ${region}. Try a different category or clear the destination.`
            : 'No results found. Try adjusting your filters.'}
        </div>
      ) : (
        <div style={styles.grid}>
          {filtered.map(item => (
            <ResultCard
              key={`${item.type}-${item.id}`}
              item={item}
              personalized={personalized}
              onSave={handleSave}
              saved={saves.has(item.id)}
              onView={handleView}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100%', overflow: 'auto', background: '#f8f7f4' },
  header: { background: '#fff', borderBottom: '1px solid #F0EDE8', padding: '16px 20px', position: 'sticky', top: 0, zIndex: 10 },

  // Destination section
  destinationSection: { marginBottom: 12 },
  destinationHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  destinationTitle: { fontSize: 13, fontWeight: 600, color: '#1A1A1A' },
  clearDest: { fontSize: 12, color: '#C9A84C', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 },
  tripPills: { display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' as const },
  tripPill: { borderColor: '#C9A84C !important' as any },
  regionPills: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  destPill: {
    padding: '5px 12px', borderRadius: 20,
    border: '1.5px solid #E8E4DE', background: '#fff',
    fontSize: 12, cursor: 'pointer', color: '#666',
    fontWeight: 500, whiteSpace: 'nowrap' as const,
  },
  destPillActive: {
    borderColor: '#C9A84C', background: '#FBF5E6',
    color: '#A8893A', fontWeight: 700,
  },

  searchRow: { marginBottom: 10 },
  searchInput: { width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #E8E4DE', fontSize: 14, background: '#f8f7f4', boxSizing: 'border-box' as const, outline: 'none' },
  filterRow: { display: 'flex', gap: 8, alignItems: 'center' },
  filterScroll: { display: 'flex', gap: 6, overflowX: 'auto' as const, flex: 1 },
  filterChip: { padding: '6px 14px', borderRadius: 20, border: '1.5px solid #E8E4DE', background: '#fff', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' as const, color: '#555' },
  filterChipActive: { borderColor: '#C9A84C', background: '#FBF5E6', color: '#C9A84C', fontWeight: 500 },
  personalizedNote: { fontSize: 12, color: '#C9A84C', marginTop: 8, fontWeight: 500 },
  loading: { padding: 60, textAlign: 'center' as const, color: '#999' },
  empty: { padding: 60, textAlign: 'center' as const, color: '#999', maxWidth: 400, margin: '0 auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, padding: 20 },

  card: { background: '#fff', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 6px rgba(0,0,0,0.06)', transition: 'transform 0.15s' },
  cardPhoto: { position: 'relative' as const, height: 180, background: '#f0f0f0' },
  cardImg: { width: '100%', height: '100%', objectFit: 'cover' as const },
  cardNoPhoto: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, color: '#ccc' },
  scoreBadge: { position: 'absolute' as const, top: 10, left: 10, color: '#fff', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6 },
  saveBtn: { position: 'absolute' as const, top: 8, right: 10, background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', textShadow: '0 1px 3px rgba(0,0,0,0.3)' },
  cardBody: { padding: '12px 14px 14px' },
  cardTopRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' as const },
  cardCategory: { fontSize: 11, color: '#999', textTransform: 'capitalize' as const },
  verifiedBadge: { fontSize: 10, color: '#C9A84C', background: '#FBF5E6', padding: '1px 6px', borderRadius: 4, fontWeight: 600 },
  claimedBadge: { fontSize: 10, color: '#F57F17', background: '#FFF8E1', padding: '1px 6px', borderRadius: 4 },
  eliteBadge: { fontSize: 10, color: '#A8893A', background: '#FBF5E6', padding: '1px 6px', borderRadius: 4, fontWeight: 700 },
  trustedBadge: { fontSize: 10, color: '#10B981', background: '#ECFDF5', padding: '1px 6px', borderRadius: 4, fontWeight: 600 },
  unclaimedBadge: { fontSize: 10, color: '#9B9590', background: '#F5F3EF', padding: '1px 6px', borderRadius: 4, fontWeight: 500 },
  cardName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 },
  cardRegion: { fontSize: 12, color: '#999', marginBottom: 6 },
  cardRating: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 },
  stars: { color: '#F9A825', fontSize: 14 },
  ratingNum: { fontSize: 13, fontWeight: 600, color: '#1a1a1a' },
  reviewCount: { fontSize: 12, color: '#999' },
  cardDesc: { fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 8 },
  tagRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  tag: { fontSize: 11, color: '#888', background: '#f5f5f5', padding: '2px 7px', borderRadius: 4 },

  detail: { maxWidth: 700, margin: '0 auto', padding: 20 },
  detailClose: { background: 'none', border: '1px solid #E8E4DE', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, color: '#666', marginBottom: 16 },
  detailPhoto: { width: '100%', height: 280, objectFit: 'cover' as const, borderRadius: 14, marginBottom: 16 },
  detailBody: { background: '#fff', borderRadius: 14, padding: 24 },
  detailTopRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  detailName: { fontSize: 24, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 },
  detailRegion: { fontSize: 14, color: '#888', marginBottom: 10 },
  detailDesc: { fontSize: 15, color: '#555', lineHeight: 1.7, marginBottom: 16 },
  detailLinks: { display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 },
  detailLink: { color: '#C9A84C', fontSize: 14, fontWeight: 500 },
  detailPhone: { color: '#555', fontSize: 14 },
  bookBtn: { width: '100%', padding: '14px 0', background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
};
