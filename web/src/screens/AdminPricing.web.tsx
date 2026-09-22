import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

// Admin-only: search one route across every flight supplier at once and see Drift's own cost
// and margin alongside the price the traveller is shown, then set (or clear) a route-specific
// markup rule from what that turns up. See backend/src/services/markupRules.ts for the model:
// a route rule overrides the account-wide global one only for that exact origin/destination.

const C = {
  gold: '#C9A84C', goldLight: '#FBF5E6', goldDark: '#A8893A', white: '#FFFFFF',
  border: '#F0EDE8', text: '#1A1A1A', muted: '#9B9590', bg: '#f8f7f4',
  green: '#10B981', greenLight: '#ECFDF5', red: '#C62828', redLight: '#FFEBEE',
};

const PROVIDER_LABEL: Record<string, string> = { duffel: 'Duffel', tripgic: 'TripGic', travelport: 'Travelport' };

interface MarkupRuleRow {
  id: string;
  scope: 'global' | 'route' | 'cabin_class';
  route_origin: string | null;
  route_destination: string | null;
  markup_type: 'percentage' | 'fixed';
  markup_value: string;
  min_fee: string | null;
  max_fee: string | null;
  active: boolean;
  created_at: string;
}

interface ProviderQuote {
  provider: string;
  offerCount: number;
  error: string | null;
  cheapest: {
    airline: string; costAmount: number; costCurrency: string; priceAmount: number; priceCurrency: string;
    costInEur: number | null; priceInEur: number | null; marginInEur: number | null; marginPercentOfCost: number | null;
  } | null;
}

interface Scorecard {
  origin: string; destination: string; departureDate: string;
  effectiveMarkupRule: MarkupRuleRow | null;
  providers: ProviderQuote[];
}

const money = (n: number | null, currency = 'EUR') => (n == null ? '—' : `${currency} ${n.toFixed(2)}`);
const pct = (n: number | null) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

export default function AdminPricing() {
  const [origin, setOrigin] = useState('SYD');
  const [destination, setDestination] = useState('DPS');
  const [departureDate, setDepartureDate] = useState(() => new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10));
  const [searching, setSearching] = useState(false);
  const [card, setCard] = useState<Scorecard | null>(null);
  const [error, setError] = useState('');

  const [rules, setRules] = useState<MarkupRuleRow[]>([]);
  const [rulesError, setRulesError] = useState('');
  const loadRules = () => api.get('/admin/markup-rules').then((r) => setRules(r.data.rules || [])).catch((err) => setRulesError(err?.response?.data?.message || 'Could not load markup rules. Make sure you are signed in as admin.'));
  useEffect(() => { loadRules(); }, []);

  const [ruleValue, setRuleValue] = useState('10');
  const [savingRule, setSavingRule] = useState(false);
  const [ruleError, setRuleError] = useState('');

  const runSearch = async () => {
    setSearching(true);
    setError('');
    setCard(null);
    try {
      const r = await api.get('/admin/flights/scorecard', { params: { origin, destination, departureDate, adults: 1 } });
      setCard(r.data);
      const rule = r.data.effectiveMarkupRule;
      setRuleValue(rule?.scope === 'route' && rule.markup_type === 'percentage' ? String(Math.round(parseFloat(rule.markup_value) * 1000) / 10) : '10');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const setRouteRule = async () => {
    const fraction = parseFloat(ruleValue) / 100;
    if (!fraction || fraction <= 0 || fraction >= 1) { setRuleError('Enter a percentage between 0 and 100, e.g. 10 for 10%.'); return; }
    setSavingRule(true);
    setRuleError('');
    try {
      await api.post('/admin/markup-rules', { scope: 'route', routeOrigin: origin, routeDestination: destination, markupType: 'percentage', markupValue: fraction, minFee: 5, maxFee: 150 });
      await Promise.all([loadRules(), runSearch()]);
    } catch (err: any) {
      setRuleError(err?.response?.data?.message || 'Could not save the rule.');
    } finally {
      setSavingRule(false);
    }
  };

  const deactivate = async (id: string) => {
    try {
      await api.patch(`/admin/markup-rules/${id}`, { active: false });
      await Promise.all([loadRules(), card && runSearch()]);
    } catch (err: any) {
      setRulesError(err?.response?.data?.message || 'Could not deactivate that rule.');
    }
  };

  const routeRules = rules.filter((r) => r.scope === 'route');
  const globalRule = rules.find((r) => r.scope === 'global' && r.active);

  return (
    <div style={s.page}>
      <h1 style={s.title}>Flight supplier scorecard</h1>
      <p style={s.subtitle}>Search one route across every supplier and see Drift's own cost and margin, not just the price shown to travellers.</p>

      <div style={s.card}>
        <div style={s.searchRow}>
          <label style={s.field}><span style={s.label}>From</span><input style={s.input} value={origin} maxLength={3} onChange={(e) => setOrigin(e.target.value.toUpperCase())} /></label>
          <label style={s.field}><span style={s.label}>To</span><input style={s.input} value={destination} maxLength={3} onChange={(e) => setDestination(e.target.value.toUpperCase())} /></label>
          <label style={s.field}><span style={s.label}>Departure date</span><input style={s.input} type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} /></label>
          <button style={s.primaryBtn} disabled={searching} onClick={runSearch}>{searching ? 'Searching...' : 'Search'}</button>
        </div>
        {error && <p style={s.error}>{error}</p>}
      </div>

      {card && (
        <div style={s.card}>
          <p style={s.effective}>
            Effective markup for {card.origin} → {card.destination} today:{' '}
            {card.effectiveMarkupRule ? (
              <strong>
                {card.effectiveMarkupRule.markup_type === 'percentage' ? `${(parseFloat(card.effectiveMarkupRule.markup_value) * 100).toFixed(1)}%` : `${card.effectiveMarkupRule.markup_value} flat`}
                {card.effectiveMarkupRule.scope === 'route' ? ' (this route’s own rule)' : ' (the account-wide global rule)'}
              </strong>
            ) : <strong>none active</strong>}
          </p>

          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Supplier</th>
                <th style={s.th}>Offers</th>
                <th style={s.th}>Cheapest airline</th>
                <th style={s.th}>Drift's cost</th>
                <th style={s.th}>Traveller pays</th>
                <th style={s.th}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {card.providers.map((p) => (
                <tr key={p.provider}>
                  <td style={s.td}>{PROVIDER_LABEL[p.provider] ?? p.provider}</td>
                  <td style={s.td}>{p.error ? <span style={{ color: C.red }}>failed</span> : p.offerCount}</td>
                  <td style={s.td}>{p.cheapest?.airline ?? '—'}</td>
                  <td style={s.td}>{p.cheapest ? money(p.cheapest.costInEur) : '—'}</td>
                  <td style={s.td}>{p.cheapest ? money(p.cheapest.priceInEur) : '—'}</td>
                  <td style={s.td}>
                    {p.cheapest?.marginInEur != null ? `${money(p.cheapest.marginInEur)} (${pct(p.cheapest.marginPercentOfCost)})` : p.provider === 'travelport' ? 'not marked up yet' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={s.note}>Costs and prices are converted to EUR so suppliers quoting in different currencies compare fairly. Margin is Drift's markup on whichever fare is cheapest for that supplier -- it is not provider-specific, since one rule applies to the whole route regardless of which supplier fills it.</p>

          <div style={s.ruleForm}>
            <p style={s.sectionTitle}>Set a rule for {card.origin} → {card.destination}</p>
            {ruleError && <p style={s.error}>{ruleError}</p>}
            <div style={s.searchRow}>
              <label style={s.field}><span style={s.label}>Markup %</span><input style={s.input} type="number" min={0} max={99} step={0.5} value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} /></label>
              <button style={s.primaryBtn} disabled={savingRule} onClick={setRouteRule}>{savingRule ? 'Saving...' : 'Save as this route’s rule'}</button>
            </div>
            <p style={s.note}>Applies the global $5–150 floor/ceiling. Replaces any existing active rule for this exact route (the old one is kept, just switched off).</p>
          </div>
        </div>
      )}

      <div style={s.card}>
        <p style={s.sectionTitle}>Route rules currently active {globalRule && <span style={s.mutedInline}>(global fallback: {(parseFloat(globalRule.markup_value) * 100).toFixed(1)}%)</span>}</p>
        {rulesError && <p style={s.error}>{rulesError}</p>}
        {routeRules.filter((r) => r.active).length === 0 ? (
          <p style={s.note}>No route has its own rule yet -- every route uses the global markup.</p>
        ) : (
          routeRules.filter((r) => r.active).map((r) => (
            <div key={r.id} style={s.ruleRow}>
              <span>{r.route_origin} → {r.route_destination}: {r.markup_type === 'percentage' ? `${(parseFloat(r.markup_value) * 100).toFixed(1)}%` : r.markup_value}</span>
              <button style={s.secondaryBtn} onClick={() => deactivate(r.id)}>Deactivate</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 32, maxWidth: 900, margin: '0 auto', background: C.bg, minHeight: '100vh' },
  title: { fontSize: 26, fontWeight: 700, color: C.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: C.muted, marginBottom: 24 },
  card: { background: C.white, borderRadius: 16, padding: 20, marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  searchRow: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, fontWeight: 500, color: C.muted },
  input: { padding: '9px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 14, color: C.text, width: 130 },
  primaryBtn: { padding: '10px 18px', background: C.gold, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn: { padding: '8px 14px', background: '#fff', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  error: { fontSize: 13, color: C.red, background: C.redLight, borderRadius: 8, padding: '8px 12px', marginTop: 10 },
  effective: { fontSize: 14, color: C.text, marginBottom: 14 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` },
  td: { padding: '10px 10px', borderBottom: `1px solid ${C.border}`, color: C.text },
  note: { fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.5 },
  ruleForm: { marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.border}` },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 },
  mutedInline: { fontWeight: 400, color: C.muted },
  ruleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${C.border}`, fontSize: 14 },
};
