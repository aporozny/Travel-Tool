import React, { useEffect, useState } from 'react';
import api from '../services/api.web';
import { Operator } from '@/types';

interface Props {
  onSelectOperator: (op: Operator) => void;
  detail: { type: string; data: any } | null;
  onClearDetail: () => void;
}

const CATEGORIES = ['All', 'accommodation', 'activity', 'food', 'transport'];

export default function ExploreScreen({ onSelectOperator, detail, onClearDetail }: Props) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  useEffect(() => { fetchOperators(); }, []);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/operators');
      setOperators(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = operators.filter(op => {
    const matchSearch = !search || op.business_name.toLowerCase().includes(search.toLowerCase()) || (op.region || '').toLowerCase().includes(search.toLowerCase());
    const matchCat = category === 'All' || op.category === category;
    return matchSearch && matchCat;
  });

  const CATEGORY_COLORS: Record<string, string> = {
    food: '#E8F5E9', accommodation: '#E3F2FD', activity: '#FFF8E1', transport: '#F3E5F5',
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Explore Bali</h2>
        <input
          style={styles.search}
          placeholder="Search operators, regions..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div style={styles.filters}>
          {CATEGORIES.map(c => (
            <button
              key={c}
              style={{ ...styles.filterBtn, ...(category === c ? styles.filterBtnActive : {}) }}
              onClick={() => setCategory(c)}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={styles.loading}>Loading operators...</div>
      ) : (
        <div style={styles.grid}>
          {filtered.map(op => (
            <div
              key={op.id}
              style={styles.card}
              onClick={() => onSelectOperator(op)}>
              <div style={{ ...styles.categoryTag, background: CATEGORY_COLORS[op.category] || '#f5f5f5' }}>
                {op.category}
              </div>
              <h3 style={styles.cardTitle}>{op.business_name}</h3>
              {op.description && (
                <p style={styles.cardDesc}>{op.description.slice(0, 100)}{op.description.length > 100 ? '...' : ''}</p>
              )}
              <div style={styles.cardFooter}>
                <span style={styles.rating}>
                  {parseFloat(op.avg_rating) > 0 ? `★ ${parseFloat(op.avg_rating).toFixed(1)}` : 'No reviews'}
                </span>
                {op.region && <span style={styles.region}>{op.region}</span>}
              </div>
              {op.tier !== 'free' && (
                <div style={styles.tierBadge}>{op.tier}</div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <p style={styles.empty}>No operators found. Try adjusting your search.</p>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32 },
  header: { marginBottom: 28 },
  title: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', marginBottom: 16 },
  search: {
    width: '100%', padding: '12px 16px', borderRadius: 12,
    border: '1px solid #e0e0e0', fontSize: 15, marginBottom: 14,
    outline: 'none', background: '#fff',
  },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterBtn: {
    padding: '6px 16px', borderRadius: 20, border: '1px solid #e0e0e0',
    background: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 500, color: '#555',
  },
  filterBtnActive: { background: '#2E7D32', borderColor: '#2E7D32', color: '#fff' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
  },
  card: {
    background: '#fff', borderRadius: 16, padding: 20,
    cursor: 'pointer', position: 'relative',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'transform 0.15s, box-shadow 0.15s',
    border: '1px solid #f0f0f0',
  },
  categoryTag: {
    display: 'inline-block', padding: '3px 10px', borderRadius: 6,
    fontSize: 11, fontWeight: 500, color: '#444', marginBottom: 10,
  },
  cardTitle: { fontSize: 17, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 },
  cardDesc: { fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 12 },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  rating: { fontSize: 13, color: '#F9A825', fontWeight: 500 },
  region: { fontSize: 12, color: '#aaa' },
  tierBadge: {
    position: 'absolute', top: 16, right: 16,
    background: '#FFF8E1', color: '#F57F17',
    padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
  },
  loading: { color: '#999', fontSize: 15, padding: 40, textAlign: 'center' },
  empty: { color: '#999', fontSize: 15, gridColumn: '1/-1', textAlign: 'center', padding: 40 },
};
